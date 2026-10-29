import { allocatePayment } from './allocation'
import { prisma } from './prisma'
import {
  CapExceededError,
  LeaseIsGoneError,
  NotApprovedError,
  NotPendingError,
  lockLease,
  remainingBalance,
} from './lease-lock'
import { deleteSlip, slipExists } from './slip-storage'

import type { ServiceResult } from './lease-service'

/**
 * Payment business logic (brief sections 4 and 5), shared by the route
 * handlers and the seed script so the app has one implementation of
 * recording, approving, rejecting and voiding.
 *
 * Every mutation:
 *  - authenticates the caller outside (routes do that) and checks org,
 *  - locks the lease row SELECT ... FOR UPDATE for the whole transaction,
 *    so two staff recording at the same moment cannot both pass the cap and a
 *    payment approved twice at once is allocated once,
 *  - writes the audit row inside the same transaction (all or nothing).
 */

export interface ProductionSummary {
  id: string
  status: string
}

export async function getVisiblePayment(
  orgId: string | null,
  paymentId: string,
): Promise<{ id: string; leaseId: string; orgId: string } | null> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, leaseId: true, orgId: true },
  })
  if (payment === null) return null
  if (orgId !== null && payment.orgId !== orgId) return null
  return payment
}

export interface RecordPaymentInput {
  leaseId: string
  orgId: string
  actorId: string
  actorRole: 'manager' | 'staff'
  amountSen: number
  method: 'cash' | 'bank_transfer'
  receivedAt: Date
  slipPath?: string
}

/** Worker also answers 400 for a missing/inexistent slip. */
export async function recordPayment(
  input: RecordPaymentInput,
): Promise<ServiceResult<ProductionSummary>> {
  // A bank transfer needs a slip: a path in the caller's own organization's
  // folder, pointing at an existing file.
  if (input.method === 'bank_transfer' && input.slipPath === undefined) {
    return { ok: false, status: 400, error: 'A bank transfer payment needs a slip' }
  }
  if (input.slipPath !== undefined) {
    if (!input.slipPath.startsWith(`${input.orgId}/`)) {
      return { ok: false, status: 400, error: 'The slip must be in your own organization folder' }
    }
    if (!(await slipExists(input.slipPath))) {
      return { ok: false, status: 400, error: 'The slip file does not exist' }
    }
  }

  // Exit early for a lease we cannot see (another organization's is 404).
  const visibleLease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: { id: true, orgId: true },
  })
  if (visibleLease === null || visibleLease.orgId !== input.orgId) {
    return { ok: false, status: 404, error: 'Not found' }
  }

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const lease = await lockLease(tx, input.leaseId)
      if (lease === null || lease.orgId !== input.orgId) throw new LeaseIsGoneError()

      const remaining = await remainingBalance(tx, input.leaseId)
      if (input.amountSen > remaining) {
        throw new CapExceededError('Payment is more than the lease remaining balance')
      }

      const approvedImmediately = input.actorRole === 'manager'
      const created = await tx.payment.create({
        data: {
          orgId: input.orgId,
          leaseId: input.leaseId,
          amountSen: BigInt(input.amountSen),
          method: input.method,
          status: approvedImmediately ? 'approved' : 'pending_verification',
          receivedAt: input.receivedAt,
          slipPath: input.slipPath ?? null,
          createdBy: input.actorId,
        },
      })
      await tx.auditLog.create({
        data: {
          orgId: input.orgId,
          actorId: input.actorId,
          action: 'payment.recorded',
          entityId: created.id,
          details: {
            leaseId: input.leaseId,
            amountSen: input.amountSen,
            method: input.method,
            receivedAt: input.receivedAt.toISOString(),
          },
        },
      })
      if (approvedImmediately) {
        const plan = await allocatePayment(tx, created.id)
        await tx.auditLog.create({
          data: {
            orgId: input.orgId,
            actorId: input.actorId,
            action: 'payment.approved',
            entityId: created.id,
            details: {
              leaseId: input.leaseId,
              amountSen: input.amountSen,
              unappliedSen: plan.unappliedSen,
              auto: true,
            },
          },
        })
      }
      return created
    })
    return { ok: true, value: { id: payment.id, status: payment.status } }
  } catch (error) {
    if (error instanceof CapExceededError) {
      // Recording failed after the slip upload: the file must not be left behind.
      if (input.slipPath !== undefined) {
        try {
          await deleteSlip(input.slipPath)
        } catch (deleteError) {
          console.error('failed to clean up slip after refused payment', deleteError)
        }
      }
      return { ok: false, status: 422, error: error.message }
    }
    if (error instanceof LeaseIsGoneError) return { ok: false, status: 404, error: 'Not found' }
    console.error('payment recording failed', error)
    return { ok: false, status: 500, error: 'Could not record the payment' }
  }
}

export interface ManagerActionInput {
  payment: { id: string; leaseId: string; orgId: string }
  orgId: string
  actorId: string
}

export async function approvePayment({
  payment,
  orgId,
  actorId,
}: ManagerActionInput): Promise<ServiceResult<{ status: 'approved' }>> {
  try {
    await prisma.$transaction(async (tx) => {
      const lease = await lockLease(tx, payment.leaseId)
      if (lease === null || lease.orgId !== orgId) throw new LeaseIsGoneError()

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
          orgId,
          actorId,
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
    return { ok: true, value: { status: 'approved' } }
  } catch (error) {
    if (error instanceof NotPendingError) {
      return { ok: false, status: 409, error: 'Payment is not pending_verification' }
    }
    if (error instanceof CapExceededError) {
      return { ok: false, status: 422, error: error.message }
    }
    if (error instanceof LeaseIsGoneError) return { ok: false, status: 404, error: 'Not found' }
    console.error('approve payment failed', error)
    return { ok: false, status: 500, error: 'Could not approve the payment' }
  }
}

export async function rejectPayment({
  payment,
  reason,
  orgId,
  actorId,
}: ManagerActionInput & { reason: string }): Promise<ServiceResult<{ status: 'rejected' }>> {
  try {
    await prisma.$transaction(async (tx) => {
      const lease = await lockLease(tx, payment.leaseId)
      if (lease === null || lease.orgId !== orgId) throw new LeaseIsGoneError()

      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } })
      if (fresh.status !== 'pending_verification') throw new NotPendingError()

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'rejected', rejectedReason: reason },
      })
      await tx.auditLog.create({
        data: {
          orgId,
          actorId,
          action: 'payment.rejected',
          entityId: payment.id,
          details: { leaseId: payment.leaseId, amountSen: Number(fresh.amountSen), reason },
        },
      })
    })
    return { ok: true, value: { status: 'rejected' } }
  } catch (error) {
    return translateManagerActionError(error, 'reject', 'pending_verification')
  }
}

export async function voidPayment({
  payment,
  reason,
  orgId,
  actorId,
}: ManagerActionInput & { reason: string }): Promise<ServiceResult<{ status: 'voided' }>> {
  try {
    await prisma.$transaction(async (tx) => {
      const lease = await lockLease(tx, payment.leaseId)
      if (lease === null || lease.orgId !== orgId) throw new LeaseIsGoneError()

      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } })
      if (fresh.status !== 'approved') throw new NotApprovedError()

      await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } })
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'voided', voidedReason: reason, unappliedSen: fresh.amountSen },
      })
      await tx.auditLog.create({
        data: {
          orgId,
          actorId,
          action: 'payment.voided',
          entityId: payment.id,
          details: { leaseId: payment.leaseId, amountSen: Number(fresh.amountSen), reason },
        },
      })
    })
    return { ok: true, value: { status: 'voided' } }
  } catch (error) {
    return translateManagerActionError(error, 'void', 'approved')
  }
}

function translateManagerActionError(
  error: unknown,
  action: string,
  requiredStatus: string,
): ServiceResult<never> {
  if (error instanceof NotPendingError) {
    return { ok: false, status: 409, error: `Payment is not ${requiredStatus}` }
  }
  if (error instanceof NotApprovedError) {
    return { ok: false, status: 409, error: `Payment is not ${requiredStatus}` }
  }
  if (error instanceof CapExceededError) {
    return { ok: false, status: 422, error: error.message }
  }
  if (error instanceof LeaseIsGoneError) return { ok: false, status: 404, error: 'Not found' }
  console.error(`${action} payment failed`, error)
  return { ok: false, status: 500, error: 'Request failed' }
}
