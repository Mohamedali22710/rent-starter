'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { browserSupabase } from '@/lib/supabase-browser'

/** Sign out and return to the login screen. */
export function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    if (busy) return
    setBusy(true)
    try {
      const { error } = await browserSupabase().auth.signOut()
      if (error !== null) toast.error(error.message)
      router.replace('/login')
      router.refresh()
    } catch {
      setBusy(false)
      toast.error('Could not sign out')
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={() => void signOut()} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
