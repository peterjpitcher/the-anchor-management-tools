import { describe, it, expect } from 'vitest'
import { computeBookingMoney, itemLineTotal, DEFAULT_VAT_RATE } from '../vat'

describe('itemLineTotal', () => {
  it('should honour a DB-provided line_total', () => {
    expect(itemLineTotal({ quantity: 2, unit_price: 10, line_total: 15 })).toBe(15)
  })

  it('should compute quantity × unit_price when line_total is absent', () => {
    expect(itemLineTotal({ quantity: 3, unit_price: 12.5 })).toBe(37.5)
  })

  it('should apply item-level percent and fixed discounts', () => {
    expect(itemLineTotal({ quantity: 1, unit_price: 100, discount_type: 'percent', discount_value: 10 })).toBe(90)
    expect(itemLineTotal({ quantity: 1, unit_price: 100, discount_type: 'fixed', discount_value: 25 })).toBe(75)
  })
})

describe('computeBookingMoney', () => {
  it('should return zeros for an empty booking', () => {
    expect(computeBookingMoney([])).toEqual({ netTotal: 0, discountedNet: 0, vatAmount: 0, grossTotal: 0 })
  })

  it('should add VAT at the default 20% rate to net prices', () => {
    const money = computeBookingMoney([{ quantity: 1, unit_price: 100 }])
    expect(DEFAULT_VAT_RATE).toBe(20)
    expect(money.netTotal).toBe(100)
    expect(money.vatAmount).toBe(20)
    expect(money.grossTotal).toBe(120)
  })

  it('should respect per-item VAT rates', () => {
    const money = computeBookingMoney([
      { quantity: 1, unit_price: 100, vat_rate: 20 },
      { quantity: 1, unit_price: 50, vat_rate: 0 },
    ])
    expect(money.netTotal).toBe(150)
    expect(money.vatAmount).toBe(20)
    expect(money.grossTotal).toBe(170)
  })

  it('should apply booking-level percent discounts to net before VAT', () => {
    const money = computeBookingMoney([{ quantity: 1, unit_price: 100, vat_rate: 20 }], 'percent', 10)
    expect(money.discountedNet).toBe(90)
    expect(money.vatAmount).toBe(18)
    expect(money.grossTotal).toBe(108)
  })

  it('should spread fixed discounts pro-rata across mixed VAT rates', () => {
    const money = computeBookingMoney(
      [
        { quantity: 1, unit_price: 100, vat_rate: 20 },
        { quantity: 1, unit_price: 100, vat_rate: 0 },
      ],
      'fixed',
      50,
    )
    // factor = 150/200 = 0.75 → VAT = 20 × 0.75 = 15
    expect(money.discountedNet).toBe(150)
    expect(money.vatAmount).toBe(15)
    expect(money.grossTotal).toBe(165)
  })

  it('should never go below zero on an over-sized fixed discount', () => {
    const money = computeBookingMoney([{ quantity: 1, unit_price: 50 }], 'fixed', 100)
    expect(money.discountedNet).toBe(0)
    expect(money.vatAmount).toBe(0)
    expect(money.grossTotal).toBe(0)
  })

  it('should round money to 2 decimal places', () => {
    const money = computeBookingMoney([{ quantity: 3, unit_price: 9.99, vat_rate: 20 }])
    expect(money.netTotal).toBe(29.97)
    expect(money.vatAmount).toBe(5.99)
    expect(money.grossTotal).toBe(35.96)
  })
})
