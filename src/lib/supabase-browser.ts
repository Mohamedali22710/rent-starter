'use client'

import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-side supabase client (public URL + publishable key only -- the
 * service role key never reaches the browser). Used for sign-in/-out and the
 * tenant portal's direct phone-number update through the Data API (brief
 * section 6's tenant exception).
 */
let client: ReturnType<typeof createBrowserClient> | null = null

export function browserSupabase() {
  if (client === null) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    )
  }
  return client
}
