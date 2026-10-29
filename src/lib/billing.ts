/**
 * Pure billing logic for the rent collection module.
 *
 * Rules of this module:
 * - No I/O and no imports: it must stay testable in isolation.
 * - All calendar arithmetic is done in UTC on ('YYYY-MM-DD') strings, so the
 *   result never depends on the timezone of the machine it runs on.
 * - Money is always integer sen (1 ringgit = 100 sen). Never floating point.
 *
 * Business timezone is Asia/Kuala_Lumpur (UTC+8, no daylight saving). The only
 * wall-clock-dependent function is invoiceStatus, which derives *today's
 * Malaysia date* from the instant it is given, independent of the machine TZ.
 */

export type InvoiceKind = 'deposit' | 'rent'

export interface ScheduledInvoice {
  kind: InvoiceKind
  /** 0, 1, 2... for rent; null for the deposit */
  periodIndex: number | null
  /** 'YYYY-MM-DD'; null for the deposit */
  periodStart: string | null
  /** 'YYYY-MM-DD', inclusive; null for the deposit */
  periodEnd: string | null
  /** 'YYYY-MM-DD' */
  dueDate: string
  /** Integer sen */
  amountSen: number
}

export type InvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue'

// ---------------------------------------------------------------------------
// Date helpers (UTC, on 'YYYY-MM-DD' strings)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

interface CalendarDate {
  y: number
  m: number // 1-12
  d: number // 1-31
}

/**
 * Strictly parse 'YYYY-MM-DD'. Throws unless it is a real calendar date
 * written exactly in that shape (no whitespace, no time part, real month/day).
 */
function parseDate(s: string, label: string): CalendarDate {
  if (typeof s !== 'string' || !DATE_RE.test(s)) {
    throw new Error(`${label} must be a date written as YYYY-MM-DD`)
  }
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))
  const rounded = new Date(Date.UTC(y, m - 1, d))
  if (
    rounded.getUTCFullYear() !== y ||
    rounded.getUTCMonth() !== m - 1 ||
    rounded.getUTCDate() !== d
  ) {
    throw new Error(`${label} is not a real calendar date: ${s}`)
  }
  return { y, m, d }
}

/** Days since the Unix epoch (UTC), used for all date differences. */
function toDays(c: CalendarDate): number {
  return Date.UTC(c.y, c.m - 1, c.d) / MS_PER_DAY
}

function fromDays(days: number): CalendarDate {
  const dt = new Date(days * MS_PER_DAY)
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  }
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function fmt(c: CalendarDate): string {
  return `${c.y}-${pad2(c.m)}-${pad2(c.d)}`
}

/**
 * The start date plus k calendar months, always counted from the start date
 * itself (never chained from the previous anchor). If the target month is
 * shorter than the start day, the month's last day is used:
 * Jan 31 -> Feb 28/29, Mar 31, Apr 30, ...
 */
function addMonths(from: CalendarDate, k: number): CalendarDate {
  const monthIndex = from.m - 1 + k // 0-based, may overflow the year
  const y = from.y + Math.floor(monthIndex / 12)
  const m = (((monthIndex % 12) + 12) % 12) + 1
  const d = Math.min(from.d, daysInMonth(y, m))
  return { y, m, d }
}

/**
 * Today's Malaysia date (Asia/Kuala_Lumpur, UTC+8, no DST) as 'YYYY-MM-DD',
 * derived from the given instant without using the machine's timezone.
 */
export function malaysiaDateOf(now: Date): string {
  const shifted = new Date(now.getTime() + 8 * 3_600_000)
  return shifted.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

/**
 * Round half up to the nearest sen: amount * num / den with integer inputs,
 * done in exact integer arithmetic (integral while inputs stay well below
 * 2^53, which covers any realistic rent).
 */
function prorate(amountSen: number, num: number, den: number): number {
  // floor((amount * num / den) + 0.5) done in exact integer arithmetic.
  return Math.floor((amountSen * num * 2 + den) / (den * 2))
}

function isInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

// ---------------------------------------------------------------------------
// generateSchedule
// ---------------------------------------------------------------------------

/**
 * The deposit invoice (if any) plus one rent invoice per monthly period.
 *
 * Periods are anchored on the lease start date. Period k runs from anchor k
 * to the day before anchor k+1 and is due on anchor k. There is one period for
 * every anchor on or before the end date; the last one is cut at the end date
 * and, if shorter than its full length, prorated as
 * monthlyRentSen x days used / days in the full period, rounded half up.
 */
export function generateSchedule(lease: {
  startDate: string
  endDate: string
  monthlyRentSen: number
  depositSen: number
}): ScheduledInvoice[] {
  const start = parseDate(lease.startDate, 'startDate')
  const end = parseDate(lease.endDate, 'endDate')

  if (!isInteger(lease.monthlyRentSen) || lease.monthlyRentSen <= 0) {
    throw new Error('monthlyRentSen must be a positive integer number of sen')
  }
  if (
    lease.depositSen === undefined ||
    lease.depositSen === null ||
    !isInteger(lease.depositSen) ||
    lease.depositSen < 0
  ) {
    throw new Error('depositSen must be a non-negative integer number of sen')
  }
  if (toDays(end) < toDays(start)) {
    throw new Error('endDate must not be before startDate')
  }

  const schedule: ScheduledInvoice[] = []

  if (lease.depositSen > 0) {
    schedule.push({
      kind: 'deposit',
      periodIndex: null,
      periodStart: null,
      periodEnd: null,
      dueDate: lease.startDate,
      amountSen: lease.depositSen,
    })
  }

  const startDays = toDays(start)
  const endDays = toDays(end)

  for (let k = 0; ; k++) {
    const anchor = addMonths(start, k)
    const anchorDays = toDays(anchor)
    if (anchorDays > endDays) break

    // Full period would end the day before the next anchor. The brief's
    // worked example counts its length inclusively, anchor to the day before
    // the next anchor: "16 of the 31 days from 2026-06-30 to 2026-07-30".
    // In inclusive-day terms that length is exactly the day difference
    // between the two anchors (nextAnchor - 1 - anchor + 1 = nextAnchor - anchor).
    const nextAnchorDays = toDays(addMonths(start, k + 1))
    const fullLengthDays = nextAnchorDays - anchorDays

    // The period ends at the end date if the next anchor runs past it,
    // otherwise the day before the next anchor.
    const lastUsedDays = Math.min(endDays, nextAnchorDays - 1)
    const daysUsed = lastUsedDays - anchorDays + 1

    const amountSen =
      daysUsed < fullLengthDays
        ? prorate(lease.monthlyRentSen, daysUsed, fullLengthDays)
        : lease.monthlyRentSen

    schedule.push({
      kind: 'rent',
      periodIndex: k,
      periodStart: fmt(fromDays(anchorDays)),
      periodEnd: fmt(fromDays(lastUsedDays)),
      dueDate: fmt(anchor),
      amountSen,
    })

    if (nextAnchorDays > endDays) break
  }

  return schedule
}

// ---------------------------------------------------------------------------
// invoiceStatus
// ---------------------------------------------------------------------------

/**
 * Status rules applied in the brief's order:
 * 1. paid if paidSen >= amountSen
 * 2. overdue if today's Malaysia date is after dueDate (an invoice due
 *    2026-03-01 becomes overdue at 2026-03-01T16:00:00Z, not earlier)
 * 3. partially_paid if paidSen > 0
 * 4. otherwise unpaid
 */
export function invoiceStatus(
  invoice: { dueDate: string; amountSen: number; paidSen: number },
  now: Date,
): InvoiceStatus {
  if (invoice.paidSen >= invoice.amountSen) return 'paid'

  const due = parseDate(invoice.dueDate, 'dueDate')
  const today = parseDate(malaysiaDateOf(now), 'today')
  if (toDays(today) > toDays(due)) return 'overdue'

  if (invoice.paidSen > 0) return 'partially_paid'
  return 'unpaid'
}

// ---------------------------------------------------------------------------
// parseRinggitToSen
// ---------------------------------------------------------------------------

/**
 * Turns what a user types into sen.
 *
 * Accepted: digits, optionally with comma thousands separators (groups of
 * exactly three digits) and an optional decimal part of one or two digits.
 * Whitespace around the value is ignored.
 * "1,500.50" -> 150050, "1.15" -> 115, "7" -> 700.
 * Anything else throws: "", "-5", "1.234", "1e3", "RM 10", "1,23", ".15", "1."
 */
const RINGGIT_RE = /^\s*(\d+|\d{1,3}(,\d{3})+)(?:\.(\d{1,2}))?\s*$/

export function parseRinggitToSen(input: string): number {
  if (typeof input !== 'string') {
    throw new Error('Amount must be a string, e.g. "1,500.50"')
  }
  const match = RINGGIT_RE.exec(input)
  if (match === null) {
    throw new Error(`Invalid amount: "${input.trim()}"`)
  }
  const ringgit = Number(match[1].replace(/,/g, ''))
  const senPortion = match[3] === undefined ? '0' : match[3].length === 1 ? `${match[3]}0` : match[3]
  return ringgit * 100 + Number(senPortion)
}
