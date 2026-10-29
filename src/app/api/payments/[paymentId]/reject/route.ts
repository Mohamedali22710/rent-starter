import { NextResponse } from 'next/server'

import { forbidden, getCaller, notFound, serverError, unauthorized } from '@/lib/auth'
import { LeaseIsGoneError, NotPendingError, lockLease } from '@/lib/lease-lock'
import { prisma } from '@/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/payments/:paymentId/reject — managers only. Rejects a
 * pending_verification payment with a reason of at least 5 characters.
 * Leave-is-pending does not apply here: a rejected payment keeps no claim on
 * the balance (only pending payments do, and rejected is not pending).
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
  const reason = isReason((body as { reason?: unknown })?.reason)
  if (reason === false) {
    return NextResponse.json({ error: 'missing reason' }, { status: 400 })
  }

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (payment === null || payment.orgId !== caller.orgId) return notFound()

  try {
    await prisma.$transaction(async (tx) => {
      const lockedLease = await lockLease(tx, payment.leaseId)
      if (lockedLease === null || lockedLease.orgId !== caller.orgId) {
        throw new LeaseIsGoneError()
      }

      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } })
      if (fresh.status !== 'pending_verification') throw new NotPendingError()

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'rejected', rejectedReason: reason },
      })
      await tx.auditLog.create({
        data: {
          orgId: caller.orgId,
          actorId: caller.userId,
          action: 'payment.rejected',
          entityId: payment.id,
          details: { leaseId: payment.leaseId, amountSen: Number(fresh.amountSen), reason },
        },
      })
    })

    return NextResponse.json({ status: 'rejected' })
  } catch (error) {
    if (error instanceof NotPendingError) {
      return NextResponse.json({ error: 'Payment is not pending_verification' }, { status: 409 })
    }
    if (error instanceof LeaseIsGoneError) return notFound()
    console.error('reject payment failed', error)
    return serverError()
  }
}

/** A valid reason is a string of at least 5 non-whitespace characters. */
function isReason(value: unknown): string | false {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length < 5) return false
  return trimmed
}
