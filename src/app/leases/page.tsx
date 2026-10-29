import Link from 'next/link'
import { Prisma } from '@prisma/client'

import { AppHeader } from '@/components/app-header'
import { DataTable, Td, Th } from '@/components/table-bits'
import { formatMyDate, formatSen } from '@/lib/format'
import { requireCaller } from '@/lib/guard'
import { prisma } from '@/lib/prisma'


/** The organization's leases (staff and managers). */
export default async function LeasesPage() {
  const caller = await requireCaller(['manager', 'staff'])

  const rows = await prisma.lease.findMany({
    where: { orgId: caller.orgId },
    orderBy: { createdAt: 'asc' },
    include: {
      unit: { select: { name: true } },
      tenant: { select: { fullName: true } },
      invoices: { select: { amountSen: true } },
      payments: { select: { status: true, unappliedSen: true } },
    },
  })

  // Outstanding per lease: everything invoiced minus approved allocations.
  const unpaid = await prisma.$queryRaw<{ lease_id: string; outstanding_sen: bigint }[]>(
    Prisma.sql`
      select l.id as lease_id,
             (select coalesce(sum(amount_sen), 0) from invoices i where i.lease_id = l.id) -
             (select coalesce(sum(a.amount_sen), 0)
                from payment_allocations a
                join payments p on p.id = a.payment_id
               where p.lease_id = l.id and p.status = 'approved') as outstanding_sen
        from leases l
       where l.org_id = ${caller.orgId}::uuid
    `,
  )
  const outstanding = new Map(unpaid.map((r) => [r.lease_id, Number(r.outstanding_sen)]))

  return (
    <>
      <AppHeader caller={caller} title="Leases" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {rows.length === 0 ? (
          <p className="rounded-xl border p-6 text-muted-foreground">No leases yet.</p>
        ) : (
          <DataTable>
            <thead className="border-b">
              <tr>
                <Th>Unit</Th>
                <Th>Tenant</Th>
                <Th>Period</Th>
                <Th>Rent / month</Th>
                <Th>Outstanding</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lease) => (
                <tr key={lease.id} className="border-b last:border-0 hover:bg-muted/40">
                  <Td>
                    <Link href={`/leases/${lease.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {lease.unit.name}
                    </Link>
                  </Td>
                  <Td>{lease.tenant.fullName}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">
                    {formatMyDate(lease.startDate.toISOString().slice(0, 10))}
                    {' – '}
                    {formatMyDate(lease.endDate.toISOString().slice(0, 10))}
                  </Td>
                  <Td>{formatSen(Number(lease.monthlyRentSen))}</Td>
                  <Td className="whitespace-nowrap">{formatSen(outstanding.get(lease.id) ?? 0)}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </main>
    </>
  )
}
