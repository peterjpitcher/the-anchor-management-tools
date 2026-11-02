import { describe, expect, it } from 'vitest'

import { MAX_DISCOUNT_GIVEN_PENCE, parseDiscountGiven, redeemedVoucherPence } from '../discount'

describe('parseDiscountGiven', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['£6.05', 605],
    ['£ 0', 0],
  ])('reads %j as %j pence', (input, pence) => {
    expect(parseDiscountGiven(input)).toEqual({ ok: true, pence })
  })

  it.each(['-1', '1.234', 'abc', '1,50', '12.', '.5', 'NaN'])('refuses %j rather than guessing', (input) => {
    expect(parseDiscountGiven(input).ok).toBe(false)
  })

  it('refuses more than the database accepts', () => {
    expect(parseDiscountGiven('10000').ok).toBe(true)
    expect(parseDiscountGiven('10000.01').ok).toBe(false)
    expect(MAX_DISCOUNT_GIVEN_PENCE).toBe(1_000_000)
  })
})

describe('redeemedVoucherPence', () => {
  it('prefers the discount actually given', () => {
    expect(redeemedVoucherPence({ value_pence: 600, redeemed_value_pence: 412 })).toBe(412)
  })

  it('keeps a recorded zero instead of falling back to the estimate', () => {
    expect(redeemedVoucherPence({ value_pence: 600, redeemed_value_pence: 0 })).toBe(0)
  })

  it('falls back to the estimate, then to nothing', () => {
    expect(redeemedVoucherPence({ value_pence: 600, redeemed_value_pence: null })).toBe(600)
    expect(redeemedVoucherPence({ value_pence: 600 })).toBe(600)
    expect(redeemedVoucherPence({ value_pence: null })).toBe(0)
  })
})
