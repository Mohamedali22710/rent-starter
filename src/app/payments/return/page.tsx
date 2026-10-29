import { redirect } from 'next/navigation'

import { StatusBadge } from '@/components/table-bits'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getCaller } from '@/lib/auth'
import { formatSen, humanizeStatus } from '@/lib/format'
import { prisma } from '@/lib/prisma'


/**
 * /payments/return?bill_id=...&paid=true — where the gateway sends the tenant
 * back. READ-ONLY: it shows the bill's real status from the database and
 * settles nothing (the webhook is the only thing that settles a bill; the
 * `paid` query parameter here is ignored on purpose).
 */
export default async function PaymentsReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ bill_id?: string; paid?: string }>
}) {
  const caller = await getCaller()
  if (caller === null) redirect('/login')

  const { bill_id: billIdFromQuery } = await searchParams

  const bill =
    typeof billIdFromQuery === 'string' && billIdFromQuery !== ''
      ? await prisma.gatewayBill.findUnique({
          where: { id: billIdFromQuery },
          include: { lease: { include: { tenant: { select: { userId: true, fullName: true } } } } },
        })
      : null

  // Only the bill's own tenant (or their org's staff) may see this page's content.
  const canSee =
    bill !== null &&
    (caller.role === 'tenant'
      ? bill.lease.tenantId === caller.tenantId
      : bill.orgId === caller.orgId)

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        {caller.role === 'tenant' && bill !== null && (
          <CardHeader>
            <CardTitle>{bill.lease.tenant.fullName}</CardTitle>
          </CardHeader>
        )}
        <CardHeader>
          <CardTitle>Payment status</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {bill === null || !canSee ? (
            <>
              <p>Bill not found.</p>
              <p className="text-muted-foreground">
                No bill with this id is visible to your account.
              </p>
            </>
          ) : (
            <>
              <p>
                <span className="text-muted-foreground">Bill id:</span> {bill.id}
              </p>
              <p>
                <span className="text-muted-foreground">Amount:</span>{' '}
                {formatSen(Number(bill.amountSen))}
              </p>
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">Status:</span>
                <StatusBadge status={bill.status} />
              </p>
              <p className="text-muted-foreground text-xs">
                Status is read direct from our database.{' '}
                {humanizeStatus(bill.status) === 'Pending'
                  ? 'If the gateway has not called back yet, check again in a moment.'
                  : 'This is the final, settled state.'}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
