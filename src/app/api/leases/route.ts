import { NextResponse } from 'next/server'

import { badRequest, forbidden, getCaller, unauthorized } from '@/lib/auth'
import { createLease } from '@/lib/lease-service'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface CreateLeaseBody {
  unitId: string
  tenantId: string
  startDate: string
  endDate: string
  monthlyRentSen: number
  depositSen: number
}

/**
 * POST /api/leases — managers only. The database's exclusion constraint on
 * (unit_id, daterange(start_date, end_date, '[]')) guarantees leases on the
 * same unit never overlap even when two requests arrive at the same moment;
 * the loser commits second and gets 409.
 */
export async function POST(request: Request) {
  const caller = await getCaller()
  if (caller === null) return unauthorized()
  if (caller.role !== 'manager') return forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('Request body must be JSON')
  }

  const parsed = parseBody(body)
  if (typeof parsed === 'string') return badRequest(parsed)

  const result = await createLease({ ...parsed, orgId: caller.orgId, actorId: caller.userId })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ id: result.value.id }, { status: 201 })
}

function parseBody(body: unknown): CreateLeaseBody | string {
  if (typeof body !== 'object' || body === null) return 'Request body must be a JSON object'
  const b = body as Record<string, unknown>
  const required = ['unitId', 'tenantId', 'startDate', 'endDate', 'monthlyRentSen', 'depositSen']
  for (const key of required) {
    if (!(key in b)) return `Missing field: ${key}`
  }
  if (typeof b.unitId !== 'string' || !UUID_RE.test(b.unitId)) return 'unitId must be a UUID'
  if (typeof b.tenantId !== 'string' || !UUID_RE.test(b.tenantId)) return 'tenantId must be a UUID'
  if (typeof b.startDate !== 'string') return 'startDate must be a string'
  if (typeof b.endDate !== 'string') return 'endDate must be a string'
  if (typeof b.monthlyRentSen !== 'number') return 'monthlyRentSen must be a number'
  if (typeof b.depositSen !== 'number') return 'depositSen must be a number'
  return {
    unitId: b.unitId,
    tenantId: b.tenantId,
    startDate: b.startDate,
    endDate: b.endDate,
    monthlyRentSen: b.monthlyRentSen,
    depositSen: b.depositSen,
  }
}
