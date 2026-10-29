import { notFound, redirect } from 'next/navigation'

import { PaymentActions } from '@/components/payment-actions'
import { RecordPaymentForm } from '@/components/record-payment-form'
import { SlipLinkButton } from '@/components/slip-link'
import { AppHeader } from '@/components/app-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge, DataTable, Td, Th } from '@/components/table-bits'
import { getCaller } from '@/lib/auth'
import { formatMyDate, formatMyDateTime, formatSen, humanizeStatus } from '@/lib/format'
import { loadLeaseView } from '@/lib/lease-view'
import { prisma } from '@/lib/prisma'


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Lease page for staff and managers (invoices + payments + actions). */
export default async function LeasePage({ params }: { params: Promise<{ leaseId: string }> }) {
  const { leaseId } = await params
  if (!UUID_RE.test(leaseId)) notFound()

  const caller = await getCaller()
  if (caller === null) redirect('/login')
  if (caller.role === 'tenant') redirect('/portal')

  const owning = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { orgId: true, unit: { select: { name: true } }, tenant: { select: { fullName: true, phone: true } } },
  })
  // Another organization's lease is 404: never revealed.
  if (owning === null || owning.orgId !== caller.orgId) notFound()

  const view = await loadLeaseView(leaseId, new Date())
  if (view === null) notFound()

  const isManager = caller.role === 'manager'
  const invoiced = view.invoices.reduce((sum, i) => sum + i.amountSen, 0)
  const paid = view.invoices.reduce((sum, i) => sum + i.paidSen, 0)

  return (
    <>
      <AppHeader caller={caller} title="Leases" />
      <main className="mx-auto w-full max-w-6xl flex-1 grid gap-6 px-4 py-6 content-start">
        <Card>
          <CardHeader>
            <CardTitle>{owning.unit.name}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>
              <span className="text-muted-foreground">Tenant:</span> {owning.tenant.fullName}
            </p>
            <p>
              <span className="text-muted-foreground">Period:</span> {formatMyDate(view.lease.startDate)} –{' '}
              {formatMyDate(view.lease.endDate)}
            </p>
            <p>
              <span className="text-muted-foreground">Rent / month:</span>{' '}
              {formatSen(view.lease.monthlyRentSen)} ·{' '}
              <span className="text-muted-foreground">Deposit:</span>{' '}
              {formatSen(view.lease.depositSen)}
            </p>
            <p>
              <span className="text-muted-foreground">Invoiced:</span> {formatSen(invoiced)} ·{' '}
              <span className="text-muted-foreground">Paid:</span> {formatSen(paid)} ·{' '}
              <span className="text-muted-foreground">Outstanding:</span>{' '}
              {formatSen(invoiced - paid)}
            </p>
          </CardContent>
        </Card>

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
              {view.invoices.length === 0 ? (
                <tr>
                  <Td className="text-muted-foreground">No invoices.</Td>
                </tr>
              ) : (
                view.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b last:border-0">
                    <Td>
                      {invoice.kind === 'deposit' ? 'Deposit' : `Rent #${invoice.periodIndex}`}
                      {invoice.periodStart !== null && invoice.periodEnd !== null && (
                        <span className="block text-xs tabular-nums text-muted-foreground">
                          {formatMyDate(invoice.periodStart)} – {formatMyDate(invoice.periodEnd)}
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatMyDate(invoice.dueDate)}</Td>
                    <Td className="tabular-nums">{formatSen(invoice.amountSen)}</Td>
                    <Td className="tabular-nums">{formatSen(invoice.paidSen)}</Td>
                    <Td>
                      <StatusBadge status={invoice.status} />
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </section>

        <section className="grid gap-2">
          <h2 className="font-semibold">Payments</h2>
          <DataTable>
            <thead className="border-b">
              <tr>
                <Th>Amount</Th>
                <Th>Method</Th>
                <Th>Status</Th>
                <Th>Received (MYT)</Th>
                <Th>Slip</Th>
                {isManager && <Th className="text-right">Actions</Th>}
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
                    <Td>
                      <span className="tabular-nums">{formatSen(payment.amountSen)}</span>
                      {payment.unappliedSen > 0 && (
                        <span className="block text-xs tabular-nums text-muted-foreground">
                          {formatSen(payment.unappliedSen)} unallocated
                        </span>
                      )}
                    </Td>
                    <Td>{humanizeStatus(payment.method)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={payment.status} />
                        {payment.rejectedReason !== null && (
                          <span className="text-xs text-muted-foreground">({payment.rejectedReason})</span>
                        )}
                        {payment.voidedReason !== null && (
                          <span className="text-xs text-muted-foreground">({payment.voidedReason})</span>
                        )}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatMyDateTime(payment.receivedAt)}</Td>
                    <Td>{payment.slipPath !== null ? <SlipLinkButton paymentId={payment.id} /> : '—'}</Td>
                    {isManager && (
                      <Td className="text-right">
                        <PaymentActions paymentId={payment.id} status={payment.status} />
                      </Td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </section>

        <RecordPaymentForm leaseId={view.lease.id} />
      </main>
    </>
  )
}
