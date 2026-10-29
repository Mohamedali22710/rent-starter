import { notFound, redirect } from 'next/navigation'

import { TenantHeader } from '@/components/app-header'
import { PhoneEdit } from '@/components/phone-edit'
import { PayNowButton } from '@/components/pay-now'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge, DataTable, Td, Th } from '@/components/table-bits'
import { malaysiaDateOf } from '@/lib/billing'
import { getCaller } from '@/lib/auth'
import { dueNowSen } from '@/lib/due-now'
import { formatMyDate, formatMyDateTime, formatSen, humanizeStatus } from '@/lib/format'
import { loadLeaseView } from '@/lib/lease-view'
import { prisma } from '@/lib/prisma'


/**
 * The tenant portal: their profile (phone editable), their leases, invoices
 * with statuses, payments and the amount due now, with Pay now.
 */
export default async function PortalPage() {
  const caller = await getCaller()
  if (caller === null) redirect('/login')
  if (caller.role !== 'tenant') redirect('/dashboard')

  const tenant = await prisma.tenant.findUnique({ where: { id: caller.tenantId ?? undefined } })
  if (tenant === null) notFound()

  const leases = await prisma.lease.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })

  const view = leases.length > 0 ? await loadLeaseView(leases[0].id, new Date()) : null
  const dueNow = view === null ? 0 : dueNowSen(view.invoices.map(invoice => ({ dueDate: invoice.dueDate, amountSen: invoice.amountSen, paidSen: invoice.paidSen })), malaysiaDateOf(new Date()))

  return (
    <>
      <TenantHeader name={tenant.fullName} />
      <main className="mx-auto w-full max-w-4xl flex-1 grid gap-6 px-4 py-6 content-start">
        <Card>
          <CardHeader>
            <CardTitle>{tenant.fullName}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Email:</span> {tenant.email}
            </p>
            <PhoneEdit tenantId={tenant.id} initialPhone={tenant.phone ?? ''} />
          </CardContent>
        </Card>

        {view === null && (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              You have no leases yet. Ask your property manager for access.
            </CardContent>
          </Card>
        )}

        {view !== null && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Your lease</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Unit:</span> {view.lease.unitId.slice(0, 8)}
                </p>
                <p>
                  <span className="text-muted-foreground">Period:</span> {formatMyDate(view.lease.startDate)} –{' '}
                  {formatMyDate(view.lease.endDate)}
                </p>
                <p>
                  <span className="text-muted-foreground">Rent / month:</span>{' '}
                  {formatSen(view.lease.monthlyRentSen)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="font-semibold">Due now: {formatSen(dueNow)}</span>
                  <PayNowButton leaseId={view.lease.id} dueNowSen={dueNow} />
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {view !== null && (
          <section className="grid gap-2">
            <h2 className="font-semibold">Invoices</h2>
            <DataTable>
              <thead className="border-b">
                <tr>
                  <Th>Kind / period</Th>
                  <Th>Due</Th>
                  <Th>Amount</Th>
                  <Th>Paid</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {view.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b last:border-0">
                    <Td>{invoice.kind === 'deposit' ? 'Deposit' : `Rent #${invoice.periodIndex}`}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatMyDate(invoice.dueDate)}</Td>
                    <Td className="tabular-nums">{formatSen(invoice.amountSen)}</Td>
                    <Td className="tabular-nums">{formatSen(invoice.paidSen)}</Td>
                    <Td>
                      <StatusBadge status={invoice.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </section>
        )}

        {view !== null && (
          <section className="grid gap-2">
            <h2 className="font-semibold">Your payments</h2>
            <DataTable>
              <thead className="border-b">
                <tr>
                  <Th>Amount</Th>
                  <Th>Method</Th>
                  <Th>Status</Th>
                  <Th>Received (MYT)</Th>
                </tr>
              </thead>
              <tbody>
                {view.payments.length === 0 ? (
                  <tr>
                    <Td className="text-muted-foreground">No payments yet.</Td>
                  </tr>
                ) : (
                  view.payments.map((payment) => (
                    <tr key={payment.id} className="border-b last:border-0">
                      <Td className="tabular-nums">{formatSen(payment.amountSen)}</Td>
                      <Td>{humanizeStatus(payment.method)}</Td>
                      <Td>
                        <StatusBadge status={payment.status} />
                      </Td>
                      <Td className="whitespace-nowrap tabular-nums">{formatMyDateTime(payment.receivedAt)}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </DataTable>
          </section>
        )}
      </main>
    </>
  )
}
