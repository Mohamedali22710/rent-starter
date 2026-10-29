import { Prisma } from '@prisma/client'

import { prisma } from './prisma'

/**
 * Read-only reports for the dashboard and the collections endpoint. The SQL
 * here is the single implementation the route handler and the dashboard page
 * share.
 */

const MONTH_RE = /^\d{4}-\d{2}$/

export function isValidMonthRange(from: unknown, to: unknown): boolean {
  return (
    typeof from === 'string' &&
    typeof to === 'string' &&
    MONTH_RE.test(from) &&
    MONTH_RE.test(to) &&
    from <= to
  )
}

/**
 * Approved payments per calendar month of received_at in Malaysia time,
 * including months with nothing collected, one entry per month in order.
 */
export async function collectionsReport(
  orgId: string,
  from: string,
  to: string,
): Promise<{ month: string; collectedSen: number }[]> {
  const rows = await prisma.$queryRaw<{ month: string; collected_sen: bigint }[]>(
    Prisma.sql`
      with months(m) as (
        select generate_series(${from}-01, ${to}-01, interval '1 month')::date
      )
      select to_char(m, 'YYYY-MM') as month,
             (select coalesce(sum(amount_sen), 0)
                from payments
               where org_id = ${orgId}::uuid
                 and status = 'approved'
                 and date_trunc('month', received_at at time zone 'Asia/Kuala_Lumpur') = m
             ) as collected_sen
      from months
      order by m
    `,
  )
  return rows.map((r) => ({ month: r.month, collectedSen: Number(r.collected_sen) }))
}

/** The organization's last 6 months ending with the current Malaysia month. */
export async function collectionsReportLast6Months(
  orgId: string,
): Promise<{ month: string; collectedSen: number }[]> {
  const nowMy = new Date(Date.now() + 8 * 3_600_000).toISOString()
  const [y, m] = nowMy.slice(0, 7).split('-').map(Number)
  const startMonthIndex = y * 12 + (m - 1) - 5 // 5 months back, inclusive => 6 rows
  const fy = Math.floor(startMonthIndex / 12)
  const fm = (startMonthIndex % 12) + 1
  const from = `${fy}-${String(fm).padStart(2, '0')}`
  return collectionsReport(orgId, from, `${y}-${String(m).padStart(2, '0')}`)
}

/**
 * Invoices still carrying an unpaid balance whose due date is before today's
 * Malaysia date (the invoiceStatus 'overdue' rule: due < today, today
 * inclusive of the due date itself).
 */
export async function overdueInvoiceCount(orgId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    select count(*) as n
      from invoices i
     where i.org_id = ${orgId}::uuid
       and i.due_date < (now() at time zone 'Asia/Kuala_Lumpur')::date
       and i.amount_sen > (
         select coalesce(sum(a.amount_sen), 0)
           from payment_allocations a
          where a.invoice_id = i.id
       )
  `)
  return Number(rows[0]?.n ?? 0)
}
