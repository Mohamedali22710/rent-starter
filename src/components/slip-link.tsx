'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

/** Button that fetches a short-lived signed URL for a payment's slip. */
export function SlipLinkButton({ paymentId }: { paymentId: string }) {
  const [busy, setBusy] = useState(false)

  async function open() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/payments/${paymentId}/slip`)
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null
      if (!res.ok || typeof body?.url !== 'string') {
        toast.error(res.status === 404 ? 'No slip on this payment' : body?.error ?? 'Could not open the slip')
        return
      }
      window.open(body.url, '_blank', 'noopener')
    } catch {
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void open()} disabled={busy}>
      {busy ? 'Opening…' : 'View slip'}
    </Button>
  )
}
