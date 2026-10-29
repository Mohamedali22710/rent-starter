import { NextResponse } from 'next/server'

import { getCaller, notFound, unauthorized } from '@/lib/auth'
import { loadLeaseView } from '@/lib/lease-view'
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

  // Ownership first, on the cheap row itself: another org's (or tenant's)
  // lease is 404 before anything else is loaded.
  const owning = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { orgId: true, tenantId: true },
  })
  if (owning === null) return notFound()
  const visible =
    caller.role === 'tenant' ? owning.tenantId === caller.tenantId : owning.orgId === caller.orgId
  if (!visible) return notFound()

  const view = await loadLeaseView(leaseId, new Date())
  if (view === null) return notFound()

  // Response shape exactly as documented in section 7.
  return NextResponse.json({
    lease: view.lease,
    invoices: view.invoices,
    payments: view.payments.map((p) => ({
      id: p.id,
      amountSen: p.amountSen,
      unappliedSen: p.unappliedSen,
      method: p.method,
      status: p.status,
      receivedAt: p.receivedAt,
    })),
  })
}
