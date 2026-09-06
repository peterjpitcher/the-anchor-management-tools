import { describe, expect, it } from 'vitest'
import {
  IMAGE_RATE_TABLE,
  UNKNOWN_RATE_VERSION,
  calculateAttemptCost,
  estimateRunCostUsd,
  type ImageUsage,
} from './pricing'

const MODEL = 'gpt-image-2'

/** The four adaptations a real run produces. */
const RUN_VARIANTS = [
  { width: 1600, height: 2272 }, // poster
  { width: 1936, height: 1088 }, // landscape
  { width: 1920, height: 1008 }, // social
  { width: 1088, height: 1936 }, // story
]

describe('IMAGE_RATE_TABLE', () => {
  it('orders entries by effectiveFrom and gives each one an ISO date', () => {
    expect(IMAGE_RATE_TABLE.length).toBeGreaterThan(0)
    for (const entry of IMAGE_RATE_TABLE) {
      expect(entry.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(entry.effectiveFrom))).toBe(false)
      expect(entry.rateVersion).toContain(entry.effectiveFrom)
    }
    const dates = IMAGE_RATE_TABLE.map((entry) => entry.effectiveFrom)
    expect(dates).toEqual([...dates].sort())
  })

  it('carries the published token rates for both image models', () => {
    const two = IMAGE_RATE_TABLE.find((entry) => entry.model === 'gpt-image-2')
    const onePointFive = IMAGE_RATE_TABLE.find((entry) => entry.model === 'gpt-image-1.5')
    expect(two?.imageOutputPerMillionUsd).toBe(30)
    expect(onePointFive?.imageOutputPerMillionUsd).toBe(32)
    expect(two?.textInputPerMillionUsd).toBe(5)
    expect(two?.imageInputPerMillionUsd).toBe(8)
  })

  it('keeps medium at a quarter of high, as published', () => {
    const two = IMAGE_RATE_TABLE.find((entry) => entry.model === 'gpt-image-2')
    const medium = two?.referencePricesUsd.medium ?? []
    const high = two?.referencePricesUsd.high ?? []
    expect(medium).toHaveLength(3)
    medium.forEach((price, index) => {
      expect(price.priceUsd).toBeCloseTo(high[index].priceUsd / 4, 2)
    })
  })
})

describe('calculateAttemptCost, calculated path', () => {
  it('prices a realistic usage object exactly from the token counts', () => {
    const usage: ImageUsage = {
      input_tokens: 1500,
      input_tokens_details: { text_tokens: 500, image_tokens: 1000 },
      output_tokens: 4160,
      total_tokens: 5660,
    }

    // 500 text @ $5/1M   = 0.0025
    // 1000 image @ $8/1M = 0.008
    // 4160 out @ $30/1M  = 0.1248
    const result = calculateAttemptCost(usage, MODEL, 1024, 1536, 'medium')
    expect(result.basis).toBe('calculated')
    expect(result.costUsd).toBe(0.1353)
    expect(result.rateVersion).toBe('gpt-image-2@2026-09-06')
  })

  it('uses the model own output rate, so gpt-image-1.5 costs more than gpt-image-2', () => {
    const usage: ImageUsage = { output_tokens: 1_000_000 }
    expect(calculateAttemptCost(usage, 'gpt-image-2', 1024, 1024, 'high').costUsd).toBe(30)
    expect(calculateAttemptCost(usage, 'gpt-image-1.5', 1024, 1024, 'high').costUsd).toBe(32)
  })

  it('charges input at the text rate when the details breakdown is absent', () => {
    const usage: ImageUsage = { input_tokens: 2000, output_tokens: 0, total_tokens: 2000 }
    const result = calculateAttemptCost(usage, MODEL, 1024, 1024, 'medium')
    expect(result.basis).toBe('calculated')
    expect(result.costUsd).toBe(0.01) // 2000 @ $5/1M
  })

  it('ignores the quality label once real token counts exist', () => {
    const usage: ImageUsage = {
      input_tokens: 400,
      input_tokens_details: { text_tokens: 400, image_tokens: 0 },
      output_tokens: 1000,
    }
    const auto = calculateAttemptCost(usage, MODEL, 1024, 1024, 'auto')
    expect(auto.basis).toBe('calculated')
    expect(auto.costUsd).toBe(0.032) // 400 @ $5/1M + 1000 @ $30/1M
  })
})

describe('calculateAttemptCost, missing usage', () => {
  it.each([
    ['null usage', null],
    ['undefined usage', undefined],
    ['empty usage object', {} as ImageUsage],
    ['all-zero usage', { input_tokens: 0, output_tokens: 0, total_tokens: 0 } as ImageUsage],
  ])('never reports a confident zero for %s', (_label, usage) => {
    const result = calculateAttemptCost(usage, MODEL, 1024, 1536, 'medium')
    expect(result).not.toEqual({
      costUsd: 0,
      basis: 'calculated',
      rateVersion: expect.anything(),
    })
    expect(result.basis).not.toBe('calculated')
    expect(result.costUsd).not.toBe(0)
    expect(result.basis).toBe('estimated')
    expect(result.costUsd).toBe(0.041) // the published 1024x1536 medium price
  })

  it('estimates from the request shape when the shape is known', () => {
    const result = calculateAttemptCost(null, MODEL, 1600, 2272, 'medium')
    expect(result.basis).toBe('estimated')
    expect(result.costUsd).toBeGreaterThan(0.041)
    expect(result.rateVersion).toBe('gpt-image-2@2026-09-06')
  })
})

describe('calculateAttemptCost, uncertain outcome', () => {
  it.each([
    ['zero dimensions', 0, 0, 'medium'],
    ['negative width', -1024, 1024, 'medium'],
    ['non-finite height', 1024, Number.NaN, 'medium'],
    ['unresolvable quality', 1024, 1024, 'auto'],
  ])('returns a null cost for %s', (_label, width, height, quality) => {
    const result = calculateAttemptCost(null, MODEL, width, height, quality)
    expect(result.basis).toBe('unknown')
    expect(result.costUsd).toBeNull()
  })
})

describe('calculateAttemptCost, unknown model', () => {
  it('refuses to price an unrecognised model', () => {
    const usage: ImageUsage = {
      input_tokens: 1500,
      input_tokens_details: { text_tokens: 500, image_tokens: 1000 },
      output_tokens: 4160,
    }
    const result = calculateAttemptCost(usage, 'gpt-image-99', 1024, 1024, 'high')
    expect(result.basis).toBe('unknown')
    expect(result.costUsd).toBeNull()
    expect(result.rateVersion).toBe(UNKNOWN_RATE_VERSION)
  })

  it('does not fall back to gpt-4o-mini chat pricing', () => {
    const usage: ImageUsage = {
      input_tokens: 1500,
      input_tokens_details: { text_tokens: 500, image_tokens: 1000 },
      output_tokens: 4160,
    }
    // What src/lib/openai.ts would have produced: prompt $0.00015/1K, completion $0.0006/1K.
    const gpt4oMiniFigure = Number(
      ((1500 / 1000) * 0.00015 + (4160 / 1000) * 0.0006).toFixed(6)
    )
    expect(gpt4oMiniFigure).toBe(0.002721)

    const result = calculateAttemptCost(usage, 'some-future-image-model', 1024, 1024, 'high')
    expect(result.costUsd).not.toBe(gpt4oMiniFigure)
    expect(result.costUsd).toBeNull()

    // The real gpt-image-2 figure is roughly fifty times the chat fallback, which is the
    // size of the under-report this module exists to prevent.
    const honest = calculateAttemptCost(usage, MODEL, 1024, 1024, 'high').costUsd ?? 0
    expect(honest / gpt4oMiniFigure).toBeGreaterThan(40)
  })

  it('refuses an empty model string', () => {
    const result = calculateAttemptCost(null, '', 1024, 1024, 'medium')
    expect(result.basis).toBe('unknown')
    expect(result.costUsd).toBeNull()
    expect(result.rateVersion).toBe(UNKNOWN_RATE_VERSION)
  })
})

describe('estimateRunCostUsd', () => {
  it('lands in a sane range for four adaptations at medium quality', () => {
    const total = estimateRunCostUsd(MODEL, 'medium', RUN_VARIANTS)
    expect(total).toBeGreaterThanOrEqual(0.25)
    expect(total).toBeLessThanOrEqual(0.4)
    expect(total).toBeCloseTo(0.255022, 6)
  })

  it('costs roughly four times as much at high quality', () => {
    const medium = estimateRunCostUsd(MODEL, 'medium', RUN_VARIANTS)
    const high = estimateRunCostUsd(MODEL, 'high', RUN_VARIANTS)
    const ratio = high / medium
    expect(ratio).toBeGreaterThan(3.8)
    expect(ratio).toBeLessThan(4.2)
  })

  it('returns zero only for an empty run', () => {
    expect(estimateRunCostUsd(MODEL, 'medium', [])).toBe(0)
  })

  it('scales with area within a shape class', () => {
    const one = estimateRunCostUsd(MODEL, 'medium', [{ width: 1024, height: 1536 }])
    const two = estimateRunCostUsd(MODEL, 'medium', [{ width: 2048, height: 3072 }])
    expect(one).toBeCloseTo(0.041, 6)
    expect(two).toBeCloseTo(0.164, 6) // four times the area
  })

  it('throws rather than budgeting an unknown model or quality at zero', () => {
    expect(() => estimateRunCostUsd('gpt-image-99', 'medium', RUN_VARIANTS)).toThrow(RangeError)
    expect(() => estimateRunCostUsd(MODEL, 'auto', RUN_VARIANTS)).toThrow(RangeError)
    expect(() => estimateRunCostUsd(MODEL, 'medium', [{ width: 0, height: 1024 }])).toThrow(
      RangeError
    )
  })
})
