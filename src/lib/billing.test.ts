import { describe, expect, it } from 'vitest'

import {
  generateSchedule,
  invoiceStatus,
  malaysiaDateOf,
  parseRinggitToSen,
  type ScheduledInvoice,
} from './billing'

/** 'YYYY-MM-DD' date of a UTC instant (test helper, not from the app). */
function utcDate(iso: string): string {
  return iso.slice(0, 10)
}

function summarize(schedule: ScheduledInvoice[]) {
  return schedule.map((s) => ({
    kind: s.kind,
    periodIndex: s.periodIndex,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    dueDate: s.dueDate,
    amountSen: s.amountSen,
  }))
}

const aisyah = {
  startDate: '2026-01-31',
  endDate: '2026-07-15',
  monthlyRentSen: 150_000,
  depositSen: 300_000,
}

describe('generateSchedule - Aisyah (worked example from the brief)', () => {
  it('produces the deposit then 6 rent periods, last one prorated to RM 774.19', () => {
    expect(summarize(generateSchedule(aisyah))).toEqual([
      {
        kind: 'deposit',
        periodIndex: null,
        periodStart: null,
        periodEnd: null,
        dueDate: '2026-01-31',
        amountSen: 300_000,
      },
      {
        kind: 'rent',
        periodIndex: 0,
        periodStart: '2026-01-31',
        periodEnd: '2026-02-27',
        dueDate: '2026-01-31',
        amountSen: 150_000,
      },
      {
        kind: 'rent',
        periodIndex: 1,
        periodStart: '2026-02-28',
        periodEnd: '2026-03-30',
        dueDate: '2026-02-28',
        amountSen: 150_000,
      },
      {
        kind: 'rent',
        periodIndex: 2,
        periodStart: '2026-03-31',
        periodEnd: '2026-04-29',
        dueDate: '2026-03-31',
        amountSen: 150_000,
      },
      {
        kind: 'rent',
        periodIndex: 3,
        periodStart: '2026-04-30',
        periodEnd: '2026-05-30',
        dueDate: '2026-04-30',
        amountSen: 150_000,
      },
      {
        kind: 'rent',
        periodIndex: 4,
        periodStart: '2026-05-31',
        periodEnd: '2026-06-29',
        dueDate: '2026-05-31',
        amountSen: 150_000,
      },
      {
        kind: 'rent',
        periodIndex: 5,
        periodStart: '2026-06-30',
        periodEnd: '2026-07-15',
        dueDate: '2026-06-30',
        amountSen: 77_419, // 150000 x 16 / 31 = 77419.35 -> 77419
      },
    ])
  })
})

describe('generateSchedule - Ben (RM 1,000.29, ends 2026-04-15)', () => {
  const ben = {
    startDate: '2026-01-01',
    endDate: '2026-04-15',
    monthlyRentSen: 100_029,
    depositSen: 0,
  }

  it('has no deposit and four periods; the last is 15 of 30 days', () => {
    const schedule = generateSchedule(ben)
    expect(schedule.every((s) => s.kind === 'rent')).toBe(true)
    expect(summarize(schedule)).toEqual([
      {
        kind: 'rent',
        periodIndex: 0,
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        dueDate: '2026-01-01',
        amountSen: 100_029,
      },
      {
        kind: 'rent',
        periodIndex: 1,
        periodStart: '2026-02-01',
        periodEnd: '2026-02-28',
        dueDate: '2026-02-01',
        amountSen: 100_029,
      },
      {
        kind: 'rent',
        periodIndex: 2,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        dueDate: '2026-03-01',
        amountSen: 100_029,
      },
      {
        kind: 'rent',
        periodIndex: 3,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-15',
        dueDate: '2026-04-01',
        amountSen: 50_015, // 100029 x 15 / 30 = 50014.5, rounds half up
      },
    ])
  })

  it('the last day of the full period is not prorated', () => {
    const schedule = generateSchedule({ ...ben, endDate: '2026-04-30' })
    expect(schedule.at(-1)).toMatchObject({
      periodIndex: 3,
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      amountSen: 100_029,
    })
    expect(schedule).toHaveLength(4)
  })
})

describe('generateSchedule - anchoring', () => {
  it('anchors are always counted from the start date, not the previous anchor', () => {
    // Jan 31 start: Feb 28 (leap year), but March keeps 31.
    const schedule = generateSchedule({
      startDate: '2024-01-31',
      endDate: '2024-03-31',
      monthlyRentSen: 100_000,
      depositSen: 0,
    })
    expect(schedule.map((s) => [s.periodStart, s.periodEnd, s.amountSen])).toEqual([
      ['2024-01-31', '2024-02-28', 100_000],
      ['2024-02-29', '2024-03-30', 100_000],
      // Last period cut to one day of a 2024-03-31 .. 2024-04-30 full period:
      // 100000 x 1 / 30 = 3333.33 -> 3333
      ['2024-03-31', '2024-03-31', 3_333],
    ])
  })

  it('non-leap year clamps to Feb 28 and still anchors on the start day after', () => {
    const schedule = generateSchedule({
      startDate: '2025-01-31',
      endDate: '2025-02-28',
      monthlyRentSen: 100_000,
      depositSen: 0,
    })
    expect(schedule.map((s) => [s.periodStart, s.periodEnd, s.amountSen])).toEqual([
      // Full period: Jan 31 to Feb 27 (the day before the anchor Feb 28).
      ['2025-01-31', '2025-02-27', 100_000],
      // Cut to one day of the 2025-02-28 .. 2025-03-30 full period:
      // 100000 x 1 / 31 = 3225.8 -> rounds to 3226.
      ['2025-02-28', '2025-02-28', 3_226],
    ])
  })

  it('a period ending the day before its next anchor is full, not prorated', () => {
    const schedule = generateSchedule({
      startDate: '2026-01-31',
      endDate: '2026-03-30',
      monthlyRentSen: 100_000,
      depositSen: 0,
    })
    expect(schedule.map((s) => [s.periodStart, s.periodEnd, s.amountSen])).toEqual([
      ['2026-01-31', '2026-02-27', 100_000],
      ['2026-02-28', '2026-03-30', 100_000],
    ])
  })

  it('a one-day lease prorates one day', () => {
    const schedule = generateSchedule({
      startDate: '2026-06-30',
      endDate: '2026-06-30',
      monthlyRentSen: 100_000,
      depositSen: 0,
    })
    // Anchors of a Jun 30 start are Jun 30, Jul 30, ... so the full period has
    // 30 days; 1 day used: 100000 x 1 / 30 = 3333.33 -> 3333.
    expect(schedule.map((s) => [s.periodStart, s.periodEnd, s.amountSen])).toEqual([
      ['2026-06-30', '2026-06-30', 3_333],
    ])
  })

  it('rounds half up: 100029 x 15 / 30 = 50014.5 -> 50015', () => {
    // Start Apr 1 2026: the full period has 30 days (Apr 1 .. Apr 30).
    // Cut at Apr 15 = 15 days used.
    const schedule = generateSchedule({
      startDate: '2026-04-01',
      endDate: '2026-04-15',
      monthlyRentSen: 100_029,
      depositSen: 0,
    })
    expect(schedule[0].amountSen).toBe(50_015)
  })
})

describe('generateSchedule - validation', () => {
  const base = { startDate: '2026-01-31', endDate: '2026-02-28', monthlyRentSen: 100_000, depositSen: 0 }

  it('rejects dates that are not real calendar dates', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-1', '2026-01-31x', '', '20260131']) {
      expect(() => generateSchedule({ ...base, startDate: bad })).toThrow(Error)
      expect(() => generateSchedule({ ...base, endDate: bad })).toThrow(Error)
    }
  })

  it('rejects endDate before startDate', () => {
    expect(() => generateSchedule({ ...base, endDate: '2026-01-30' })).toThrow(Error)
  })

  it('accepts startDate == endDate', () => {
    expect(() => generateSchedule({ ...base, endDate: base.startDate })).not.toThrow()
  })

  it('rejects a monthly rent that is not a positive integer', () => {
    for (const bad of [0, -1, 100.5, NaN, Infinity, '100000' as unknown as number]) {
      expect(() => generateSchedule({ ...base, monthlyRentSen: bad })).toThrow(Error)
    }
  })

  it('rejects a deposit that is not a non-negative integer', () => {
    for (const bad of [-1, 100.5, NaN, Infinity, '300000' as unknown as number]) {
      expect(() => generateSchedule({ ...base, depositSen: bad })).toThrow(Error)
    }
  })
})

describe('invoiceStatus', () => {
  const invoice = { dueDate: '2026-03-01', amountSen: 150_000, paidSen: 0 }

  it('paid when paidSen >= amountSen, even if overdue', () => {
    expect(
      invoiceStatus({ ...invoice, paidSen: 150_000 }, new Date('2026-04-01T00:00:00Z')),
    ).toBe('paid')
    expect(
      invoiceStatus({ ...invoice, paidSen: 200_000 }, new Date('2026-04-01T00:00:00Z')),
    ).toBe('paid')
  })

  it('overdue becomes true only at 2026-03-01T16:00:00Z', () => {
    expect(invoiceStatus(invoice, new Date('2026-03-01T15:59:59Z'))).toBe('unpaid')
    expect(invoiceStatus(invoice, new Date('2026-03-01T16:00:00Z'))).toBe('overdue')
    expect(invoiceStatus(invoice, new Date('2026-03-01T20:59:59Z'))).toBe('overdue')
  })

  it('unpaid before the due date', () => {
    expect(invoiceStatus(invoice, new Date('2026-02-28T00:00:00Z'))).toBe('unpaid')
  })

  it('partially_paid when partially paid and not overdue', () => {
    expect(
      invoiceStatus({ ...invoice, paidSen: 1 }, new Date('2026-02-28T00:00:00Z')),
    ).toBe('partially_paid')
  })

  it('overdue wins over partially_paid (rules applied in order)', () => {
    expect(
      invoiceStatus({ ...invoice, paidSen: 1 }, new Date('2026-03-02T00:00:00Z')),
    ).toBe('overdue')
  })
})

describe('malaysiaDateOf', () => {
  it('shifts UTC instants +8 hours before taking the date', () => {
    expect(utcDate(malaysiaDateOf(new Date('2026-03-01T15:59:59Z')))).toBe('2026-03-01')
    expect(utcDate(malaysiaDateOf(new Date('2026-03-01T16:00:00Z')))).toBe('2026-03-02')
    expect(utcDate(malaysiaDateOf(new Date('2026-01-01T00:00:00Z')))).toBe('2026-01-01')
    expect(utcDate(malaysiaDateOf(new Date('2025-12-31T23:59:59Z')))).toBe('2026-01-01')
  })
})

describe('parseRinggitToSen', () => {
  it('accepts plain digits, thousands separators and 1-2 decimals', () => {
    expect(parseRinggitToSen('1,500.50')).toBe(150_050)
    expect(parseRinggitToSen('1.15')).toBe(115)
    expect(parseRinggitToSen('7')).toBe(700)
    expect(parseRinggitToSen('1,500')).toBe(150_000)
    expect(parseRinggitToSen('1,234,567.89')).toBe(123_456_789)
    expect(parseRinggitToSen('0.05')).toBe(5)
    expect(parseRinggitToSen('0')).toBe(0)
    expect(parseRinggitToSen(' 1.5 ')).toBe(150)
    expect(parseRinggitToSen('00.10')).toBe(10)
  })

  it('rejects everything else', () => {
    for (const bad of [
      '',
      ' ',
      '-5',
      '1.234',
      '1e3',
      'RM 10',
      '1,23',
      '1,2345',
      ',123',
      '123,45',
      '.15',
      '1.',
      '1 500',
      '10 sen',
      '+5',
      '1.2.3',
    ]) {
      expect(() => parseRinggitToSen(bad)).toThrow(Error)
    }
  })

  it('rejects non-strings', () => {
    expect(() => parseRinggitToSen(5 as unknown as string)).toThrow(Error)
  })
})
