import { NextResponse } from 'next/server'

import { getCaller, notFound, unauthorized } from '@/lib/auth'
import { invoiceStatus } from '@/lib/billing'
import { prisma } from '@/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/leases/:leaseId — staff, manager, or the lease's tenant.
 * Returns the lease, its invoices in allocation order (due date, then deposit
 * before rent, then period index) with the paid amounts and statuses computed
 * by invoiceStatus, and its payments. Other organizations' (and other
 * tenants') leases are 404: never revealed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leaseId: string }> },
) {
  const caller = await getCaller()
  if (caller === null) return unauthorized()

  const { leaseId } = await params
  if (!UUID_RE.test(leaseId)) return notFound()

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
        },
      },
    },
  })
  if (lease === null) return notFound()

  const visible =
    caller.role === 'tenant' ? lease.tenantId === caller.tenantId : lease.orgId === caller.orgId
  if (!visible) return notFound()

  const invoicesOrdered = [...lease.invoices].sort((a, b) => {
    const ad = a.dueDate.toISOString().slice(0, 10)
    const bd = b.dueDate.toISOString().slice(0, 10)
    if (ad !== bd) return ad < bd ? -1 : 1
    if (a.kind !== b.kind) return a.kind === 'deposit' ? -1 : 1
    return (a.periodIndex ?? -1) - (b.periodIndex ?? -1)
  })

  const now = new Date()
  return NextResponse.json({
    lease: {
      id: lease.id,
      unitId: lease.unitId,
      tenantId: lease.tenantId,
      startDate: lease.startDate.toISOString().slice(0, 10),
      endDate: lease.endDate.toISOString().slice(0, 10),
      monthlyRentSen: Number(lease.monthlyRentSen),
      depositSen: Number(lease.depositSen),
    },
    invoices: invoicesOrdered.map((invoice) => {
      const paidSen = invoice.allocations.reduce((sum, a) => sum + Number(a.amountSen), 0)
      return {
        id: invoice.id,
        kind: invoice.kind,
        periodIndex: invoice.periodIndex,
        periodStart: invoice.periodStart?.toISOString().slice(0, 10) ?? null,
        periodEnd: invoice.periodEnd?.toISOString().slice(0, 10) ?? null,
        dueDate: invoice.dueDate.toISOString().slice(0, 10),
        amountSen: Number(invoice.amountSen),
        paidSen,
        status: invoiceStatus(
          {
            dueDate: invoice.dueDate.toISOString().slice(0, 10),
            amountSen: Number(invoice.amountSen),
            paidSen,
          },
          now,
        ),
      }
    }),
    payments: lease.payments.map((p) => ({
      id: p.id,
      amountSen: Number(p.amountSen),
      unappliedSen: Number(p.unappliedSen),
      method: p.method,
      status: p.status,
      receivedAt: p.receivedAt.toISOString(),
    })),
  })
}
