'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { formatSen } from '@/lib/format'

/**
 * Tenant "Pay now": creates a gateway bill for the amount due now (the API
 * refuses with "nothing due" when there is nothing to pay) and shows the
 * bill id and amount, as the production gateway redirect would come next.
 * Only the webhook settles the bill.
 */
export function PayNowButton({ leaseId, dueNowSen }: { leaseId: string; dueNowSen: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [bill, setBill] = useState<{ billId: string; amountSen: number } | null>(null)

  async function createBill() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/leases/${leaseId}/gateway-bills`, { method: 'POST' })
      const body = (await res.json().catch(() => null)) as
        | { billId?: string; amountSen?: number; error?: string }
        | null
      if (!res.ok || typeof body?.billId !== 'string' || typeof body?.amountSen !== 'number') {
        toast.error(body?.error ?? 'Could not start the payment')
        return
      }
      setBill({ billId: body.billId, amountSen: body.amountSen })
      toast.success(`Gateway bill created for ${formatSen(body.amountSen)}`, {
        description: 'Waiting for the gateway. The status below is read-only.',
      })
      router.refresh()
    } catch {
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={() => void createBill()} disabled={busy || dueNowSen <= 0}>
        {busy ? 'Creating bill…' : dueNowSen > 0 ? `Pay now (${formatSen(dueNowSen)})` : 'Nothing due now'}
      </Button>
      {bill !== null && (
        <a
          href={`/payments/return?bill_id=${bill.billId}&paid=true`}
          className="text-sm text-primary underline-offset-4 hover:underline w-fit"
        >
          Bill {bill.billId} · {formatSen(bill.amountSen)} → check its status
        </a>
      )}
    </div>
  )
}
