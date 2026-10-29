import { describe, expect, it } from 'vitest'

import {
  expectedGatewaySignature,
  gatewaySignatureMatches,
  gatewaySignatureSource,
  parseGatewayPaidAt,
} from './gateway'

const EXAMPLE_FIELDS = {
  id: 'bill_8f3a2c',
  paid: 'true',
  paid_amount: '210050',
  paid_at: '2026-04-01 00:30:12 +0800',
  transaction_id: 'TX-000123',
  transaction_status: 'completed',
}

describe('gateway signature', () => {
  // Test vector straight from the brief, section 5.
  it('reproduces the brief signature test vector', () => {
    const signature = expectedGatewaySignature(EXAMPLE_FIELDS, 'test_x_signature_key')
    expect(signature).toBe('06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641')
  })

  it('sorts fields by key before building the source string', () => {
    // paid_at < paid_amount in character-code order; insertion order must not matter.
    const fields = { paid: 'true', id: 'bill_8f3a2c', paid_amount: '210050' } as const
    expect(gatewaySignatureSource({ ...fields })).toBe(
      'idbill_8f3a2c|paidtrue|paid_amount210050',
    )
  })

  it('matches the exact and case-insensitive signature, never a wrong one', () => {
    const signature = expectedGatewaySignature(EXAMPLE_FIELDS, 'test_x_signature_key')
    expect(gatewaySignatureMatches(EXAMPLE_FIELDS, 'test_x_signature_key', signature)).toBe(true)
    expect(gatewaySignatureMatches(EXAMPLE_FIELDS, 'test_x_signature_key', signature.toUpperCase())).toBe(true)
    expect(
      gatewaySignatureMatches(EXAMPLE_FIELDS, 'wrong_key', signature),
    ).toBe(false)
    expect(gatewaySignatureMatches(EXAMPLE_FIELDS, 'test_x_signature_key', 'zz')).toBe(false)
    expect(gatewaySignatureMatches(EXAMPLE_FIELDS, 'a'.repeat(64), 'zz')).toBe(false)
    // A tampered field must invalidate the signature.
    const tampered = { ...EXAMPLE_FIELDS, paid_amount: '999999' }
    expect(
      gatewaySignatureMatches(tampered, 'test_x_signature_key', signature),
    ).toBe(false)
  })
})

describe('parseGatewayPaidAt', () => {
  it('parses quarters with offset, i.e. Malaysia time', () => {
    const date = parseGatewayPaidAt('2026-04-01 00:30:12 +0800')
    expect(date).not.toBeNull()
    if (date === null) return
    expect(date.toISOString()).toBe('2026-03-31T16:30:12.000Z')
  })

  it('parses negative offsets', () => {
    const date = parseGatewayPaidAt('2026-01-01 08:00:00 -0500')
    if (date === null) throw new Error('expected parse ok')
    expect(date.toISOString()).toBe('2026-01-01T13:00:00.000Z')
  })

  it('rejects garbage, missing offsets and impossible dates', () => {
    expect(parseGatewayPaidAt('2026-04-01T00:30:12Z')).toBeNull()
    expect(parseGatewayPaidAt('2026-04-01 00:30:12')).toBeNull()
    expect(parseGatewayPaidAt('2026-13-01 00:00:00 +0800')).toBeNull()
    expect(parseGatewayPaidAt('2026-02-30 00:00:00 +0800')).toBeNull()
    expect(parseGatewayPaidAt('2026-04-01 24:00:00 +0800')).toBeNull()
    expect(parseGatewayPaidAt('2026-04-01 00:61:00 +0800')).toBeNull()
    expect(parseGatewayPaidAt('')).toBeNull()
  })
})
