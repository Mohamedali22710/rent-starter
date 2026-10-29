/**
 * Display formatting helpers.
 *
 * Every date/time is rendered with an explicit timeZone ('Asia/Kuala_Lumpur'),
 * so output is identical no matter the server's or browser's timezone and
 * SSR/CSR agree (no hydration warnings, brief section 9).
 *
 * Money is integer sen; formatting divides only for display, storage is always
 * integer sen.
 */

export const MY_TZ = 'Asia/Kuala_Lumpur'

const MY_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: MY_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const MY_DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: MY_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** `2026-01-31` -> `31 Jan 2026` (Malaysia time). */
export function formatMyDate(ymd: string): string {
  // Anchored at midnight UTC: UTC+8 offsets stay on the same calendar day.
  return MY_DATE.format(new Date(`${ymd}T00:00:00Z`))
}

/** An ISO instant -> `31 Jan 2026, 10:00` in Malaysia time. */
export function formatMyDateTime(instant: string): string {
  return MY_DATE_TIME.format(new Date(instant))
}

/** 150000 -> `RM 1,500.00`; always two decimals, thousands separated. */
export function formatSen(sen: number): string {
  const negative = sen < 0
  const v = Math.abs(Math.round(sen))
  const ringgit = Math.floor(v / 100)
  const s = `${ringgit.toLocaleString('en-US')}.${String(v % 100).padStart(2, '0')}`
  return `${negative ? '-' : ''}RM ${s}`
}

/** Now in Malaysia time as a `datetime-local` input value (`YYYY-MM-DDTHH:mm`). */
export function nowMyDateTimeLocal(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 16)
}

/**
 * A `datetime-local` value (`YYYY-MM-DDTHH:mm`) typed in Malaysia time ->
 * the corresponding ISO instant. Returns null for anything invalid.
 */
export function myDateTimeLocalToIso(local: string): string | null {
  if (typeof local !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const d = new Date(`${local}:00+08:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** `pending_verification` | `approved` | ... -> `Pending verification` etc. */
export function humanizeStatus(status: string): string {
  return status.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase())
}
