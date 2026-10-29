'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { browserSupabase } from '@/lib/supabase-browser'

/**
 * The tenant edits their own phone number, written straight through the
 * Supabase Data API from the browser (the brief's tenant exception: the
 * database's RLS + column grant allow exactly this, and nothing more).
 */
export function PhoneEdit({
  tenantId,
  initialPhone,
}: {
  tenantId: string
  initialPhone: string
}) {
  const router = useRouter()
  const [phone, setPhone] = useState(initialPhone)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy) return
    const value = phone.trim()
    if (value.length < 3) {
      toast.error('Enter a phone number of at least 3 characters')
      return
    }
    setBusy(true)
    try {
      const res = await browserSupabase().from('tenants').update({ phone: value }).eq('id', tenantId)
      if (res.error !== null) {
        toast.error(res.error.message || 'Could not update the phone number')
        return
      }
      toast.success('Phone number updated')
      router.refresh()
    } catch {
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-2 items-end">
      <div className="grid gap-1.5">
        <label htmlFor="tenant-phone" className="text-sm font-medium">
          Phone
        </label>
        <input
          id="tenant-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="border-input bg-background flex h-9 w-56 rounded-lg border px-3 text-sm"
          placeholder="+60 12-345 6789"
          disabled={busy}
        />
      </div>
      <Button onClick={() => void save()} disabled={busy}>
        {busy ? 'Saving…' : 'Save phone'}
      </Button>
    </div>
  )
}
