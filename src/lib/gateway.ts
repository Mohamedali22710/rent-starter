import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Gateway callback verification (brief section 5).
 *
 * Source string: every field except x_signature sorted by key (ascending by
 * character code), each written as key immediately followed by value, joined
 * with '|'. HMAC-SHA256 with GATEWAY_X_SIGNATURE_KEY, lowercase hex.
 */

export function gatewaySignatureSource(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((k) => k !== 'x_signature')
    .sort()
    .map((k) => `${k}${fields[k]}`)
    .join('|')
}

export function expectedGatewaySignature(fields: Record<string, string>, key: string): string {
  return createHmac('sha256', key).update(gatewaySignatureSource(fields)).digest('hex')
}

/** Constant-time comparison of the expected against the provided signature. */
export function gatewaySignatureMatches(
  fields: Record<string, string>,
  key: string,
  provided: string,
): boolean {
  const expected = expectedGatewaySignature(fields, key)
  const expectedBytes = Buffer.from(expected.toLowerCase(), 'hex')
  let providedBytes: Buffer
  try {
    providedBytes = Buffer.from(provided.toLowerCase(), 'hex')
  } catch {
    return false
  }
  if (expectedBytes.length !== providedBytes.length || providedBytes.length === 0) {
    return false
  }
  return timingSafeEqual(expectedBytes, providedBytes)
}

/**
 * Parse a gateway paid_at value: 'YYYY-MM-DD HH:MM:SS +HHMM' (or -HHMM).
 * Returns null when the value is not a real instant in that exact shape.
 */
export function parseGatewayPaidAt(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/.exec(text)
  if (m === null) return null
  const [, y, mo, d, h, mi, s, offset] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = Number(s)

  // Real calendar date check (rejects month 13, Feb 30, ...).
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return null
  }
  if (hour > 23 || minute > 59 || second > 59) return null

  const sign = offset[0] === '-' ? -1 : 1
  const offsetMinutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5)))
  return new Date(Date.UTC(year, month - 1, day, hour, minute - offsetMinutes, second))
}
