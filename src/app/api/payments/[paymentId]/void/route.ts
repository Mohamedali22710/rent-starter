import { NextResponse } from 'next/server'

import { forbidden, getCaller, notFound, serverError, unauthorized } from '@/lib/auth'
import { LeaseIsGoneError, NotApprovedError, lockLease } from '@/lib/lease-lock'
import { prisma } from '@/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/payments/:paymentId/void — managers only. Voids an approved
 * payment with a reason of at least 5 characters: the payment's allocations
 * are removed inside the lease-row-locked transaction, so reopens the
 * invoices it had paid. Other payments' allocations are untouched. The
 * payment is never deleted; its whole amount becomes unapplied.
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
  const reasonHolder = body as { reason?: unknown } | null
  const reason =
    reasonHolder !== null && typeof reasonHolder.reason === 'string' ? reasonHolder.reason.trim() : ''
  if (reason.length < 5) {
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
      if (fresh.status !== 'approved') throw new NotApprovedError()

      await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } })
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'voided', voidedReason: reason, unappliedSen: fresh.amountSen },
      })
      await tx.auditLog.create({
        data: {
          orgId: caller.orgId,
          actorId: caller.userId,
          action: 'payment.voided',
          entityId: payment.id,
          details: { leaseId: payment.leaseId, amountSen: Number(fresh.amountSen), reason },
        },
      })
    })

    return NextResponse.json({ status: 'voided' })
  } catch (error) {
    if (error instanceof NotApprovedError) {
      return NextResponse.json({ error: 'Payment is not approved' }, { status: 409 })
    }
    if (error instanceof LeaseIsGoneError) return notFound()
    console.error('void payment failed', error)
    return serverError()
  }
}
