'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { humanizeStatus } from '@/lib/format'

type Action = 'approve' | 'reject' | 'void'

/**
 * Manager actions on a payment. Approve is immediate; reject and void open a
 * confirmation panel with a reason input (at least 5 characters) that must
 * be confirmed before the request is sent.
 */
export function PaymentActions({
  paymentId,
  status,
}: {
  paymentId: string
  status: string
}) {
  const router = useRouter()
  const [openAction, setOpenAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(action: Action, body?: { reason: string }) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/payments/${paymentId}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => null)) as { status?: string; error?: string } | null
      if (!res.ok) {
        toast.error(payload?.error ?? `Could not ${action} the payment`)
        return
      }
      toast.success(`${humanizeStatus(payload?.status ?? action)} the payment`, {
        description: 'The lease has been updated.',
      })
      setOpenAction(null)
      setReason('')
      router.refresh()
    } catch {
      toast.error('Network error: nothing changed')
    } finally {
      setBusy(false)
    }
  }

  const needsReason = openAction === 'reject' || openAction === 'void'
  const reasonOk = reason.trim().length >= 5

  if (status !== 'pending_verification' && status !== 'approved') return null

  return (
    <div className="flex flex-wrap items-center gap-2 justify-end">
      {status === 'pending_verification' && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void send('approve')}
        >
          {busy ? 'Approving…' : 'Approve'}
        </Button>
      )}
      {status === 'pending_verification' && (
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => setOpenAction('reject')}>
          Reject…
        </Button>
      )}
      {status === 'approved' && (
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => setOpenAction('void')}>
          Void…
        </Button>
      )}

      {needsReason && (
        <div
          className="w-full basis-full border rounded-xl p-3 gap-2 grid"
          aria-label={`Confirm ${openAction}`}
        >
          <Label htmlFor={`reason-${paymentId}`}>
            {openAction === 'void'
              ? 'Confirm: type the reason for voiding (at least 5 characters)'
              : 'Confirm: type the reason for rejecting (at least 5 characters)'}
          </Label>
          <Input
            id={`reason-${paymentId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Slip does not match the transfer"
            disabled={busy}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setOpenAction(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || !reasonOk}
              onClick={() => void send(openAction === 'void' ? 'void' : 'reject', { reason: reason.trim() })}
            >
              {busy ? 'Working…' : `Confirm ${openAction}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
