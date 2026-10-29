import { NextResponse } from 'next/server'

import { forbidden, getCaller, notFound, serverError, unauthorized } from '@/lib/auth'
import { malaysiaDateOf } from '@/lib/billing'
import { dueNowSen, type DueNowInvoice } from '@/lib/due-now'
import { prisma } from '@/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/leases/:leaseId/gateway-bills — the lease's tenant only.
 * Creates a gateway bill for the amount due now: the unpaid amounts of the
 * lease's invoices due on or before today's Malaysia date. Bill ids are
 * generated UUIDs (unguessable); only the webhook settles them. Nothing due
 * -> 422.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ leaseId: string }> },
) {
  const caller = await getCaller()
  if (caller === null) return unauthorized()
  if (caller.role !== 'tenant') return forbidden() // staff/managers do not pay online

  const { leaseId } = await params
  if (!UUID_RE.test(leaseId)) return notFound()

  const lease = await prisma.lease.findUnique({ where: { id: leaseId } })
  // Another tenant's lease (or anything they cannot see) is 404.
  if (lease === null || lease.tenantId !== caller.tenantId) return notFound()

  const today = malaysiaDateOf(new Date())

  const invoiceRows = await prisma.invoice.findMany({
    where: { leaseId: lease.id },
    select: { id: true, dueDate: true, amountSen: true, allocations: { select: { amountSen: true } } },
  })
  const totalDueSen = dueNowSen(
    invoiceRows.map(
      (i): DueNowInvoice => ({
        dueDate: i.dueDate.toISOString().slice(0, 10),
        amountSen: Number(i.amountSen),
        paidSen: i.allocations.reduce((paid, a) => paid + Number(a.amountSen), 0),
      }),
    ),
    today,
  )

  if (totalDueSen <= 0) {
    return NextResponse.json({ error: 'Nothing is due on this lease today' }, { status: 422 })
  }

  try {
    const bill = await prisma.gatewayBill.create({
      data: {
        orgId: lease.orgId,
        leaseId: lease.id,
        amountSen: BigInt(totalDueSen),
        status: 'pending',
      },
    })
    return NextResponse.json({ billId: bill.id, amountSen: totalDueSen }, { status: 201 })
  } catch (error) {
    console.error('gateway bill creation failed', error)
    return serverError()
  }
}
