import { Prisma } from '@prisma/client'

/**
 * Per-lease serialization and balance math used by every payment mutation.
 *
 * Every payment transaction takes SELECT ... FOR UPDATE on the lease row
 * first: payments recorded on the same lease, approvals of its payments and
 * voids all serialize behind that row lock, so two staff members recording
 * payments at the same moment cannot exceed the cap together, and a payment
 * approved twice at once is allocated once.
 */

export class CapExceededError extends Error {
  readonly code: 'CAP_EXCEEDED'
  constructor(message: string) {
    super(message)
    this.code = 'CAP_EXCEEDED'
  }
}

export class LeaseIsGoneError extends Error {
  readonly code: 'LEASE_IS_GONE'
  constructor() {
    super('lease not found')
    this.code = 'LEASE_IS_GONE'
  }
}

/** The payment was not pending_verification when we tried to approve/reject. */
export class NotPendingError extends Error {
  readonly code: 'NOT_PENDING'
  constructor() {
    super('payment is not pending_verification')
    this.code = 'NOT_PENDING'
  }
}

/** The payment was not approved when we tried to void it. */
export class NotApprovedError extends Error {
  readonly code: 'NOT_APPROVED'
  constructor() {
    super('payment is not approved')
    this.code = 'NOT_APPROVED'
  }
}

/**
 * Lock the lease row for the rest of the transaction. Returns null when the
 * lease does not exist (the caller answers 404 without revealing anything).
 */
export async function lockLease(
  tx: Prisma.TransactionClient,
  leaseId: string,
): Promise<{ orgId: string } | null> {
  const rows = await tx.$queryRaw<{ org_id: string }[]>(
    Prisma.sql`select org_id from leases where id = ${leaseId}::uuid for update`,
  )
  if (rows.length === 0) return null
  return { orgId: rows[0].org_id }
}

/**
 * The lease's remaining balance (brief section 4):
 *   total of all its invoices
 *   minus everything allocated to them (approved payments only carry
 *   allocations; voiding removes them),
 *   minus the total of the lease's payments still pending_verification
 *   (optionally excluding one payment, e.g. the one being approved now).
 * Unapplied money on approved online payments is NOT subtracted: it was never
 * allocated to an invoice.
 */
export async function remainingBalance(
  tx: Prisma.TransactionClient,
  leaseId: string,
  excludePaymentId?: string,
): Promise<number> {
  const exclude = excludePaymentId ?? ''
  const rows = await tx.$queryRaw<{
    invoiced_sen: bigint
    allocated_sen: bigint
    pending_sen: bigint
  }[]>(Prisma.sql`
    select
      (select coalesce(sum(amount_sen), 0)
         from invoices
        where lease_id = ${leaseId}::uuid) as invoiced_sen,
      (select coalesce(sum(a.amount_sen), 0)
         from payment_allocations a
         join payments p on p.id = a.payment_id
        where p.lease_id = ${leaseId}::uuid and p.status = 'approved') as allocated_sen,
      (select coalesce(sum(p.amount_sen), 0)
         from payments p
        where p.lease_id = ${leaseId}::uuid
          and p.status = 'pending_verification'
          and (${exclude} = '' or p.id <> ${exclude}::uuid)) as pending_sen
  `)
  const row = rows[0]
  return Number(row.invoiced_sen) - Number(row.allocated_sen) - Number(row.pending_sen)
}
