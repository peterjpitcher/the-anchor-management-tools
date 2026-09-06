import { afterEach, describe, expect, it } from 'vitest'

import {
  EDGE_MULTIPLE,
  EXPERIMENTAL_PIXELS,
  GPT_IMAGE_2_CONSTRAINTS,
  MAX_EDGE,
  MAX_PIXELS,
  MAX_RATIO,
  MIN_PIXELS,
  getPosterProfile,
  resolveRequestSize,
  validateRequestSize,
  type GeneratedImageVariant,
  type PosterProfile,
} from '@/lib/events/artwork/sizes'
import {
  EVENT_IMAGE_VARIANTS,
  EVENT_IMAGE_VARIANT_ORDER,
  type EventImageVariant,
} from '@/lib/events/imageVariants'

const GENERATED_VARIANTS: GeneratedImageVariant[] = [
  'landscape',
  'social',
  'story',
  'print_poster',
]
const POSTER_PROFILES: PosterProfile[] = ['standard', 'high']

/** Every generated variant crossed with every poster profile. */
const RESOLUTION_CASES: Array<{ variant: GeneratedImageVariant; profile: PosterProfile }> =
  GENERATED_VARIANTS.flatMap((variant) =>
    POSTER_PROFILES.map((profile) => ({ variant, profile }))
  )

/** How far a resolved size's shape may drift from the display target. */
const MAX_RATIO_ERROR = 0.005

describe('GPT_IMAGE_2_CONSTRAINTS', () => {
  it('pins the provider limits the rest of the module is built on', () => {
    expect(GPT_IMAGE_2_CONSTRAINTS).toEqual({
      EDGE_MULTIPLE: 16,
      MAX_EDGE: 3840,
      MAX_RATIO: 3,
      MIN_PIXELS: 655_360,
      MAX_PIXELS: 8_294_400,
      EXPERIMENTAL_PIXELS: 3_686_400,
    })
    expect([EDGE_MULTIPLE, MAX_EDGE, MAX_RATIO, MIN_PIXELS, MAX_PIXELS, EXPERIMENTAL_PIXELS]).toEqual(
      [16, 3840, 3, 655_360, 8_294_400, 3_686_400]
    )
  })
})

describe('resolveRequestSize', () => {
  it('returns the agreed size for each generated variant', () => {
    expect(resolveRequestSize('landscape', 'standard')).toEqual({
      width: 1936,
      height: 1088,
      experimental: false,
    })
    expect(resolveRequestSize('social', 'standard')).toEqual({
      width: 1920,
      height: 1008,
      experimental: false,
    })
    expect(resolveRequestSize('story', 'standard')).toEqual({
      width: 1088,
      height: 1936,
      experimental: false,
    })
    expect(resolveRequestSize('print_poster', 'standard')).toEqual({
      width: 1600,
      height: 2272,
      experimental: false,
    })
    expect(resolveRequestSize('print_poster', 'high')).toEqual({
      width: 2416,
      height: 3424,
      experimental: true,
    })
  })

  it('ignores the poster profile for every variant that is not the poster', () => {
    for (const variant of GENERATED_VARIANTS.filter((key) => key !== 'print_poster')) {
      expect(resolveRequestSize(variant, 'standard')).toEqual(resolveRequestSize(variant, 'high'))
    }
  })

  it('throws for the square, which is preserved rather than generated', () => {
    expect(() => resolveRequestSize('square', 'standard')).toThrow(/preserved and resized/i)
    expect(() => resolveRequestSize('square', 'high')).toThrow(/never generated/i)
  })

  // This is the guard that makes a future change to a target fail loudly here,
  // instead of at the API with a 400 in the middle of an artwork run.
  it.each(RESOLUTION_CASES)(
    'resolves $variant on the $profile profile to a size gpt-image-2 accepts',
    ({ variant, profile }) => {
      const { width, height } = resolveRequestSize(variant, profile)
      expect(validateRequestSize(width, height)).toEqual({ ok: true })
    }
  )

  it.each(RESOLUTION_CASES)(
    'keeps the $variant shape on the $profile profile within 0.5% of its target',
    ({ variant, profile }) => {
      const { width, height } = resolveRequestSize(variant, profile)
      const target = EVENT_IMAGE_VARIANTS[variant]
      const targetRatio = target.targetWidth / target.targetHeight
      const ratioError = Math.abs(width / height - targetRatio) / targetRatio
      expect(ratioError).toBeLessThan(MAX_RATIO_ERROR)
    }
  )

  it('marks the standard poster as documented and the high poster as experimental', () => {
    const standard = resolveRequestSize('print_poster', 'standard')
    const high = resolveRequestSize('print_poster', 'high')

    expect(standard.width * standard.height).toBe(3_635_200)
    expect(standard.width * standard.height).toBeLessThanOrEqual(EXPERIMENTAL_PIXELS)
    expect(standard.experimental).toBe(false)

    expect(high.width * high.height).toBe(8_272_384)
    expect(high.width * high.height).toBeGreaterThan(EXPERIMENTAL_PIXELS)
    expect(high.width * high.height).toBeLessThanOrEqual(MAX_PIXELS)
    expect(high.experimental).toBe(true)
  })

  it('covers the display target for every generated variant except the poster', () => {
    // The poster is the deliberate exception: no legal size covers 2480x3508,
    // so both profiles upscale. Everything else must only ever be downscaled.
    for (const variant of GENERATED_VARIANTS.filter((key) => key !== 'print_poster')) {
      const { width, height } = resolveRequestSize(variant, 'standard')
      const target = EVENT_IMAGE_VARIANTS[variant]
      expect(width).toBeGreaterThanOrEqual(target.targetWidth)
      expect(height).toBeGreaterThanOrEqual(target.targetHeight)
    }
  })
})

describe('validateRequestSize', () => {
  // Documents exactly why this module exists: not one display target can be
  // requested as-is.
  const REJECTED_TARGETS: Array<{ variant: EventImageVariant; reasons: string[] }> = [
    {
      variant: 'square',
      reasons: [
        'width 1080 is not a multiple of 16',
        'height 1080 is not a multiple of 16',
      ],
    },
    { variant: 'landscape', reasons: ['height 1080 is not a multiple of 16'] },
    { variant: 'social', reasons: ['height 1005 is not a multiple of 16'] },
    { variant: 'story', reasons: ['width 1080 is not a multiple of 16'] },
    {
      variant: 'print_poster',
      reasons: [
        'height 3508 is not a multiple of 16',
        'total pixels 8699840 exceeds the maximum of 8294400',
      ],
    },
  ]

  it('covers every variant in the shared config', () => {
    expect(REJECTED_TARGETS.map((entry) => entry.variant).sort()).toEqual(
      [...EVENT_IMAGE_VARIANT_ORDER].sort()
    )
  })

  it.each(REJECTED_TARGETS)(
    'rejects the $variant display target as-requested',
    ({ variant, reasons }) => {
      const target = EVENT_IMAGE_VARIANTS[variant]
      const result = validateRequestSize(target.targetWidth, target.targetHeight)
      expect(result.ok).toBe(false)
      expect(result.ok === false ? result.reasons : []).toEqual(reasons)
    }
  )

  it('accepts a size that satisfies all four constraints', () => {
    expect(validateRequestSize(1024, 1024)).toEqual({ ok: true })
  })

  it('reports every failure rather than stopping at the first', () => {
    // Not a multiple of 16 on either edge, over the edge cap, over the ratio
    // cap and over the pixel cap, all at once.
    const result = validateRequestSize(3999, 1001)
    expect(result.ok).toBe(false)
    expect(result.ok === false ? result.reasons : []).toEqual([
      'width 3999 is not a multiple of 16',
      'height 1001 is not a multiple of 16',
      'longest edge 3999 exceeds the maximum edge of 3840',
      'aspect ratio 4.00:1 exceeds the maximum of 3:1',
    ])
  })

  it('rejects a size below the minimum pixel count', () => {
    const result = validateRequestSize(512, 512)
    expect(result.ok === false ? result.reasons : []).toEqual([
      'total pixels 262144 is below the minimum of 655360',
    ])
  })

  it('rejects sizes that are not positive whole numbers', () => {
    expect(validateRequestSize(1024.5, 1024).ok).toBe(false)
    expect(validateRequestSize(0, 1024).ok).toBe(false)
    expect(validateRequestSize(-1024, 1024).ok).toBe(false)
  })
})

describe('getPosterProfile', () => {
  const original = process.env.EVENT_ARTWORK_POSTER_PROFILE

  afterEach(() => {
    if (original === undefined) {
      delete process.env.EVENT_ARTWORK_POSTER_PROFILE
    } else {
      process.env.EVENT_ARTWORK_POSTER_PROFILE = original
    }
  })

  it('defaults to standard when the variable is unset', () => {
    delete process.env.EVENT_ARTWORK_POSTER_PROFILE
    expect(getPosterProfile()).toBe('standard')
  })

  it('reads high when it is set', () => {
    process.env.EVENT_ARTWORK_POSTER_PROFILE = 'high'
    expect(getPosterProfile()).toBe('high')
  })

  it('reads standard when it is set', () => {
    process.env.EVENT_ARTWORK_POSTER_PROFILE = 'standard'
    expect(getPosterProfile()).toBe('standard')
  })

  it('falls back to standard for an unrecognised value rather than throwing', () => {
    for (const value of ['HIGH', 'ultra', 'true', '', ' high ']) {
      process.env.EVENT_ARTWORK_POSTER_PROFILE = value
      expect(getPosterProfile()).toBe('standard')
    }
  })
})
