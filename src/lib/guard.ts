import { redirect } from 'next/navigation'

import { type Caller, getCaller } from './auth'

/**
 * Server-component guard. Unauthenticated -> /login; the wrong kind of
 * account -> / (the home page sends them to their own area).
 */
export async function requireCaller(
  roles: Array<Caller['role']>,
): Promise<Caller> {
  const caller = await getCaller()
  if (caller === null) redirect('/login')
  if (!roles.includes(caller.role)) redirect('/')
  return caller
}
