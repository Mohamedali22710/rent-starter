import { NextResponse } from 'next/server'

import { forbidden, getCaller, notFound, unauthorized } from '@/lib/auth'
import { getVisiblePayment, approvePayment } from '@/lib/payment-service'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/payments/:paymentId/approve — managers only.
 * Rechecks, under the lease row lock, that the amount does not exceed the
 * lease's remaining balance (422, refuse, stays pending), then allocates the
 * payment to the lease's invoices. Two concurrent approvals serialize on the
 * lease row lock; the second sees the payment is no longer pending and gets
 * 409 — a payment can never be allocated twice.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const caller = await getCaller()
  if (caller === null) return unauthorized()
  if (caller.role !== 'manager') return forbidden()

  const { paymentId } = await params
  if (!UUID_RE.test(paymentId)) return notFound()

  const payment = await getVisiblePayment(caller.orgId, paymentId)
  if (payment === null) return notFound() // another organization's: never revealed

  const result = await approvePayment({ payment, orgId: caller.orgId, actorId: caller.userId })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ status: result.value.status })
}
