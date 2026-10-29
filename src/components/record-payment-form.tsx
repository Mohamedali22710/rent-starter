'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { parseRinggitToSen } from '@/lib/billing'
import { formatSen, myDateTimeLocalToIso, nowMyDateTimeLocal } from '@/lib/format'

/**
 * Record a cash or bank-transfer payment on a lease (staff and managers;
 * a manager's payment is approved immediately, a staff one waits for
 * approval). The amount is typed in ringgit and parsed with
 * parseRinggitToSen; the instant is entered in Malaysia time. Bank transfers
 * upload the slip first; if the recording then fails the upload is left
 * alone only when the server could not clean it up (it does clean it up).
 */
export function RecordPaymentForm({ leaseId }: { leaseId: string }) {
  const router = useRouter()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'bank_transfer'>('cash')
  const [receivedAt, setReceivedAt] = useState(nowMyDateTimeLocal())
  const [slip, setSlip] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return

    let amountSen: number
    try {
      amountSen = parseRinggitToSen(amount)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid amount')
      return
    }
    const iso = myDateTimeLocalToIso(receivedAt)
    if (iso === null) {
      toast.error('Enter a valid date and time')
      return
    }
    if (method === 'bank_transfer' && slip === null) {
      toast.error('A bank transfer needs a slip (JPEG, PNG or PDF, at most 5 MB)')
      return
    }

    setBusy(true)
    try {
      let slipPath: string | undefined
      if (method === 'bank_transfer' && slip !== null) {
        setStage('Uploading slip…')
        const form = new FormData()
        form.set('file', slip)
        const upload = await fetch('/api/slip-uploads', { method: 'POST', body: form })
        const uploadBody = (await upload.json().catch(() => null)) as { path?: string; error?: string } | null
        if (!upload.ok || typeof uploadBody?.path !== 'string') {
          toast.error(uploadBody?.error ?? 'Could not upload the slip')
          return
        }
        slipPath = uploadBody.path
      }

      setStage('Recording payment…')
      const record = await fetch(`/api/leases/${leaseId}/payments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountSen, method, receivedAt: iso, slipPath }),
      })
      const recordBody = (await record.json().catch(() => null)) as { id?: string; status?: string; error?: string } | null
      if (!record.ok) {
        toast.error(recordBody?.error ?? 'Could not record the payment')
        return
      }
      toast.success(
        recordBody?.status === 'approved'
          ? 'Payment recorded and approved'
          : 'Payment recorded, waiting for a manager to verify',
        { description: `${formatSen(amountSen)}${slipPath ? ' · slip uploaded' : ''}` },
      )
      setAmount('')
      setSlip(null)
      setReceivedAt(nowMyDateTimeLocal())
      router.refresh()
    } catch {
      toast.error('Network error: the payment was not recorded')
    } finally {
      setStage('')
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 items-end rounded-xl border p-4"
    >
      <div className="sm:col-span-2">
        <h3 className="font-semibold">Record a payment</h3>
        <p className="text-sm text-muted-foreground">
          Amount in ringgit (e.g. 1,500.50). Times are Malaysia time.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="payment-amount">Amount (RM)</Label>
        <Input
          id="payment-amount"
          inputMode="decimal"
          placeholder="1,500.50"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="payment-method">Method</Label>
        <select
          id="payment-method"
          className="border-input bg-background flex h-9 w-full rounded-lg border px-3 text-sm"
          value={method}
          onChange={(e) => setMethod(e.target.value as 'cash' | 'bank_transfer')}
          disabled={busy}
        >
          <option value="cash">Cash</option>
          <option value="bank_transfer">Bank transfer</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="payment-received-at">Received at (MYT)</Label>
        <Input
          id="payment-received-at"
          type="datetime-local"
          value={receivedAt}
          onChange={(e) => setReceivedAt(e.target.value)}
          disabled={busy}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="payment-slip" className={method === 'bank_transfer' ? '' : 'text-muted-foreground'}>
          Slip (bank transfer only)
        </Label>
        <Input
          id="payment-slip"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={(e) => setSlip(e.target.files?.[0] ?? null)}
          disabled={busy || method !== 'bank_transfer'}
        />
      </div>
      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? stage || 'Working…' : 'Record payment'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Staff payments wait for a manager&apos;s approval.
        </p>
      </div>
    </form>
  )
}
