import { generateSchedule } from './billing'
import { prisma } from './prisma'

/**
 * Lease creation business logic, shared by POST /api/leases and the seed
 * script so both go through exactly one implementation (brief section 2:
 * the seed must run leases through the app's normal lease creation path).
 */

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 422 | 500; error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CreateLeaseInput {
  orgId: string
  actorId: string
  unitId: string
  tenantId: string
  startDate: string
  endDate: string
  monthlyRentSen: number
  depositSen: number
}

export async function createLease(
  input: CreateLeaseInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!UUID_RE.test(input.unitId)) return badRequest('unitId must be a UUID')
  if (!UUID_RE.test(input.tenantId)) return badRequest('tenantId must be a UUID')

  let schedule
  try {
    schedule = generateSchedule({
      startDate: input.startDate,
      endDate: input.endDate,
      monthlyRentSen: input.monthlyRentSen,
      depositSen: input.depositSen,
    })
  } catch {
    return badRequest('Invalid lease dates or amounts')
  }

  // IDs are untrusted: unit and tenant must belong to the caller's
  // organization (404: do not reveal other organizations' records).
  const [unit, tenant] = await Promise.all([
    prisma.unit.findUnique({ where: { id: input.unitId } }),
    prisma.tenant.findUnique({ where: { id: input.tenantId } }),
  ])
  if (unit === null || unit.orgId !== input.orgId) return notFound()
  if (tenant === null || tenant.orgId !== input.orgId) return notFound()

  try {
    const lease = await prisma.$transaction(async (tx) => {
      const created = await tx.lease.create({
        data: {
          orgId: input.orgId,
          unitId: input.unitId,
          tenantId: input.tenantId,
          startDate: new Date(`${input.startDate}T00:00:00Z`),
          endDate: new Date(`${input.endDate}T00:00:00Z`),
          monthlyRentSen: BigInt(input.monthlyRentSen),
          depositSen: BigInt(input.depositSen),
        },
      })
      await tx.invoice.createMany({
        data: schedule.map((s) => ({
          orgId: input.orgId,
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
          orgId: input.orgId,
          actorId: input.actorId,
          action: 'lease.created',
          entityId: created.id,
          details: {
            unitId: input.unitId,
            tenantId: input.tenantId,
            startDate: input.startDate,
            endDate: input.endDate,
            monthlyRentSen: input.monthlyRentSen,
            depositSen: input.depositSen,
          },
        },
      })
      return created
    })
    return ok({ id: lease.id })
  } catch (error) {
    const message = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : ''
    if (message.includes('leases_no_unit_overlap') || /exclusion constraint/i.test(message)) {
      return { ok: false, status: 409, error: 'A lease overlapping this unit exists' }
    }
    // The overlap constraint is the expected failure; anything else is a bug.
    console.error('lease creation failed', error)
    return { ok: false, status: 500, error: 'Could not create the lease' }
  }
}

function ok<T>(value: T): ServiceResult<T> {
  return { ok: true, value }
}
function badRequest(error: string): ServiceResult<never> {
  return { ok: false, status: 400, error }
}
function notFound(): ServiceResult<never> {
  return { ok: false, status: 404, error: 'Not found' }
}
