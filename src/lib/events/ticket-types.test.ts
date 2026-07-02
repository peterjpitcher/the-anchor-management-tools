import { describe, it, expect } from 'vitest'
import { resolveTicketTypeSellPrice, resolveBookingChargeAmount } from './ticket-types'
import { decideTicketSelectionHandling } from './ticket-type-queries'

describe('resolveTicketTypeSellPrice', () => {
  it('returns the base price unchanged for a free event (no discount applies)', () => {
    expect(resolveTicketTypeSellPrice(10, { payment_mode: 'free' })).toBe(10)
  })

  it('returns the base price unchanged for a cash_only event', () => {
    expect(resolveTicketTypeSellPrice(12.5, { payment_mode: 'cash_only' })).toBe(12.5)
  })

  it('applies a fixed online discount once for a prepaid event', () => {
    expect(
      resolveTicketTypeSellPrice(20, {
        payment_mode: 'prepaid',
        online_discount_type: 'fixed',
        online_discount_value: 5,
      }),
    ).toBe(15)
  })

  it('applies a percentage online discount once for a prepaid event', () => {
    expect(
      resolveTicketTypeSellPrice(20, {
        payment_mode: 'prepaid',
        online_discount_type: 'percent',
        online_discount_value: 25,
      }),
    ).toBe(15)
  })

  it('does NOT apply the discount when the event is not prepaid (prepaid-only rule)', () => {
    expect(
      resolveTicketTypeSellPrice(20, {
        payment_mode: 'cash_only',
        online_discount_type: 'fixed',
        online_discount_value: 5,
      }),
    ).toBe(20)
  })

  it('floors the sell price at 0 when the discount exceeds the base price', () => {
    expect(
      resolveTicketTypeSellPrice(5, {
        payment_mode: 'prepaid',
        online_discount_type: 'fixed',
        online_discount_value: 50,
      }),
    ).toBe(0)
  })

  it('coerces a non-finite base price to 0', () => {
    expect(resolveTicketTypeSellPrice(Number.NaN, { payment_mode: 'free' })).toBe(0)
  })
})

describe('resolveBookingChargeAmount', () => {
  it('returns 0 for an empty basket', () => {
    expect(resolveBookingChargeAmount([])).toBe(0)
  })

  it('sums a single line (quantity × unit_price)', () => {
    expect(resolveBookingChargeAmount([{ quantity: 3, unit_price: 10 }])).toBe(30)
  })

  it('sums a mixed multi-type basket', () => {
    expect(
      resolveBookingChargeAmount([
        { quantity: 2, unit_price: 15 }, // 30
        { quantity: 1, unit_price: 8 }, //  8
        { quantity: 3, unit_price: 5 }, // 15
      ]),
    ).toBe(53)
  })

  it('handles string-typed prices (as returned by numeric columns) and rounds to 2dp', () => {
    expect(
      resolveBookingChargeAmount([
        { quantity: 2, unit_price: '12.50' },
        { quantity: 1, unit_price: '7.25' },
      ]),
    ).toBe(32.25)
  })
})

describe('decideTicketSelectionHandling', () => {
  const DEFAULT = 'type-default'
  const OTHER = 'type-other'

  it('ignores an empty/absent basket', () => {
    expect(
      decideTicketSelectionHandling({ selections: undefined, flagEnabled: true, defaultTypeId: DEFAULT }),
    ).toEqual({ kind: 'ignore' })
    expect(
      decideTicketSelectionHandling({ selections: [], flagEnabled: false, defaultTypeId: DEFAULT }),
    ).toEqual({ kind: 'ignore' })
  })

  it('rejects a multi-type basket when the flag is off', () => {
    const decision = decideTicketSelectionHandling({
      selections: [
        { ticket_type_id: DEFAULT, quantity: 1 },
        { ticket_type_id: OTHER, quantity: 1 },
      ],
      flagEnabled: false,
      defaultTypeId: DEFAULT,
    })
    expect(decision.kind).toBe('reject')
  })

  it('rejects a single non-default-type basket when the flag is off', () => {
    const decision = decideTicketSelectionHandling({
      selections: [{ ticket_type_id: OTHER, quantity: 2 }],
      flagEnabled: false,
      defaultTypeId: DEFAULT,
    })
    expect(decision.kind).toBe('reject')
  })

  it('ignores a single default-type basket when the flag is off (falls through to legacy path)', () => {
    const decision = decideTicketSelectionHandling({
      selections: [{ ticket_type_id: DEFAULT, quantity: 2 }],
      flagEnabled: false,
      defaultTypeId: DEFAULT,
    })
    expect(decision).toEqual({ kind: 'ignore' })
  })

  it('rejects when the flag is off and there is no default type (cannot prove default-only)', () => {
    const decision = decideTicketSelectionHandling({
      selections: [{ ticket_type_id: DEFAULT, quantity: 1 }],
      flagEnabled: false,
      defaultTypeId: null,
    })
    expect(decision.kind).toBe('reject')
  })

  it('applies the basket when the flag is on', () => {
    const decision = decideTicketSelectionHandling({
      selections: [
        { ticket_type_id: DEFAULT, quantity: 1 },
        { ticket_type_id: OTHER, quantity: 2 },
      ],
      flagEnabled: true,
      defaultTypeId: DEFAULT,
    })
    expect(decision).toEqual({ kind: 'apply' })
  })
})
