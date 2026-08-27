import { describe, expect, it } from 'vitest'
import {
  InvoiceMappingError,
  mapBookingToInvoice,
  type MappableBooking,
} from '@/lib/private-bookings/invoice-mapper'
import { computeBookingMoney } from '@/lib/private-bookings/vat'
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations'
import type { PrivateBookingItem } from '@/types/private-bookings'

/**
 * Item factory. Mirrors what PostgREST actually returns, including numeric
 * columns arriving as strings, because that is the shape the mapper has to
 * survive in production.
 */
function item(overrides: Partial<PrivateBookingItem> & { line_total: number }): PrivateBookingItem {
  return {
    id: `item-${Math.abs(overrides.display_order ?? 1)}`,
    booking_id: 'booking-1',
    item_type: 'catering',
    description: 'Test item',
    quantity: 1,
    unit_price: 0,
    discount_type: null,
    discount_value: 0,
    vat_rate: 20,
    display_order: 0,
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  } as unknown as PrivateBookingItem
}

/** Every fixture must reconcile: the mapper's own guard, asserted independently. */
function expectReconciles(booking: MappableBooking) {
  const result = mapBookingToInvoice(booking)
  const money = computeBookingMoney(
    (booking.items ?? []).map(i => ({
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      line_total: i.line_total == null ? null : Number(i.line_total),
      vat_rate: Number(i.vat_rate),
      discount_type: i.discount_type ?? null,
      discount_value: Number(i.discount_value ?? 0),
    })),
    booking.discount_type ?? null,
    booking.discount_amount ?? null,
  )

  expect(result.totals.total_amount).toBe(money.grossTotal)

  const rendered = calculateInvoiceTotals(
    result.lineItems.map(l => ({
      quantity: l.quantity,
      unit_price: l.unit_price,
      discount_percentage: l.discount_percentage,
      vat_rate: l.vat_rate,
    })),
    result.totals.invoice_discount_percentage,
  )
  expect(rendered.totalAmount).toBe(money.grossTotal)

  return result
}

describe('mapBookingToInvoice', () => {
  describe('room hire given away at 100% off', () => {
    // The single most common real shape: 19 of 68 live items are a zero line
    // after a 100% discount. The customer should SEE the value being waived,
    // so the discount must survive onto the invoice line rather than being
    // folded into a £0.00 unit price.
    const booking: MappableBooking = {
      items: [
        item({
          item_type: 'space',
          description: 'The Dining Room',
          quantity: 4,
          unit_price: 25,
          discount_type: 'percent',
          discount_value: 100,
          line_total: 0,
          display_order: 0,
        }),
        item({
          description: 'Finger Buffet',
          quantity: 20,
          unit_price: 16,
          line_total: 320,
          display_order: 1,
        }),
      ],
    }

    it('keeps the real quantity, price and discount on the line', () => {
      const { lineItems } = expectReconciles(booking)
      expect(lineItems[0]).toMatchObject({
        quantity: 4,
        unit_price: 25,
        discount_percentage: 100,
      })
      expect(lineItems[0].description).toContain('The Dining Room')
    })

    it('prefixes the description with the charge category', () => {
      const { lineItems } = mapBookingToInvoice(booking)
      expect(lineItems[0].description).toBe('Venue hire: The Dining Room')
      expect(lineItems[1].description).toBe('Food and drink: Finger Buffet')
    })

    it('charges only the buffet', () => {
      const { totals } = mapBookingToInvoice(booking)
      expect(totals.subtotal_amount).toBe(320)
      expect(totals.vat_amount).toBe(64)
      expect(totals.total_amount).toBe(384)
    })

    it('raises no warnings', () => {
      expect(mapBookingToInvoice(booking).warnings).toEqual([])
    })
  })

  describe('Susan Herd, a real live booking', () => {
    // gross_total 1140.00 in private_bookings_with_details, verified 2026-08-27
    const booking: MappableBooking = {
      items: [
        item({ item_type: 'space', description: 'The Dining Room', quantity: 4, unit_price: 200, line_total: 800, display_order: 0 }),
        item({ description: 'Finger Buffet', quantity: 10, unit_price: 15, line_total: 150, display_order: 1 }),
      ],
    }

    it('totals £1,140.00 exactly, matching the contract', () => {
      const { totals } = expectReconciles(booking)
      expect(totals.subtotal_amount).toBe(950)
      expect(totals.vat_amount).toBe(190)
      expect(totals.total_amount).toBe(1140)
    })
  })

  describe('Margaret Lucas, a real booking with a fixed-amount discount', () => {
    // Live: items 100.00 + 320.00 = 420.00 net, discount_type fixed £84.00,
    // calculated_total 336.00, gross_total 403.20. Verified 2026-08-27.
    const booking: MappableBooking = {
      items: [
        item({ item_type: 'space', description: 'The Dining Room', quantity: 4, unit_price: 25, line_total: 100, display_order: 0 }),
        item({ description: 'Finger Buffet', quantity: 20, unit_price: 16, line_total: 320, display_order: 1 }),
      ],
      discount_type: 'fixed',
      discount_amount: 84,
    }

    it('reproduces the live gross total of £403.20', () => {
      const { totals } = expectReconciles(booking)
      expect(totals.total_amount).toBe(403.2)
      expect(totals.subtotal_amount).toBe(336)
      expect(totals.vat_amount).toBe(67.2)
    })

    it('spreads the discount across the lines rather than using a percentage', () => {
      // invoice_discount_percentage is numeric and capped at 2dp, so a fixed
      // amount converted to a percentage drifts. Spreading keeps it exact.
      const { totals, lineItems } = mapBookingToInvoice(booking)
      expect(totals.invoice_discount_percentage).toBe(0)
      // The quantity survives and the unit price is restated, so the customer
      // still reads "4 hrs @ £20.00" rather than a single opaque charge.
      expect(lineItems[0]).toMatchObject({ quantity: 4, unit_price: 20 })
      expect(lineItems[1]).toMatchObject({ quantity: 20, unit_price: 12.8 })
    })

    it('warns the operator that the discount is not shown separately', () => {
      const { warnings } = mapBookingToInvoice(booking)
      expect(warnings.join(' ')).toContain('£84.00 booking discount is spread')
    })
  })

  describe('booking-level percentage discount', () => {
    const booking: MappableBooking = {
      items: [item({ description: 'Finger Buffet', quantity: 10, unit_price: 20, line_total: 200, display_order: 0 })],
      discount_type: 'percent',
      discount_amount: 10,
    }

    it('carries it as the invoice discount so the customer sees it', () => {
      const { totals } = expectReconciles(booking)
      expect(totals.invoice_discount_percentage).toBe(10)
      expect(totals.subtotal_amount).toBe(200)
      expect(totals.discount_amount).toBe(20)
      expect(totals.total_amount).toBe(216)
    })
  })

  describe('per-head charge over an awkward guest count', () => {
    it('stays exact at 37 guests', () => {
      const { totals } = expectReconciles({
        items: [item({ description: 'Hog Roast', quantity: 37, unit_price: 18.5, line_total: 684.5, display_order: 0 })],
      })
      expect(totals.subtotal_amount).toBe(684.5)
      expect(totals.total_amount).toBe(821.4)
    })

    it('stays exact at 13 guests on an odd unit price', () => {
      const { totals } = expectReconciles({
        items: [item({ description: 'Afternoon Tea', quantity: 13, unit_price: 17.99, line_total: 233.87, display_order: 0 })],
      })
      expect(totals.total_amount).toBe(280.64)
    })
  })

  describe('item-level fixed discount', () => {
    it('collapses to one exact charge when it does not divide evenly', () => {
      const result = expectReconciles({
        items: [
          item({
            description: 'Finger Buffet',
            quantity: 3,
            unit_price: 20,
            discount_type: 'fixed',
            discount_value: 10,
            line_total: 50,
            display_order: 0,
          }),
        ],
      })
      // 50 / 3 is not representable at 2dp, so the line becomes 1 x £50.00
      // and the detail moves into the description rather than drifting.
      expect(result.lineItems[0]).toMatchObject({ quantity: 1, unit_price: 50, discount_percentage: 0 })
      expect(result.lineItems[0].description).toContain('3 at £20.00')
      expect(result.lineItems[0].description).toContain('less £10.00 discount')
      expect(result.warnings.join(' ')).toContain('does not divide evenly')
    })

    it('keeps the natural shape when it does divide evenly', () => {
      const result = expectReconciles({
        items: [
          item({
            description: 'Finger Buffet',
            quantity: 4,
            unit_price: 20,
            discount_type: 'fixed',
            discount_value: 20,
            line_total: 60,
            display_order: 0,
          }),
        ],
      })
      // 60 / 4 = 15.00 exactly, so the per-unit shape survives.
      expect(result.lineItems[0]).toMatchObject({ quantity: 4, unit_price: 15, discount_percentage: 0 })
      expect(result.warnings).toEqual([])
    })
  })

  describe('ordering', () => {
    it('follows display_order, not array order', () => {
      const { lineItems } = mapBookingToInvoice({
        items: [
          item({ description: 'Second', quantity: 1, unit_price: 10, line_total: 10, display_order: 5 }),
          item({ description: 'First', quantity: 1, unit_price: 10, line_total: 10, display_order: 1 }),
        ],
      })
      expect(lineItems.map(l => l.description)).toEqual([
        'Food and drink: First',
        'Food and drink: Second',
      ])
      expect(lineItems.map(l => l.display_order)).toEqual([1, 2])
    })
  })

  describe('numeric columns arriving as strings', () => {
    it('handles PostgREST string numerics without producing NaN', () => {
      const { totals } = mapBookingToInvoice({
        items: [
          item({
            description: 'Finger Buffet',
            quantity: '20' as unknown as number,
            unit_price: '16.00' as unknown as number,
            vat_rate: '20.00' as unknown as number,
            line_total: '320.00' as unknown as number,
            display_order: 0,
          }),
        ],
      })
      expect(totals.total_amount).toBe(384)
      expect(Number.isNaN(totals.total_amount)).toBe(false)
    })
  })

  describe('mixed VAT rates', () => {
    it('reconciles when a zero-rated line sits alongside a standard one', () => {
      const { totals } = expectReconciles({
        items: [
          item({ description: 'Buffet', quantity: 10, unit_price: 20, vat_rate: 20, line_total: 200, display_order: 0 }),
          item({ description: 'Cold Food', quantity: 10, unit_price: 10, vat_rate: 0, line_total: 100, display_order: 1 }),
        ],
      })
      expect(totals.subtotal_amount).toBe(300)
      expect(totals.vat_amount).toBe(40)
      expect(totals.total_amount).toBe(340)
    })
  })

  describe('refusals', () => {
    it('refuses a booking with no items', () => {
      expect(() => mapBookingToInvoice({ items: [] })).toThrow(InvoiceMappingError)
      try {
        mapBookingToInvoice({ items: [] })
      } catch (error) {
        expect((error as InvoiceMappingError).code).toBe('booking_has_no_priced_items')
      }
    })

    it('refuses a booking whose items are all worth nothing', () => {
      // Every item 100% discounted. There is nothing to charge for, so an
      // invoice would be a demand for £0.00.
      try {
        mapBookingToInvoice({
          items: [
            item({
              item_type: 'space',
              description: 'The Dining Room',
              quantity: 3,
              unit_price: 25,
              discount_type: 'percent',
              discount_value: 100,
              line_total: 0,
              display_order: 0,
            }),
          ],
        })
        throw new Error('should have refused')
      } catch (error) {
        expect(error).toBeInstanceOf(InvoiceMappingError)
        expect((error as InvoiceMappingError).code).toBe('booking_has_no_priced_items')
      }
    })
  })
})
