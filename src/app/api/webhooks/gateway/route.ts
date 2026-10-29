import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'

import { allocatePayment } from '@/lib/allocation'
import { gatewaySignatureMatches, parseGatewayPaidAt } from '@/lib/gateway'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/webhooks/gateway — the only way a bill is settled (brief 5).
 *
 * application/x-www-form-urlencoded with a HMAC-SHA256 signature over every
 * field except x_signature. Handling:
 * - signature missing/wrong -> 401, nothing else happens
 * - unknown bill id -> 404
 * - paid=true with an amount that is not the bill's -> 422
 * - paid=true on pending/failed -> bill paid + one approved online payment
 *   (received_at = paid_at), allocated, all in one transaction
 * - paid=false on pending -> bill failed
 * - repeated deliveries (any order) -> 200, nothing changes
 *
 * Idempotency: the bill row is locked FOR UPDATE and its status re-read
 * inside the transaction, so the same callback delivered twice at the same
 * moment settles twice ends up as one payment; UNIQUE(gateway_bill_id) on
 * payments is the backstop. A paid bill never goes back.
 *
 * The secret key and whole callback payloads are never logged.
 */

class BillIsGone extends Error {}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return text(400, 'Request must be application/x-www-form-urlencoded')
  }
  const raw = await request.text()
  const fields = Object.fromEntries(new URLSearchParams(raw))

  const key = process.env.GATEWAY_X_SIGNATURE_KEY
  if (!key) return text(500, 'Webhook not configured')
  const provided = fields.x_signature
  if (typeof provided !== 'string' || provided === '' || !gatewaySignatureMatches(fields, key, provided)) {
    return text(401, 'Invalid signature')
  }

  const billId = fields.id
  if (typeof billId !== 'string' || billId === '') return text(400, 'Missing bill id')
  const bill = await prisma.gatewayBill.findUnique({ where: { id: billId } })
  if (bill === null) return text(404, 'Unknown bill')

  if (fields.paid !== 'true' && fields.paid !== 'false') {
    return text(400, 'paid must be true or false')
  }

  if (fields.paid === 'true') {
    const paidAmount = normalizePositiveAmount(fields.paid_amount)
    if (paidAmount === null) return text(400, 'paid_amount must be an integer number of sen')
    if (Number(bill.amountSen) !== paidAmount) {
      return text(
        422,
        `paid_amount does not match the bill amount (${Number(bill.amountSen)} sen)`,
      )
    }
    if (typeof fields.paid_at !== 'string') return text(400, 'Missing paid_at')
    const paidAt = parseGatewayPaidAt(fields.paid_at)
    if (paidAt === null) return text(400, 'paid_at is not a valid instant')

    try {
      await prisma.$transaction(async (tx) => {
        // Lock the bill row: a concurrent repeat delivery waits here, then
        // sees the bill is already paid and does nothing.
        const locked = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`select id from gateway_bills where id = ${bill.id}::uuid for update`,
        )
        if (locked.length === 0) throw new BillIsGone()

        const fresh = await tx.gatewayBill.findUniqueOrThrow({ where: { id: bill.id } })
        if (fresh.status === 'paid') return // repeat delivery: a paid bill never goes back

        await tx.gatewayBill.update({ where: { id: bill.id }, data: { status: 'paid' } })

        const payment = await tx.payment.create({
          data: {
            orgId: fresh.orgId,
            leaseId: fresh.leaseId,
            amountSen: fresh.amountSen,
            unappliedSen: 0n,
            method: 'online',
            status: 'approved',
            receivedAt: paidAt,
            gatewayBillId: fresh.id,
          },
        })
        await allocatePayment(tx, payment.id)
        await tx.auditLog.create({
          data: {
            orgId: fresh.orgId,
            actorId: null,
            action: 'payment.online_settled',
            entityId: payment.id,
            details: {
              billId: fresh.id,
              leaseId: fresh.leaseId,
              amountSen: Number(fresh.amountSen),
              transactionId: fields.transaction_id ?? null,
              receivedAt: paidAt.toISOString(),
            },
          },
        })
      })
      return text(200, 'ok')
    } catch (error) {
      if (error instanceof BillIsGone) return text(404, 'Unknown bill')
      // Backstop: the same bill must produce at most one payment, ever.
      if (isUniqueViolation(error)) return text(200, 'ok')
      console.error('gateway webhook failed while settling bill')
      return text(500, 'Internal error')
    }
  }

  // paid=false: fail only a pending bill; a paid bill never goes back.
  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`select id from gateway_bills where id = ${bill.id}::uuid for update`,
      )
      if (locked.length === 0) throw new BillIsGone()

      const fresh = await tx.gatewayBill.findUniqueOrThrow({ where: { id: bill.id } })
      if (fresh.status !== 'pending') return
      await tx.gatewayBill.update({ where: { id: bill.id }, data: { status: 'failed' } })
    })
    return text(200, 'ok')
  } catch (error) {
    if (error instanceof BillIsGone) return text(404, 'Unknown bill')
    console.error('gateway webhook failed while failing bill')
    return text(500, 'Internal error')
  }
}

function text(status: number, message: string): NextResponse {
  return new NextResponse(message, { status })
}

function normalizePositiveAmount(value: unknown): number | null {
  if (typeof value !== 'string') return null
  if (!/^\d+$/.test(value)) return null
  return Number(value)
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}
