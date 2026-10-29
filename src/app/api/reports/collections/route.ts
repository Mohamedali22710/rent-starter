import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'

import { badRequest, forbidden, getCaller, unauthorized } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const MONTH_RE = /^\d{4}-\d{2}$/

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
  if (from === null || to === null || !MONTH_RE.test(from) || !MONTH_RE.test(to)) {
    return badRequest('from and to must be YYYY-MM')
  }
  if (from > to) return badRequest('from must not be after to')

  const months = monthDiff(from, to) + 1
  if (months > 240) return badRequest('Range is too long')

  // received_at is stored UTC; each payment belongs to the month that starts
  // the day its Malaysia-time month does (UTC+8, no daylight saving).
  const rows = await prisma.$queryRaw<{ month: string; collected_sen: bigint }[]>(
    Prisma.sql`
      with months(m) as (
        select generate_series(${from}-01, ${to}-01, interval '1 month')::date
      )
      select to_char(m, 'YYYY-MM') as month,
             (select coalesce(sum(amount_sen), 0)
                from payments
               where org_id = ${caller.orgId}::uuid
                 and status = 'approved'
                 and date_trunc('month', received_at at time zone 'Asia/Kuala_Lumpur') = m
             ) as collected_sen
      from months
      order by m
    `,
  )

  return NextResponse.json(
    rows.map((r) => ({ month: r.month, collectedSen: Number(r.collected_sen) })),
  )
}

function monthDiff(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}
