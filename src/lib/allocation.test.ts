import { describe, expect, it } from 'vitest'

import { planAllocation, type PlanInvoice } from './allocation'

function inv(overrides: Partial<PlanInvoice> & { id: string }): PlanInvoice {
  return {
    kind: 'rent',
    periodIndex: 0,
    dueDate: '2026-01-31',
    amountSen: 100_000,
    paidSen: 0,
    ...overrides,
  }
}

describe('planAllocation', () => {
  it('fills the earliest due invoice first, in order', () => {
    const invoices = [
      inv({ id: 'b', dueDate: '2026-02-28', periodIndex: 1 }),
      inv({ id: 'a', dueDate: '2026-01-31', periodIndex: 0 }),
    ]
    const plan = planAllocation(invoices, 150_000)
    expect(plan.allocations).toEqual([
      { invoiceId: 'a', amountSen: 100_000 },
      { invoiceId: 'b', amountSen: 50_000 },
    ])
    expect(plan.unappliedSen).toBe(0)
  })

  it('puts the deposit before rent when due dates tie', () => {
    // Aisyah period 0 and the deposit share the start date as due date.
    const invoices = [
      inv({ id: 'rent', dueDate: '2026-01-31' }),
      inv({ id: 'dep', kind: 'deposit', periodIndex: null, dueDate: '2026-01-31' }),
    ]
    const plan = planAllocation(invoices, 50_000)
    expect(plan.allocations).toEqual([{ invoiceId: 'dep', amountSen: 50_000 }])
  })

  it('skips fully paid invoices', () => {
    const invoices = [
      inv({ id: 'a', paidSen: 100_000 }),
      inv({ id: 'b', dueDate: '2026-02-28', periodIndex: 1 }),
    ]
    const plan = planAllocation(invoices, 40_000)
    expect(plan.allocations).toEqual([{ invoiceId: 'b', amountSen: 40_000 }])
    expect(plan.unappliedSen).toBe(0)
  })

  it('tops up a partially paid invoice before moving to the next', () => {
    const invoices = [
      inv({ id: 'a', paidSen: 30_000 }),
      inv({ id: 'b', dueDate: '2026-02-28', periodIndex: 1 }),
    ]
    const plan = planAllocation(invoices, 120_000)
    expect(plan.allocations).toEqual([
      { invoiceId: 'a', amountSen: 70_000 },
      { invoiceId: 'b', amountSen: 50_000 },
    ])
  })

  it('includes invoices that are not due yet', () => {
    const invoices = [inv({ id: 'future', dueDate: '2027-01-31', periodIndex: 11 })]
    const plan = planAllocation(invoices, 80_000)
    expect(plan.allocations).toEqual([{ invoiceId: 'future', amountSen: 80_000 }])
  })

  it('stores whatever is left over as unapplied', () => {
    const invoices = [inv({ id: 'only', amountSen: 30_000 })]
    const plan = planAllocation(invoices, 45_000)
    expect(plan.allocations).toEqual([{ invoiceId: 'only', amountSen: 30_000 }])
    expect(plan.unappliedSen).toBe(15_000)
  })

  it('sorts equal due dates by period index for rent', () => {
    const invoices = [
      inv({ id: 'p2', periodIndex: 2 }),
      inv({ id: 'p1', periodIndex: 1 }),
      inv({ id: 'p0', periodIndex: 0 }),
    ]
    const plan = planAllocation(invoices, 250_000)
    expect(plan.allocations.map((a) => a.invoiceId)).toEqual(['p0', 'p1', 'p2'])
  })

  it('never allocates to a negative or zero amount', () => {
    const plan = planAllocation([inv({ id: 'a' })], 0)
    expect(plan.allocations).toEqual([])
    expect(plan.unappliedSen).toBe(0)
  })
})
