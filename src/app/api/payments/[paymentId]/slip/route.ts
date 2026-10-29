import { NextResponse } from 'next/server'

import { forbidden, getCaller, notFound, unauthorized } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getVisiblePayment } from '@/lib/payment-service'
import { signedSlipUrl } from '@/lib/slip-storage'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/payments/:paymentId/slip — a short-lived signed URL for the
 * payment's bank-transfer slip. Staff and managers of the payment's
 * organization only (tenants 403: they can read payment rows but never slip
 * files). Another organization's payment is 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const caller = await getCaller()
  if (caller === null) return unauthorized()
  if (caller.role === 'tenant') return forbidden()

  const { paymentId } = await params
  if (!UUID_RE.test(paymentId)) return notFound()

  const payment = await getVisiblePayment(caller.orgId, paymentId)
  if (payment === null) return notFound()

  const paymentRow = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { slipPath: true },
  })
  if (paymentRow === null || paymentRow.slipPath === null) return notFound()

  const url = await signedSlipUrl(paymentRow.slipPath, 300)
  if (url === null) return notFound()

  return NextResponse.json({ url })
}
