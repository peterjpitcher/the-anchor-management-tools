import { describe, expect, it } from 'vitest'

import {
  resolveEventOnlineDiscountAmount,
  resolveEventPaymentMode,
  resolveEventPriceAmount,
  resolveEventTicketPriceAmount,
} from '@/lib/events/pricing'

describe('event pricing helpers', () => {
  it('falls back to event price when price_per_seat is stored as zero', () => {
    const event = {
      is_free: false,
      payment_mode: 'cash_only',
      price_per_seat: 0,
      price: 3,
    }

    expect(resolveEventPriceAmount(event)).toBe(3)
    expect(resolveEventTicketPriceAmount(event)).toBe(3)
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

  it('does not treat a positive-price event as free when stale free fields are present', () => {
    const event = {
      is_free: true,
      payment_mode: 'free',
      price_per_seat: 0,
      price: 10,
    }

    expect(resolveEventPriceAmount(event)).toBe(10)
    expect(resolveEventPaymentMode(event)).toBe('cash_only')
  })

  it('applies a fixed online discount to the payable price only', () => {
    const event = {
      is_free: false,
      payment_mode: 'prepaid',
      price: 10,
      online_discount_type: 'fixed',
      online_discount_value: 2,
    }

    expect(resolveEventTicketPriceAmount(event)).toBe(10)
    expect(resolveEventOnlineDiscountAmount(event)).toBe(2)
    expect(resolveEventPriceAmount(event)).toBe(8)
    expect(resolveEventPaymentMode(event)).toBe('prepaid')
  })

  it('applies a percentage online discount to the payable price only', () => {
    const event = {
      is_free: false,
      payment_mode: 'prepaid',
      price: 12,
      online_discount_type: 'percent',
      online_discount_value: 25,
    }

    expect(resolveEventTicketPriceAmount(event)).toBe(12)
    expect(resolveEventOnlineDiscountAmount(event)).toBe(3)
    expect(resolveEventPriceAmount(event)).toBe(9)
  })
})
