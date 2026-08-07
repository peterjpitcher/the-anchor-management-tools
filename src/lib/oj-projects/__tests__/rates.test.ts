import { describe, expect, it } from 'vitest'
import { DEFAULT_HOURLY_RATE_EX_VAT, DEFAULT_MILEAGE_RATE, resolveRate } from '../rates'

describe('resolveRate', () => {
  it('keeps a configured zero rate instead of falling through to the default', () => {
    // The regression this guards: `Number(0 || 75)` is 75, so a client set to
    // bill at zero was invoiced at the default hourly rate.
    expect(Number(0 || DEFAULT_HOURLY_RATE_EX_VAT)).toBe(75)
    expect(resolveRate(0, DEFAULT_HOURLY_RATE_EX_VAT)).toBe(0)
    expect(resolveRate(0, 62.5, DEFAULT_HOURLY_RATE_EX_VAT)).toBe(0)
  })

  it('takes the first usable candidate in order', () => {
    expect(resolveRate(62.5, 40, DEFAULT_HOURLY_RATE_EX_VAT)).toBe(62.5)
    expect(resolveRate(null, 40, DEFAULT_HOURLY_RATE_EX_VAT)).toBe(40)
    expect(resolveRate(null, undefined, DEFAULT_HOURLY_RATE_EX_VAT)).toBe(75)
    expect(resolveRate(null, undefined, DEFAULT_MILEAGE_RATE)).toBe(0.55)
  })

  it('accepts numeric strings, since Postgres numerics can arrive either way', () => {
    expect(resolveRate('62.50', DEFAULT_HOURLY_RATE_EX_VAT)).toBe(62.5)
    expect(resolveRate('0', DEFAULT_HOURLY_RATE_EX_VAT)).toBe(0)
  })

  it('skips values it cannot use', () => {
    expect(resolveRate('', 40)).toBe(40)
    expect(resolveRate('not a rate', 40)).toBe(40)
    expect(resolveRate(Number.NaN, 40)).toBe(40)
    expect(resolveRate(Number.POSITIVE_INFINITY, 40)).toBe(40)
  })

  it('returns zero rather than inventing a charge when nothing is usable', () => {
    expect(resolveRate(null, undefined)).toBe(0)
    expect(resolveRate()).toBe(0)
  })
})
