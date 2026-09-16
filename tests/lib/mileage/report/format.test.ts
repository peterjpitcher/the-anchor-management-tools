import { describe, expect, it } from 'vitest'
import {
  formatGeneratedAt,
  formatMilesText,
  formatPlainMiles,
  formatPlainPounds,
  formatPoundsText,
} from '@/lib/mileage/report/format'

describe('report formatting', () => {
  it('formats miles and money from whole numbers', () => {
    expect(formatMilesText(11050)).toBe('1,105.0')
    expect(formatMilesText(34)).toBe('3.4')
    expect(formatPoundsText(386489)).toBe('£3,864.89')
    expect(formatPoundsText(5)).toBe('£0.05')
    expect(formatPlainMiles(11050)).toBe('1105.0')
    expect(formatPlainPounds(386489)).toBe('3864.89')
  })

  it('shows zero without a stray sign or missing digits', () => {
    expect(formatMilesText(0)).toBe('0.0')
    expect(formatPoundsText(0)).toBe('£0.00')
    expect(formatPlainMiles(0)).toBe('0.0')
    expect(formatPlainPounds(0)).toBe('0.00')
  })

  it('shows the generated time in UK time in summer and winter', () => {
    expect(formatGeneratedAt('2026-10-02T13:05:00.123456+00:00')).toBe('2 October 2026 at 14:05 (UK time)')
    expect(formatGeneratedAt('2026-12-02T13:05:00+00:00')).toBe('2 December 2026 at 13:05 (UK time)')
    expect(formatGeneratedAt('2026-10-02T11:00:00+00:00')).toBe('2 October 2026 at 12:00 (UK time)')
  })

  it('shows midnight UK time on the right day', () => {
    expect(formatGeneratedAt('2026-06-30T23:30:00+00:00')).toBe('1 July 2026 at 00:30 (UK time)')
  })
})
