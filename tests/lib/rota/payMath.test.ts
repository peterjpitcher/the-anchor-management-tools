import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  calculateActualPaidHours,
  calculatePaidHours,
  computePlannedShiftPremiumPay,
  timeToMinutes,
} from '@/lib/rota/pay-math'

describe('calculatePaidHours', () => {
  it('returns 0 for a zero-length row, which is how absence markers are stored', () => {
    // "Couldn't work" rows are saved as 00:00:00 to 00:00:00. The hand-rolled UI
    // copies used <= and made each one worth 24 hours.
    expect(calculatePaidHours('00:00:00', '00:00:00', 0)).toBe(0)
    expect(calculatePaidHours('00:00', '00:00', 0)).toBe(0)
  })

  it('returns 0 for any other equal start and end time', () => {
    expect(calculatePaidHours('19:00:00', '19:00:00', 0)).toBe(0)
    expect(calculatePaidHours('12:30', '12:30', 0)).toBe(0)
  })

  it('adds a day when is_overnight is explicitly set', () => {
    expect(calculatePaidHours('22:00', '06:00', 0, true)).toBe(8)
    // The only legitimate way to get 24 hours out of a 00:00 to 00:00 row.
    expect(calculatePaidHours('00:00:00', '00:00:00', 0, true)).toBe(24)
  })

  it('infers overnight when the end time is strictly before the start time', () => {
    expect(calculatePaidHours('19:00:00', '02:00:00', 0)).toBe(7)
    expect(calculatePaidHours('23:30', '00:30', 0)).toBe(1)
  })

  it('does not infer overnight for a same-day shift ending at midnight', () => {
    expect(calculatePaidHours('19:00:00', '00:00:00', 0)).toBe(5)
  })

  it('subtracts the unpaid break', () => {
    expect(calculatePaidHours('18:00', '23:00', 30)).toBe(4.5)
  })

  it('clamps to 0 when the unpaid break is longer than the shift, never negative', () => {
    expect(calculatePaidHours('18:00', '20:00', 180)).toBe(0)
    expect(calculatePaidHours('18:00', '20:00', 120)).toBe(0)
    expect(calculatePaidHours('00:00:00', '00:00:00', 45)).toBe(0)
  })

  it('rounds to two decimal places', () => {
    expect(calculatePaidHours('09:00', '09:20', 0)).toBe(0.33)
    expect(calculatePaidHours('09:00', '09:50', 0)).toBe(0.83)
  })
})

describe('calculateActualPaidHours', () => {
  it('returns null when the session has not been clocked out', () => {
    expect(calculateActualPaidHours('2026-08-18T17:00:00.000Z', null)).toBeNull()
  })

  it('measures the clocked interval less the unpaid break', () => {
    expect(calculateActualPaidHours('2026-08-18T17:00:00.000Z', '2026-08-18T22:30:00.000Z', 30)).toBe(5)
  })

  it('clamps to 0 when the break exceeds the clocked interval', () => {
    expect(calculateActualPaidHours('2026-08-18T17:00:00.000Z', '2026-08-18T18:00:00.000Z', 120)).toBe(0)
  })
})

describe('timeToMinutes', () => {
  it('reads both HH:mm and HH:mm:ss', () => {
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('19:30:00')).toBe(1170)
  })
})

describe('computePlannedShiftPremiumPay', () => {
  it('costs an absence marker at nothing', () => {
    const result = computePlannedShiftPremiumPay('2026-08-18', '00:00:00', '00:00:00', 0, 12.5, {
      rateMultiplier: null,
      rateOverride: null,
      premiumReason: null,
      premiumStartTime: null,
      premiumEndTime: null,
    })

    expect(result.baseHours).toBe(0)
    expect(result.premiumHours).toBe(0)
    expect(result.pay).toBe(0)
  })

  it('costs a plain shift at the base rate', () => {
    const result = computePlannedShiftPremiumPay('2026-08-18', '18:00:00', '23:00:00', 30, 12, {
      rateMultiplier: null,
      rateOverride: null,
      premiumReason: null,
      premiumStartTime: null,
      premiumEndTime: null,
    })

    expect(result.baseHours).toBe(4.5)
    expect(result.premiumHours).toBe(0)
    expect(result.pay).toBe(54)
  })
})

describe('pay-math stays client-safe', () => {
  it('imports nothing server-only, so client components can use it', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/rota/pay-math.ts'), 'utf8')
    const imports = source.match(/from\s+'[^']+'/g) ?? []

    expect(imports).not.toHaveLength(0)
    for (const line of imports) {
      expect(line).not.toContain('@/lib/supabase')
      expect(line).not.toContain('next/headers')
      expect(line).not.toContain('server-only')
    }
  })
})
