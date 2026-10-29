import { NextResponse } from 'next/server'

import { badRequest, forbidden, getCaller, notFound, serverError, unauthorized } from '@/lib/auth'
import { generateSchedule } from '@/lib/billing'
import { prisma } from '@/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface CreateLeaseBody {
  unitId: string
  tenantId: string
  startDate: string
  endDate: string
  monthlyRentSen: number
  depositSen: number
}

const OVERLAP_CONSTRAINT = 'leases_no_unit_overlap'

/**
 * POST /api/leases — managers only. Validates the input through
 * generateSchedule, stores the lease and exactly the invoices the schedule
 * returns, all or nothing. The database's exclusion constraint on
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

  let schedule
  try {
    schedule = generateSchedule({
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      monthlyRentSen: parsed.monthlyRentSen,
      depositSen: parsed.depositSen,
    })
  } catch {
    return badRequest('Invalid lease dates or amounts')
  }

  // IDs in the body are untrusted: both unit and tenant must belong to the
  // caller's organization (404: do not reveal other organizations' records).
  const [unit, tenant] = await Promise.all([
    prisma.unit.findUnique({ where: { id: parsed.unitId } }),
    prisma.tenant.findUnique({ where: { id: parsed.tenantId } }),
  ])
  if (unit === null || unit.orgId !== caller.orgId) return notFound()
  if (tenant === null || tenant.orgId !== caller.orgId) return notFound()

  try {
    const lease = await prisma.$transaction(async (tx) => {
      const created = await tx.lease.create({
        data: {
          orgId: caller.orgId,
          unitId: parsed.unitId,
          tenantId: parsed.tenantId,
          startDate: new Date(`${parsed.startDate}T00:00:00Z`),
          endDate: new Date(`${parsed.endDate}T00:00:00Z`),
          monthlyRentSen: BigInt(parsed.monthlyRentSen),
          depositSen: BigInt(parsed.depositSen),
        },
      })
      await tx.invoice.createMany({
        data: schedule.map((s) => ({
          orgId: caller.orgId,
          leaseId: created.id,
          kind: s.kind,
          periodIndex: s.periodIndex,
          periodStart: s.periodStart === null ? null : new Date(`${s.periodStart}T00:00:00Z`),
          periodEnd: s.periodEnd === null ? null : new Date(`${s.periodEnd}T00:00:00Z`),
          dueDate: new Date(`${s.dueDate}T00:00:00Z`),
          amountSen: BigInt(s.amountSen),
        })),
      })
      await tx.auditLog.create({
        data: {
          orgId: caller.orgId,
          actorId: caller.userId,
          action: 'lease.created',
          entityId: created.id,
          details: {
            unitId: parsed.unitId,
            tenantId: parsed.tenantId,
            startDate: parsed.startDate,
            endDate: parsed.endDate,
            monthlyRentSen: parsed.monthlyRentSen,
            depositSen: parsed.depositSen,
          },
        },
      })
      return created
    })

    return NextResponse.json({ id: lease.id }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : ''
    if (message.includes(OVERLAP_CONSTRAINT) || /exclusion constraint/i.test(message)) {
      return NextResponse.json({ error: 'A lease overlapping this unit exists' }, { status: 409 })
    }
    // The overlap constraint is the expected failure; anything else is a bug.
    console.error('lease creation failed', error)
    return serverError()
  }
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
