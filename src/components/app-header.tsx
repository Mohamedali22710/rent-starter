import Link from 'next/link'

import { LogoutButton } from '@/components/logout-button'
import { humanizeStatus } from '@/lib/format'

import type { Caller } from '@/lib/auth'

/** Shared top bar: identity, the pages this role can open, and sign-out. */
export function AppHeader({ caller, title }: { caller: Caller; title: string }) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-baseline gap-4">
          <span className="font-semibold">{title}</span>
          <nav className="flex gap-3 text-sm text-muted-foreground">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/leases" className="hover:underline">
              Leases
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {caller.userId.slice(0, 8)} · {humanizeStatus(caller.role)}
          </span>
          <LogoutButton />
        </div>
      </div>
    </header>
  )
}

/** Tenant header (no dashboard nav, own links). */
export function TenantHeader({ name }: { name: string }) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
        <span className="font-semibold">Tenant portal · {name}</span>
        <LogoutButton />
      </div>
    </header>
  )
}
