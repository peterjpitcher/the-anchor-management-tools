import { describe, expect, it } from 'vitest'
import {
  normalizeEventPricingFields,
  resolveEventOnlineDiscountAmount,
  resolveEventPaymentMode,
  resolveEventPriceAmount,
  resolveEventTicketPriceAmount,
} from './pricing'

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
      online_discount_type: null,
      online_discount_value: null,
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
      online_discount_type: null,
      online_discount_value: null,
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
      online_discount_type: null,
      online_discount_value: null,
      is_free: true,
      payment_mode: 'free',
    })
  })

  it('applies online discounts only to prepaid payment amounts', () => {
    const event = {
      price: 10,
      is_free: false,
      payment_mode: 'prepaid',
      online_discount_type: 'fixed',
      online_discount_value: 2,
    }

    expect(resolveEventTicketPriceAmount(event)).toBe(10)
    expect(resolveEventOnlineDiscountAmount(event)).toBe(2)
    expect(resolveEventPriceAmount(event)).toBe(8)
    expect(normalizeEventPricingFields(event)).toEqual({
      price: 10,
      online_discount_type: 'fixed',
      online_discount_value: 2,
      is_free: false,
      payment_mode: 'prepaid',
    })
  })

  it('ignores online discounts for cash-only events', () => {
    const event = {
      price: 10,
      is_free: false,
      payment_mode: 'cash_only',
      online_discount_type: 'fixed',
      online_discount_value: 2,
    }

    expect(resolveEventOnlineDiscountAmount(event)).toBe(0)
    expect(resolveEventPriceAmount(event)).toBe(10)
    expect(normalizeEventPricingFields(event)).toEqual({
      price: 10,
      online_discount_type: null,
      online_discount_value: null,
      is_free: false,
      payment_mode: 'cash_only',
    })
  })
})
