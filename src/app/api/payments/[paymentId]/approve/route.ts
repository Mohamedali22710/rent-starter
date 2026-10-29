import { NextResponse } from 'next/server'

import { allocatePayment } from '@/lib/allocation'
import { forbidden, getCaller, notFound, serverError, unauthorized } from '@/lib/auth'
import { CapExceededError, LeaseIsGoneError, NotPendingError, lockLease, remainingBalance } from '@/lib/lease-lock'
import { prisma } from '@/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/payments/:paymentId/approve — managers only.
 * Approves a pending_verification payment: rechecks, under the lease row
 * lock, that the amount does not exceed the lease's remaining balance (422,
 * refuse, stays pending), then allocates it to the lease's invoices and
 * writes the audit row in the same transaction. Two concurrent approvals of
 * the same payment serialize on the lease row lock; the second sees the
 * payment is no longer pending and answers 409 — it can never be allocated
 * twice.
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

      // Recheck at approval time, excluding this payment from the pending
      // total (it is the one being approved now).
      const remaining = await remainingBalance(tx, payment.leaseId, payment.id)
      if (Number(fresh.amountSen) > remaining) {
        throw new CapExceededError('Payment is more than the lease remaining balance')
      }

      await tx.payment.update({ where: { id: payment.id }, data: { status: 'approved' } })
      const plan = await allocatePayment(tx, payment.id)
      await tx.auditLog.create({
        data: {
          orgId: caller.orgId,
          actorId: caller.userId,
          action: 'payment.approved',
          entityId: payment.id,
          details: {
            leaseId: payment.leaseId,
            amountSen: Number(fresh.amountSen),
            unappliedSen: plan.unappliedSen,
          },
        },
      })
    })

    return NextResponse.json({ status: 'approved' })
  } catch (error) {
    if (error instanceof NotPendingError) {
      return NextResponse.json({ error: 'Payment is not pending_verification' }, { status: 409 })
    }
    if (error instanceof CapExceededError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    if (error instanceof LeaseIsGoneError) return notFound()
    console.error('approve payment failed', error)
    return serverError()
  }
}
