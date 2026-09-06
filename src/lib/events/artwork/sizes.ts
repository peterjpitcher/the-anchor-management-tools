/**
 * Maps each event artwork variant to a size gpt-image-2 will actually accept.
 *
 * This module exists because not one of our five display targets is a legal
 * request size. gpt-image-2 takes arbitrary dimensions, but only inside four
 * numeric constraints, and our targets break them:
 *
 *   square        1080x1080  1080 is not a multiple of 16
 *   landscape     1920x1080  1080 is not a multiple of 16
 *   social        1920x1005  1005 is not a multiple of 16
 *   story         1080x1920  1080 is not a multiple of 16
 *   print_poster  2480x3508  3508 is not a multiple of 16, and 8,699,840 total
 *                            pixels is 4.9% over the 8,294,400 cap
 *
 * So every generated variant is requested at a nearby legal size and resized
 * down to its display target afterwards. The rule used to pick each number is
 * the smallest legal size that fully covers the target with a ratio error
 * under 0.5%, so the downscale never has to invent pixels and never has to
 * crop anything meaningful. The A4 poster is the one exception: no legal size
 * covers 2480x3508, because covering it would need more pixels than the API
 * allows, so both poster profiles deliberately request a smaller image and
 * upscale to 300dpi at the end.
 *
 * The square is not generated at all. The owner's uploaded artwork is the
 * source image and is only ever resized, so asking for a square request size
 * is a bug and throws.
 *
 * Pure module: no network, filesystem or database access.
 */

import type { EventImageVariant } from '@/lib/events/imageVariants'

/**
 * The four numeric constraints gpt-image-2 enforces, plus the threshold above
 * which OpenAI documents an output as experimental.
 */
export const GPT_IMAGE_2_CONSTRAINTS = {
  /** Both edges must be a whole multiple of this. */
  EDGE_MULTIPLE: 16,
  /** Neither edge may exceed this. */
  MAX_EDGE: 3840,
  /** Long edge divided by short edge may not exceed this. */
  MAX_RATIO: 3,
  /** Width times height must be at least this. */
  MIN_PIXELS: 655_360,
  /** Width times height may not exceed this. */
  MAX_PIXELS: 8_294_400,
  /** Above this total, OpenAI documents the output as experimental. */
  EXPERIMENTAL_PIXELS: 3_686_400,
} as const

export const EDGE_MULTIPLE = GPT_IMAGE_2_CONSTRAINTS.EDGE_MULTIPLE
export const MAX_EDGE = GPT_IMAGE_2_CONSTRAINTS.MAX_EDGE
export const MAX_RATIO = GPT_IMAGE_2_CONSTRAINTS.MAX_RATIO
export const MIN_PIXELS = GPT_IMAGE_2_CONSTRAINTS.MIN_PIXELS
export const MAX_PIXELS = GPT_IMAGE_2_CONSTRAINTS.MAX_PIXELS
export const EXPERIMENTAL_PIXELS = GPT_IMAGE_2_CONSTRAINTS.EXPERIMENTAL_PIXELS

/**
 * How much of the pixel budget the A4 poster is allowed to spend.
 *
 * `standard` stays under the experimental threshold, so the request uses a
 * documented, stable output size. `high` spends almost the whole budget for a
 * sharper print at the cost of an output OpenAI calls experimental.
 */
export type PosterProfile = 'standard' | 'high'

/** The variants we actually ask the model to generate. The square is excluded. */
export type GeneratedImageVariant = Exclude<EventImageVariant, 'square'>

export interface ResolvedRequestSize {
  width: number
  height: number
  /** True when the size is above the pixel count OpenAI documents as experimental. */
  experimental: boolean
}

export type RequestSizeValidation = { ok: true } | { ok: false; reasons: string[] }

interface RequestSizeCandidate {
  width: number
  height: number
}

/**
 * The chosen request size per generated variant.
 *
 * Every number below is a multiple of 16, inside the edge, ratio and pixel
 * limits, and within 0.5% of its target's aspect ratio. The table-driven test
 * re-checks all of that, so changing a target in `imageVariants.ts` without
 * revisiting this table fails the suite rather than failing at the API.
 */
const REQUEST_SIZES: Record<
  Exclude<GeneratedImageVariant, 'print_poster'>,
  RequestSizeCandidate
> = {
  /**
   * Target 1920x1080 (16:9). 1080 is not a multiple of 16, and rounding it up
   * to 1088 while keeping the width at 1920 pushes the ratio error to 0.73%,
   * so the width goes up to 1936 as well. Ratio error 0.09%, 2,106,368 pixels.
   */
  landscape: { width: 1936, height: 1088 },
  /**
   * Target 1920x1005 (1.91:1). The width is already legal; 1005 rounds up to
   * the next multiple of 16. Ratio error 0.30%, 1,935,360 pixels.
   */
  social: { width: 1920, height: 1008 },
  /**
   * Target 1080x1920 (9:16). The landscape size turned on its side, for the
   * same reason. Ratio error 0.09%, 2,106,368 pixels.
   */
  story: { width: 1088, height: 1936 },
}

/**
 * The A4 poster, which cannot be covered legally.
 *
 * Target 2480x3508 is 8,699,840 pixels, over the 8,294,400 cap, so there is no
 * legal size that covers it. Both profiles request a smaller image at the A4
 * ratio and are upscaled to 2480x3508 afterwards.
 */
const POSTER_REQUEST_SIZES: Record<PosterProfile, RequestSizeCandidate> = {
  /**
   * 3,635,200 pixels, just under the 3,686,400 experimental threshold, so the
   * output stays on documented ground. Ratio error 0.39%. Upscales about 1.55x
   * to A4 at 300dpi, which is acceptable for a pub poster read at arm's length.
   */
  standard: { width: 1600, height: 2272 },
  /**
   * 8,272,384 pixels, 22,016 under the hard cap and comfortably over the
   * experimental threshold. Ratio error 0.19%. Upscales about 1.03x, so the
   * print is effectively native resolution.
   */
  high: { width: 2416, height: 3424 },
}

/**
 * Check a size against all four gpt-image-2 constraints.
 *
 * Returns every failure rather than the first, because a size can break more
 * than one rule at once (2480x3508 breaks two) and reporting them one at a
 * time turns a single fix into several rounds.
 */
export function validateRequestSize(width: number, height: number): RequestSizeValidation {
  const reasons: string[] = []

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, reasons: [`size must be two positive whole numbers, got ${width}x${height}`] }
  }

  if (width % EDGE_MULTIPLE !== 0) {
    reasons.push(`width ${width} is not a multiple of ${EDGE_MULTIPLE}`)
  }
  if (height % EDGE_MULTIPLE !== 0) {
    reasons.push(`height ${height} is not a multiple of ${EDGE_MULTIPLE}`)
  }

  const longestEdge = Math.max(width, height)
  if (longestEdge > MAX_EDGE) {
    reasons.push(`longest edge ${longestEdge} exceeds the maximum edge of ${MAX_EDGE}`)
  }

  const ratio = longestEdge / Math.min(width, height)
  if (ratio > MAX_RATIO) {
    reasons.push(`aspect ratio ${ratio.toFixed(2)}:1 exceeds the maximum of ${MAX_RATIO}:1`)
  }

  const pixels = width * height
  if (pixels < MIN_PIXELS) {
    reasons.push(`total pixels ${pixels} is below the minimum of ${MIN_PIXELS}`)
  }
  if (pixels > MAX_PIXELS) {
    reasons.push(`total pixels ${pixels} exceeds the maximum of ${MAX_PIXELS}`)
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

/** True when a size is above the pixel count OpenAI documents as experimental. */
export function isExperimentalSize(width: number, height: number): boolean {
  return width * height > EXPERIMENTAL_PIXELS
}

/**
 * The legal request size for a variant.
 *
 * The poster profile is required rather than defaulted, so a caller cannot
 * silently get the cheaper poster by forgetting the argument. Read the
 * configured profile with `getPosterProfile()` and pass it in.
 */
export function resolveRequestSize(
  variant: EventImageVariant,
  posterProfile: PosterProfile
): ResolvedRequestSize {
  if (variant === 'square') {
    throw new Error(
      'The square variant has no request size: the square is the owner\'s uploaded artwork, ' +
        'preserved and resized, never generated.'
    )
  }

  const size =
    variant === 'print_poster' ? POSTER_REQUEST_SIZES[posterProfile] : REQUEST_SIZES[variant]

  return {
    width: size.width,
    height: size.height,
    experimental: isExperimentalSize(size.width, size.height),
  }
}

/**
 * The configured poster profile.
 *
 * Anything unrecognised falls back to `standard` rather than throwing, because
 * a typo in an environment variable should cost a sharper poster, not the whole
 * artwork run.
 */
export function getPosterProfile(): PosterProfile {
  return process.env.EVENT_ARTWORK_POSTER_PROFILE === 'high' ? 'high' : 'standard'
}
