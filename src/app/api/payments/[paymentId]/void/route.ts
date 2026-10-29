import { NextResponse } from 'next/server'

import { forbidden, getCaller, notFound, unauthorized } from '@/lib/auth'
import { getVisiblePayment, voidPayment } from '@/lib/payment-service'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/payments/:paymentId/void — managers only. Voids an approved
 * payment with a reason of at least 5 characters: the payment's allocations
 * are removed (reopening the invoices it had paid), other payments'
 * allocations are untouched, the payment is never deleted and its whole
 * amount becomes unapplied.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const caller = await getCaller()
  if (caller === null) return unauthorized()
  if (caller.role !== 'manager') return forbidden()

  const { paymentId } = await params
  if (!UUID_RE.test(paymentId)) return notFound()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'missing reason' }, { status: 400 })
  }
  const reason = readReason(body)
  if (reason === false) return NextResponse.json({ error: 'missing reason' }, { status: 400 })

  const payment = await getVisiblePayment(caller.orgId, paymentId)
  if (payment === null) return notFound()

  const result = await voidPayment({
    payment,
    reason,
    orgId: caller.orgId,
    actorId: caller.userId,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ status: result.value.status })
}

/** A valid reason is a string of at least 5 non-whitespace characters. */
function readReason(body: unknown): string | false {
  if (typeof body !== 'object' || body === null) return false
  const value = (body as { reason?: unknown }).reason
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length >= 5 ? trimmed : false
}
