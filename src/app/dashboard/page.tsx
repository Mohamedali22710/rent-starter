import Link from 'next/link'

import { AppHeader } from '@/components/app-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatSen } from '@/lib/format'
import { requireCaller } from '@/lib/guard'
import { collectionsReportLast6Months, overdueInvoiceCount } from '@/lib/reports'


/** Staff/manager dashboard: overdue count + the last 6 months' collections. */
export default async function DashboardPage() {
  const caller = await requireCaller(['manager', 'staff'])
  const [overdue, report] = await Promise.all([
    overdueInvoiceCount(caller.orgId),
    collectionsReportLast6Months(caller.orgId),
  ])
  const max = Math.max(1, ...report.map((r) => r.collectedSen))

  return (
    <>
      <AppHeader caller={caller} title="Dashboard" />
      <main className="mx-auto w-full max-w-6xl flex-1 grid gap-6 px-4 py-6 content-start">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Overdue invoices</CardTitle>
              <CardDescription>Invoices with an unpaid balance, past their due date</CardDescription>
            </CardHeader>
            <CardContent>
              <p className={`text-4xl font-semibold ${overdue > 0 ? 'text-red-600' : ''}`}>{overdue}</p>
              {overdue > 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Follow up on the invoices on the lease pages.
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Nothing is overdue. Good.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Collections (last 6 months)</CardTitle>
              <CardDescription>Approved payments, by month received (Malaysia time)</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {report.map((row) => (
                  <li key={row.month} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-sm tabular-nums text-muted-foreground">{row.month}</span>
                    <span
                      className="h-4 rounded bg-primary/80"
                      style={{ width: `${Math.round((row.collectedSen / max) * 100)}%` }}
                    />
                    <span className="text-sm tabular-nums">{formatSen(row.collectedSen)}</span>
                  </li>
                ))}
                {report.length === 0 && <li className="text-sm text-muted-foreground">No data yet.</li>}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Leases</CardTitle>
            <CardDescription>Open a lease to see invoices and payments</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/leases" className="text-primary underline-offset-4 hover:underline">
              Go to the leases list →
            </Link>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
