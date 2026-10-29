import { NextResponse } from 'next/server'

import { allocatePayment } from '@/lib/allocation'
import { badRequest, forbidden, getCaller, notFound, serverError, unauthorized } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  CapExceededError,
  LeaseIsGoneError,
  lockLease,
  remainingBalance,
} from '@/lib/lease-lock'
import { deleteSlip, slipExists } from '@/lib/slip-storage'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RecordPaymentBody {
  amountSen: number
  method: 'cash' | 'bank_transfer'
  receivedAt: string
  slipPath?: string
}

/**
 * POST /api/leases/:leaseId/payments — staff and managers record cash or bank
 * transfer payments. A manager's payment is approved (and allocated)
 * immediately; a staff payment stays pending_verification until a manager
 * approves it. The amount may not exceed the lease's remaining balance minus
 * its pending payments; the lease row is locked FOR UPDATE for the whole
 * transaction so concurrent recordings cannot both pass the cap.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ leaseId: string }> },
) {
  const caller = await getCaller()
  if (caller === null) return unauthorized()
  if (caller.role === 'tenant') return forbidden() // recording is staff/manager only

  const { leaseId } = await params
  if (!UUID_RE.test(leaseId)) return notFound()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('Request body must be JSON')
  }
  const parsed = parseBody(body)
  if (typeof parsed === 'string') return badRequest(parsed)

  // Visibility first: another organization's lease is 404.
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { id: true, orgId: true },
  })
  if (lease === null || lease.orgId !== caller.orgId) return notFound()

  // A bank transfer needs a slip: a path in the caller's own organization's
  // folder, pointing at an existing file.
  if (parsed.method === 'bank_transfer' && parsed.slipPath === undefined) {
    return badRequest('A bank transfer payment needs a slip')
  }
  if (parsed.slipPath !== undefined) {
    if (!parsed.slipPath.startsWith(`${caller.orgId}/`)) {
      return badRequest('The slip must be in your own organization folder')
    }
    if (!(await slipExists(parsed.slipPath))) {
      return badRequest('The slip file does not exist')
    }
  }

  const receivedAt = new Date(parsed.receivedAt)
  if (Number.isNaN(receivedAt.getTime())) return badRequest('receivedAt must be an ISO 8601 instant')

  try {
    const created = await prisma.$transaction(async (tx) => {
      const lockedLease = await lockLease(tx, lease.id)
      if (lockedLease === null || lockedLease.orgId !== caller.orgId) {
        throw new LeaseIsGoneError()
      }

      const remaining = await remainingBalance(tx, lease.id)
      if (parsed.amountSen > remaining) {
        throw new CapExceededError('Payment is more than the lease remaining balance')
      }

      const approvedImmediately = caller.role === 'manager'
      const payment = await tx.payment.create({
        data: {
          orgId: caller.orgId,
          leaseId: lease.id,
          amountSen: BigInt(parsed.amountSen),
          method: parsed.method,
          status: approvedImmediately ? 'approved' : 'pending_verification',
          receivedAt,
          slipPath: parsed.slipPath ?? null,
          createdBy: caller.userId,
        },
      })
      await tx.auditLog.create({
        data: {
          orgId: caller.orgId,
          actorId: caller.userId,
          action: 'payment.recorded',
          entityId: payment.id,
          details: {
            leaseId: lease.id,
            amountSen: parsed.amountSen,
            method: parsed.method,
            receivedAt: receivedAt.toISOString(),
          },
        },
      })
      if (approvedImmediately) {
        const plan = await allocatePayment(tx, payment.id)
        await tx.auditLog.create({
          data: {
            orgId: caller.orgId,
            actorId: caller.userId,
            action: 'payment.approved',
            entityId: payment.id,
            details: {
              leaseId: lease.id,
              amountSen: parsed.amountSen,
              unappliedSen: plan.unappliedSen,
              auto: true,
            },
          },
        })
      }
      return payment
    })

    return NextResponse.json({ id: created.id, status: created.status }, { status: 201 })
  } catch (error) {
    if (error instanceof CapExceededError) {
      // The recording failed after the slip upload, so the file most not be
      // left behind. Delete it (best effort: it is the caller's own file).
      if (parsed.slipPath !== undefined) {
        try {
          await deleteSlip(parsed.slipPath)
        } catch (deleteError) {
          console.error('failed to clean up slip after refused payment', deleteError)
        }
      }
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    if (error instanceof LeaseIsGoneError) return notFound()
    return serverError()
  }
}

function parseBody(body: unknown): RecordPaymentBody | string {
  if (typeof body !== 'object' || body === null) return 'Request body must be a JSON object'
  const b = body as Record<string, unknown>
  const required = ['amountSen', 'method', 'receivedAt']
  for (const key of required) {
    if (!(key in b)) return `Missing field: ${key}`
  }
  if (typeof b.amountSen !== 'number' || !Number.isInteger(b.amountSen) || b.amountSen <= 0) {
    return 'amountSen must be a positive integer number of sen'
  }
  if (b.method !== 'cash' && b.method !== 'bank_transfer') {
    return "method must be 'cash' or 'bank_transfer'"
  }
  if (typeof b.receivedAt !== 'string') return 'receivedAt must be a string'
  if (b.slipPath !== undefined && (typeof b.slipPath !== 'string' || b.slipPath === '')) {
    return 'slipPath must be a non-empty string'
  }
  return {
    amountSen: b.amountSen,
    method: b.method,
    receivedAt: b.receivedAt,
    slipPath: b.slipPath as string | undefined,
  }
}
