import { createServerClient } from '@supabase/ssr'
import { createClient, type User } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { prisma } from './prisma'

export type AppRole = 'manager' | 'staff' | 'tenant'

/**
 * Who is calling, as resolved server-side from the database:
 * - staff/manager: from the memberships table (unique per user).
 * - tenant: from the tenants table (tenants.user_id).
 * Role and organization are NEVER taken from anything the client can edit
 * (e.g. user_metadata), per the brief's access-control rules.
 */
export interface Caller {
  userId: string
  role: AppRole
  orgId: string
  /** Set only for tenants (tenants.id). */
  tenantId: string | null
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''

/**
 * Authenticate the caller of a route handler:
 * - `Authorization: Bearer <supabase access token>` (what our tests send), or
 * - the session cookie set at sign-in.
 *
 * The token is validated via supabase.auth.getUser(), not getSession(): a
 * session in local storage is never trusted server-side.
 */
export async function getCaller(): Promise<Caller | null> {
  const requestHeaders = await headers()
  const authorization = requestHeaders.get('authorization')

  let user: User | null = null
  if (authorization !== null && /^bearer /i.test(authorization)) {
    const token = authorization.slice('Bearer '.length).trim()
    if (token === '') return null
    const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data } = await supabase.auth.getUser(token)
    user = data.user
  } else {
    const cookieStore = await cookies()
    const supabase = createServerClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(list) {
          // Route handlers may not always allow writes; keeping the session
          // fresh here is best-effort and never an error.
          try {
            for (const { name, value, options } of list) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Ignore: no session refresh needed for validation against the
            // auth server in this request.
          }
        },
      },
    })
    const { data } = await supabase.auth.getUser()
    user = data.user
  }

  if (user === null) return null

  // Resolve role + organization from the database.
  const membership = await prisma.membership.findFirst({ where: { userId: user.id } })
  if (membership !== null) {
    if (membership.role !== 'manager' && membership.role !== 'staff') return null
    return { userId: user.id, role: membership.role, orgId: membership.orgId, tenantId: null }
  }

  const tenant = await prisma.tenant.findFirst({ where: { userId: user.id } })
  if (tenant !== null) {
    return { userId: user.id, role: 'tenant', orgId: tenant.orgId, tenantId: tenant.id }
  }

  // Authenticated but known to nobody: treat as unauthenticated.
  return null
}

export function unauthorized(): NextResponse {
  return errorResponse('Authentication required', 401)
}

export function forbidden(): NextResponse {
  return errorResponse('Forbidden', 403)
}

export function notFound(): NextResponse {
  return errorResponse('Not found', 404)
}

export function badRequest(message: string): NextResponse {
  return errorResponse(message, 400)
}

export function conflict(message: string): NextResponse {
  return errorResponse(message, 409)
}

export function overLimit(message: string): NextResponse {
  return errorResponse(message, 422)
}

export function serverError(message = 'Internal server error'): NextResponse {
  return errorResponse(message, 500)
}

function errorResponse(message: string, status: 401 | 403 | 404 | 400 | 409 | 422 | 500): NextResponse {
  return NextResponse.json({ error: message }, { status })
}
