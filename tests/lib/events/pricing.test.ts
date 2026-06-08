import { describe, expect, it } from 'vitest'

import { resolveEventPaymentMode, resolveEventPriceAmount } from '@/lib/events/pricing'

describe('event pricing helpers', () => {
  it('falls back to event price when price_per_seat is stored as zero', () => {
    const event = {
      is_free: false,
      payment_mode: 'cash_only',
      price_per_seat: 0,
      price: 3,
    }

    expect(resolveEventPriceAmount(event)).toBe(3)
    expect(resolveEventPaymentMode(event)).toBe('cash_only')
  })

  it('does not report free payment mode when a positive price is present', () => {
    const event = {
      is_free: false,
      payment_mode: 'free',
      price_per_seat: 0,
      price: 10,
    }

    expect(resolveEventPriceAmount(event)).toBe(10)
    expect(resolveEventPaymentMode(event)).toBe('cash_only')
  })

  it('keeps explicit free events free', () => {
    const event = {
      is_free: true,
      payment_mode: 'free',
      price_per_seat: 0,
      price: 10,
    }

    expect(resolveEventPriceAmount(event)).toBe(0)
    expect(resolveEventPaymentMode(event)).toBe('free')
  })
})
