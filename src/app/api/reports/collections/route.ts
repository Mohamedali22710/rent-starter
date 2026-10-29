import { NextResponse } from 'next/server'

import { badRequest, forbidden, getCaller, unauthorized } from '@/lib/auth'
import { collectionsReport, isValidMonthRange } from '@/lib/reports'

/**
 * GET /api/reports/collections?from=YYYY-MM&to=YYYY-MM — staff and managers.
 * Approved payments per calendar month of received_at in Malaysia time,
 * including months with nothing collected, one entry per month in order.
 */
export async function GET(request: Request) {
  const caller = await getCaller()
  if (caller === null) return unauthorized()
  if (caller.role === 'tenant') return forbidden()

  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (from === null || to === null || !isValidMonthRange(from, to)) {
    return badRequest('from and to must be YYYY-MM with from not after to')
  }

  // Monthly cap keeps the generated series bounded.
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  if ((ty - fy) * 12 + (tm - fm) + 1 > 240) {
    return badRequest('Range is too long')
  }

  const report = await collectionsReport(caller.orgId, from, to)
  return NextResponse.json(report)
}
