import { describe, expect, it } from 'vitest'

import {
  buildRangeFromPreset,
  getDefaultInsightsTimeframe,
  validateInsightsRange,
} from '@/lib/short-link-insights-timeframes'

describe('short link insights timeframe presets', () => {
  it('builds hourly preset windows aligned to hour boundaries', () => {
    const now = new Date('2026-02-22T15:42:00.000Z')
    const range = buildRangeFromPreset('hour', '24h', now)

    expect(range.endAt.toISOString()).toBe('2026-02-22T15:00:00.000Z')
    expect(range.startAt.toISOString()).toBe('2026-02-21T15:00:00.000Z')
  })

  it('builds monthly preset windows aligned to month boundaries', () => {
    const now = new Date('2026-02-22T15:42:00.000Z')
    const range = buildRangeFromPreset('month', '3m', now)

    expect(range.endAt.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(range.startAt.toISOString()).toBe('2025-11-01T00:00:00.000Z')
  })
})

describe('short link insights timeframe validation', () => {
  it('rejects invalid custom ranges where start is after end', () => {
    const result = validateInsightsRange(
      new Date('2026-02-22T12:00:00.000Z'),
      new Date('2026-02-21T12:00:00.000Z'),
      'hour'
    )

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('Start time must be before end time')
    }
  })

  it('rejects hourly ranges that exceed the guardrail', () => {
    const result = validateInsightsRange(
      new Date('2025-12-01T00:00:00.000Z'),
      new Date('2026-02-22T00:00:00.000Z'),
      'hour'
    )

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('too large')
    }
  })

  it('defaults to hourly, last 24h, human-only', () => {
    const now = new Date('2026-02-22T15:42:00.000Z')
    const defaults = getDefaultInsightsTimeframe(now)

    expect(defaults.granularity).toBe('hour')
    expect(defaults.includeBots).toBe(false)
    expect(defaults.preset).toBe('24h')
    expect(defaults.startAt.toISOString()).toBe('2026-02-21T15:00:00.000Z')
    expect(defaults.endAt.toISOString()).toBe('2026-02-22T15:00:00.000Z')
  })
})
