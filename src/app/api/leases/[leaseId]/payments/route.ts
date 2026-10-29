import { NextResponse } from 'next/server'

import { badRequest, forbidden, getCaller, notFound, unauthorized } from '@/lib/auth'
import { recordPayment } from '@/lib/payment-service'

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

  const receivedAt = new Date(parsed.receivedAt)
  if (Number.isNaN(receivedAt.getTime())) {
    return badRequest('receivedAt must be an ISO 8601 instant')
  }

  const result = await recordPayment({
    leaseId,
    orgId: caller.orgId,
    actorId: caller.userId,
    actorRole: caller.role === 'manager' ? 'manager' : 'staff',
    amountSen: parsed.amountSen,
    method: parsed.method,
    receivedAt,
    slipPath: parsed.slipPath,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(
    { id: result.value.id, status: result.value.status },
    { status: 201 },
  )
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
