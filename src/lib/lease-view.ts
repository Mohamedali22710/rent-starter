import { invoiceStatus, malaysiaDateOf, type InvoiceStatus } from './billing'
import { prisma } from './prisma'

/**
 * Lease detail projection shared by GET /api/leases/:leaseId and the lease
 * pages: invoices in allocation order (due date, deposit before rent, period
 * index) with paid amounts and invoiceStatus statuses, plus the payments.
 * Ownership must be checked by the caller (route handler or server
 * component) before calling this.
 */
export interface InvoiceView {
  id: string
  kind: string
  periodIndex: number | null
  periodStart: string | null
  periodEnd: string | null
  dueDate: string
  amountSen: number
  paidSen: number
  status: InvoiceStatus
}

export interface PaymentView {
  id: string
  amountSen: number
  unappliedSen: number
  method: string
  status: string
  receivedAt: string
  slipPath: string | null
  rejectedReason: string | null
  voidedReason: string | null
}

export interface LeaseView {
  lease: {
    id: string
    unitId: string
    tenantId: string
    startDate: string
    endDate: string
    monthlyRentSen: number
    depositSen: number
  }
  invoices: InvoiceView[]
  payments: PaymentView[]
}

export function allocationOrder(a: { kind: string; periodIndex: number | null; dueDate: string }, b: {
  kind: string
  periodIndex: number | null
  dueDate: string
}): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
  if (a.kind !== b.kind) return a.kind === 'deposit' ? -1 : 1
  return (a.periodIndex ?? -1) - (b.periodIndex ?? -1)
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function loadLeaseView(
  leaseId: string,
  now: Date,
): Promise<LeaseView | null> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: {
      invoices: { include: { allocations: { select: { amountSen: true } } } },
      payments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          amountSen: true,
          unappliedSen: true,
          method: true,
          status: true,
          receivedAt: true,
          slipPath: true,
          rejectedReason: true,
          voidedReason: true,
        },
      },
    },
  })
  if (lease === null) return null

  const invoicesOrdered = [...lease.invoices].sort((a, b) =>
    allocationOrder(
      { kind: a.kind, periodIndex: a.periodIndex, dueDate: ymd(a.dueDate) },
      { kind: b.kind, periodIndex: b.periodIndex, dueDate: ymd(b.dueDate) },
    ),
  )

  return {
    lease: {
      id: lease.id,
      unitId: lease.unitId,
      tenantId: lease.tenantId,
      startDate: ymd(lease.startDate),
      endDate: ymd(lease.endDate),
      monthlyRentSen: Number(lease.monthlyRentSen),
      depositSen: Number(lease.depositSen),
    },
    invoices: invoicesOrdered.map((invoice) => {
      const paidSen = invoice.allocations.reduce((sum, a) => sum + Number(a.amountSen), 0)
      return {
        id: invoice.id,
        kind: invoice.kind,
        periodIndex: invoice.periodIndex,
        periodStart: invoice.periodStart === null ? null : ymd(invoice.periodStart),
        periodEnd: invoice.periodEnd === null ? null : ymd(invoice.periodEnd),
        dueDate: ymd(invoice.dueDate),
        amountSen: Number(invoice.amountSen),
        paidSen,
        status: invoiceStatus({ dueDate: ymd(invoice.dueDate), amountSen: Number(invoice.amountSen), paidSen }, now),
      }
    }),
    payments: lease.payments.map((p) => ({
      id: p.id,
      amountSen: Number(p.amountSen),
      unappliedSen: Number(p.unappliedSen),
      method: p.method,
      status: p.status,
      receivedAt: p.receivedAt.toISOString(),
      slipPath: p.slipPath,
      rejectedReason: p.rejectedReason,
      voidedReason: p.voidedReason,
    })),
  }
}

/** Due-now totals for a lease view (today in Malaysia time). */
export function dueNowOf(view: LeaseView): number {
  const todayMy = malaysiaDateOf(new Date())
  return view.invoices
    .filter((i) => i.dueDate <= todayMy)
    .map((i) => i.amountSen - i.paidSen)
    .filter((unpaid) => unpaid > 0)
    .reduce((sum, unpaid) => sum + unpaid, 0)
}
