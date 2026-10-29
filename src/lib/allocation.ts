import { Prisma } from '@prisma/client'

/**
 * Planning of payment allocation (brief section 4), pure and testable:
 * allocation itself happens inside an interactive transaction in the routes
 * via allocatePayment();
 */

export interface PlanInvoice {
  id: string
  kind: 'deposit' | 'rent'
  /** null for the deposit */
  periodIndex: number | null
  /** 'YYYY-MM-DD' */
  dueDate: string
  amountSen: number
  /** Sum of existing allocations on the invoice */
  paidSen: number
}

export interface AllocationPlan {
  allocations: { invoiceId: string; amountSen: number }[]
  /** Anything left once every invoice is fully paid. */
  unappliedSen: number
}

/**
 * Spread amountSen over the invoices that still have something unpaid, in the
 * brief's order: due date, then deposit before rent, then period index.
 * Includes invoices that are not due yet. Each invoice is filled up to its
 * unpaid amount before the next one is touched.
 */
export function planAllocation(invoices: PlanInvoice[], amountSen: number): AllocationPlan {
  const ordered = [...invoices].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
    if (a.kind !== b.kind) return a.kind === 'deposit' ? -1 : 1
    const ai = a.periodIndex ?? -1
    const bi = b.periodIndex ?? -1
    return ai - bi
  })

  let remaining = amountSen
  const allocations: { invoiceId: string; amountSen: number }[] = []
  for (const invoice of ordered) {
    if (remaining <= 0) break
    const unpaid = invoice.amountSen - invoice.paidSen
    if (unpaid <= 0) continue
    const fill = Math.min(unpaid, remaining)
    allocations.push({ invoiceId: invoice.id, amountSen: fill })
    remaining -= fill
  }
  return { allocations, unappliedSen: remaining }
}

/**
 * Allot an approved payment to the lease's invoices inside the caller's
 * interactive transaction. Creates one allocation row per invoice touched and
 * stores whatever is left on the payment as unapplied_sen.
 */
export async function allocatePayment(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<AllocationPlan> {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
  if (payment.status !== 'approved') {
    throw new Error('allocatePayment expects an approved payment')
  }

  const invoices = await tx.invoice.findMany({ where: { leaseId: payment.leaseId } })
  const paidRows = await tx.paymentAllocation.groupBy({
    by: ['invoiceId'],
    where: { invoiceId: { in: invoices.map((i) => i.id) } },
    _sum: { amountSen: true },
  })
  const paidByInvoice = new Map(paidRows.map((r) => [r.invoiceId, Number(r._sum.amountSen || BigInt(0))]))

  const plan = planAllocation(
    invoices.map((i) => ({
      id: i.id,
      kind: i.kind as 'deposit' | 'rent',
      periodIndex: i.periodIndex,
      dueDate: i.dueDate.toISOString().slice(0, 10),
      amountSen: Number(i.amountSen),
      paidSen: paidByInvoice.get(i.id) ?? 0,
    })),
    Number(payment.amountSen),
  )

  if (plan.allocations.length > 0) {
    await tx.paymentAllocation.createMany({
      data: plan.allocations.map((a) => ({
        orgId: payment.orgId,
        paymentId,
        invoiceId: a.invoiceId,
        amountSen: BigInt(a.amountSen),
      })),
    })
  }
  await tx.payment.update({
    where: { id: paymentId },
    data: { unappliedSen: BigInt(plan.unappliedSen) },
  })

  return plan
}
