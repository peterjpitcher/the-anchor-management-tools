import { describe, it, expect } from 'vitest'
import {
  resolveTicketTypeSellPrice,
  resolveBookingChargeAmount,
  buildTicketBreakdownLines,
  formatTicketBreakdownCompact,
  type BookingItemWithTypeRow,
} from './ticket-types'
import { decideTicketSelectionHandling, bookingItemsAreMultiType } from './ticket-type-queries'

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

/* ------------------------------------------------------------------ */
/*  Per-type breakdown display helpers (item 5)                        */
/* ------------------------------------------------------------------ */

function makeItem(overrides: Partial<BookingItemWithTypeRow> = {}): BookingItemWithTypeRow {
  return {
    id: 'item-1',
    booking_id: 'booking-1',
    ticket_type_id: 'type-regular',
    quantity: 1,
    unit_price: 20,
    attendee_names: null,
    ticket_type_name: 'Regular Ticket',
    ticket_type_sort_order: 0,
    ...overrides,
  }
}

describe('buildTicketBreakdownLines', () => {
  it('returns ordered lines with per-type names for a multi-type booking', () => {
    const lines = buildTicketBreakdownLines([
      makeItem({
        id: 'item-2',
        ticket_type_id: 'type-non-alcohol',
        quantity: 1,
        unit_price: 10,
        attendee_names: ['Bob Jones'],
        ticket_type_name: 'Non-Alcohol Ticket',
        ticket_type_sort_order: 1,
      }),
      makeItem({ quantity: 1, unit_price: 20, attendee_names: ['Jane Smith'] }),
    ])

    expect(lines).toEqual([
      { typeName: 'Regular Ticket', quantity: 1, unitPrice: 20, attendeeNames: ['Jane Smith'] },
      { typeName: 'Non-Alcohol Ticket', quantity: 1, unitPrice: 10, attendeeNames: ['Bob Jones'] },
    ])
  })

  it('trims attendee names and drops blank entries', () => {
    const lines = buildTicketBreakdownLines([
      makeItem({ quantity: 2, attendee_names: ['  Jane Smith  ', '', '   '] }),
    ])
    expect(lines[0].attendeeNames).toEqual(['Jane Smith'])
  })

  it('coerces numeric-string unit prices from the DB', () => {
    const lines = buildTicketBreakdownLines([makeItem({ unit_price: '10.50' })])
    expect(lines[0].unitPrice).toBe(10.5)
  })

  it('returns an empty array when the booking has no items (legacy display fallback)', () => {
    expect(buildTicketBreakdownLines([])).toEqual([])
  })
})

describe('formatTicketBreakdownCompact', () => {
  it('formats a multi-type booking as a compact one-liner', () => {
    const lines = buildTicketBreakdownLines([
      makeItem({ quantity: 1 }),
      makeItem({
        id: 'item-2',
        ticket_type_id: 'type-non-alcohol',
        quantity: 2,
        unit_price: 10,
        ticket_type_name: 'Non-Alcohol Ticket',
        ticket_type_sort_order: 1,
      }),
    ])
    expect(formatTicketBreakdownCompact(lines)).toBe('1× Regular Ticket, 2× Non-Alcohol Ticket')
  })

  it('returns an empty string when there are no lines (single-type output unchanged)', () => {
    expect(formatTicketBreakdownCompact([])).toBe('')
  })
})

describe('bookingItemsAreMultiType (display gating)', () => {
  it('is false for a single default-type line, so single-type bookings keep the legacy display', () => {
    expect(bookingItemsAreMultiType([{ ticket_type_id: 'type-regular' }], 'type-regular')).toBe(false)
  })

  it('is true for two lines (breakdown shown)', () => {
    expect(
      bookingItemsAreMultiType(
        [{ ticket_type_id: 'type-regular' }, { ticket_type_id: 'type-non-alcohol' }],
        'type-regular',
      ),
    ).toBe(true)
  })

  it('is true for a single non-default line (type name is meaningful)', () => {
    expect(bookingItemsAreMultiType([{ ticket_type_id: 'type-non-alcohol' }], 'type-regular')).toBe(true)
  })

  it('is false when there are no items (missing items fall back to legacy display)', () => {
    expect(bookingItemsAreMultiType([], 'type-regular')).toBe(false)
  })
})
