import { describe, expect, it } from 'vitest'
import { normalizeEventPricingFields, resolveEventPaymentMode, resolveEventPriceAmount } from './pricing'

describe('event pricing', () => {
  it('uses a positive price even when stale free fields are present', () => {
    const event = {
      price: 3,
      price_per_seat: 0,
      is_free: true,
      payment_mode: 'free',
    }

    expect(resolveEventPriceAmount(event)).toBe(3)
    expect(resolveEventPaymentMode(event)).toBe('cash_only')
    expect(normalizeEventPricingFields(event)).toEqual({
      price: 3,
      is_free: false,
      payment_mode: 'cash_only',
    })
  })

  it('keeps prepaid for positive price prepaid events', () => {
    expect(normalizeEventPricingFields({
      price: 10,
      is_free: false,
      payment_mode: 'prepaid',
    })).toEqual({
      price: 10,
      is_free: false,
      payment_mode: 'prepaid',
    })
  })

  it('normalises zero price free events', () => {
    expect(normalizeEventPricingFields({
      price: 0,
      is_free: true,
      payment_mode: null,
    })).toEqual({
      price: 0,
      is_free: true,
      payment_mode: 'free',
    })
  })
})
