import { redirect } from 'next/navigation'

import { getCaller } from '@/lib/auth'

/** Send each kind of account to its own area. */
export default async function Home() {
  const caller = await getCaller()
  if (caller === null) redirect('/login')
  if (caller.role === 'tenant') redirect('/portal')
  redirect('/dashboard')
}
