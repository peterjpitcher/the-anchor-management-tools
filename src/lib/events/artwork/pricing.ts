/**
 * Cost accounting for OpenAI image generation.
 *
 * Deliberately separate from `calculateOpenAICost` in `src/lib/openai.ts`. That helper
 * knows four CHAT models and silently falls back to `gpt-4o-mini` token pricing for
 * anything it does not recognise. Image output tokens cost $30.00 per 1M against
 * gpt-4o-mini's $0.60 per 1M completion rate, so reusing it here would under-report
 * image spend by roughly fifty times. Nothing in this file may import it.
 *
 * The image API reports `usage` in TOKENS, never in dollars, so every figure below is
 * derived from published token rates or from published per-image reference prices.
 */

/**
 * How a cost figure was arrived at, so a stored row can be read honestly later.
 *
 * - `calculated`: derived from the token counts the API actually returned. Trustworthy.
 * - `estimated`: the API gave us no usable usage, so the figure is extrapolated from
 *   published per-image reference prices. Approximate, and flagged as such.
 * - `unknown`: we cannot say what this cost. `costUsd` is null, never zero.
 */
export type CostBasis = 'calculated' | 'estimated' | 'unknown'

/** Quality tiers that have published reference prices. */
export type ImageQuality = 'low' | 'medium' | 'high'

/** The `usage` object returned by the OpenAI image API. Every field is optional in practice. */
export interface ImageUsage {
  input_tokens?: number
  input_tokens_details?: { text_tokens?: number; image_tokens?: number }
  output_tokens?: number
  total_tokens?: number
}

export interface AttemptCost {
  /**
   * USD. Null means "we do not know", which is a different fact from zero.
   * Never zero unless the arithmetic genuinely produced zero from real token counts.
   */
  costUsd: number | null
  basis: CostBasis
  /** Which `IMAGE_RATE_TABLE` entry produced the figure, so it can be re-checked later. */
  rateVersion: string
}

/** A published per-image price at one of OpenAI's three reference resolutions. */
export interface ReferencePrice {
  readonly width: number
  readonly height: number
  readonly priceUsd: number
}

export interface ImageRateEntry {
  /** Stable identifier written alongside every stored cost. */
  readonly rateVersion: string
  readonly model: string
  /**
   * ISO date these rates were recorded from OpenAI's published pricing. Entries are
   * additive: when a price changes, append a new entry with a later date rather than
   * editing an existing one, so historical rows keep pointing at the rates they used.
   */
  readonly effectiveFrom: string
  readonly textInputPerMillionUsd: number
  readonly imageInputPerMillionUsd: number
  readonly imageOutputPerMillionUsd: number
  readonly referencePricesUsd: Readonly<Record<ImageQuality, readonly ReferencePrice[]>>
}

/** `rateVersion` used when we could not identify the model at all. */
export const UNKNOWN_RATE_VERSION = 'unknown'

/**
 * Currency is rounded to 6 decimal places, not 2. A single image at low quality costs
 * about half a cent, so rounding each attempt to the nearest penny would round most of
 * them to zero and lose the whole spend figure. Rounding happens once, at the point a
 * number is returned; intermediate sums stay at full precision.
 */
const CURRENCY_DECIMAL_PLACES = 6

/**
 * Published rates, oldest first. Ordering is asserted by the tests so a new entry cannot
 * be appended in the wrong place.
 */
export const IMAGE_RATE_TABLE: readonly ImageRateEntry[] = [
  {
    rateVersion: 'gpt-image-1.5@2026-09-06',
    model: 'gpt-image-1.5',
    effectiveFrom: '2026-09-06',
    textInputPerMillionUsd: 5.0,
    imageInputPerMillionUsd: 8.0,
    imageOutputPerMillionUsd: 32.0,
    referencePricesUsd: {
      low: [
        { width: 1024, height: 1024, priceUsd: 0.006 },
        { width: 1024, height: 1536, priceUsd: 0.005 },
        { width: 1536, height: 1024, priceUsd: 0.005 },
      ],
      medium: [
        { width: 1024, height: 1024, priceUsd: 0.053 },
        { width: 1024, height: 1536, priceUsd: 0.041 },
        { width: 1536, height: 1024, priceUsd: 0.041 },
      ],
      high: [
        { width: 1024, height: 1024, priceUsd: 0.211 },
        { width: 1024, height: 1536, priceUsd: 0.165 },
        { width: 1536, height: 1024, priceUsd: 0.165 },
      ],
    },
  },
  {
    rateVersion: 'gpt-image-2@2026-09-06',
    model: 'gpt-image-2',
    effectiveFrom: '2026-09-06',
    textInputPerMillionUsd: 5.0,
    imageInputPerMillionUsd: 8.0,
    imageOutputPerMillionUsd: 30.0,
    referencePricesUsd: {
      low: [
        { width: 1024, height: 1024, priceUsd: 0.006 },
        { width: 1024, height: 1536, priceUsd: 0.005 },
        { width: 1536, height: 1024, priceUsd: 0.005 },
      ],
      medium: [
        { width: 1024, height: 1024, priceUsd: 0.053 },
        { width: 1024, height: 1536, priceUsd: 0.041 },
        { width: 1536, height: 1024, priceUsd: 0.041 },
      ],
      high: [
        { width: 1024, height: 1024, priceUsd: 0.211 },
        { width: 1024, height: 1536, priceUsd: 0.165 },
        { width: 1536, height: 1024, priceUsd: 0.165 },
      ],
    },
  },
]

function roundUsd(value: number): number {
  return Number(value.toFixed(CURRENCY_DECIMAL_PLACES))
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function toTokenCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return value
}

/**
 * Latest entry for a model. Later entries win, which is why the table is ordered by
 * `effectiveFrom`. An unrecognised model returns null and the caller reports `unknown`:
 * it must never borrow another model's rates.
 */
function findRateEntry(model: string): ImageRateEntry | null {
  const normalised = model?.trim().toLowerCase()
  if (!normalised) return null
  let found: ImageRateEntry | null = null
  for (const entry of IMAGE_RATE_TABLE) {
    if (entry.model === normalised) found = entry
  }
  return found
}

/**
 * Only the three published tiers are usable for estimation. `auto` and anything else
 * resolve to null, which the caller treats as an uncertain request shape. Quality is
 * irrelevant on the calculated path, where real token counts already reflect it.
 */
function resolveQuality(quality: string): ImageQuality | null {
  const normalised = quality?.trim().toLowerCase()
  if (normalised === 'low' || normalised === 'medium' || normalised === 'high') return normalised
  return null
}

/**
 * Nearest reference price by aspect ratio, compared in log space so that, for example,
 * 3:2 and 2:3 sit an equal distance from square.
 */
function nearestReferenceByAspect(
  references: readonly ReferencePrice[],
  width: number,
  height: number
): ReferencePrice | null {
  if (references.length === 0) return null
  const targetAspect = Math.log(width / height)
  let best: ReferencePrice | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const reference of references) {
    const distance = Math.abs(Math.log(reference.width / reference.height) - targetAspect)
    if (distance < bestDistance) {
      bestDistance = distance
      best = reference
    }
  }
  return best
}

/**
 * Estimate one image from the published reference prices: take the reference whose shape
 * is closest to the requested one, then scale its price by the ratio of pixel areas.
 *
 * This is APPROXIMATE and must never be labelled `calculated`. OpenAI's own note is that
 * a larger non-square resolution can produce FEWER output tokens than a smaller square
 * one, so cost does not scale cleanly with megapixels. The published prices bear this
 * out: 1024x1536 is 1.5 times the area of 1024x1024 yet costs less. Matching on aspect
 * before scaling keeps the estimate inside a single shape class, which is the best that
 * can be done without real token counts, but it is still a stand-in for usage data and
 * that is exactly why the calculated path is preferred wherever usage exists.
 */
function estimateImageCostUsd(
  entry: ImageRateEntry,
  quality: ImageQuality,
  width: number,
  height: number
): number | null {
  const reference = nearestReferenceByAspect(entry.referencePricesUsd[quality], width, height)
  if (!reference) return null
  const referenceArea = reference.width * reference.height
  if (referenceArea <= 0) return null
  return reference.priceUsd * ((width * height) / referenceArea)
}

/**
 * Cost of one image generation attempt.
 *
 * Order of preference: real token counts, then an estimate from the request shape, then
 * an honest admission that we do not know. A missing `usage` object can never produce
 * `{ costUsd: 0, basis: 'calculated' }`: a confident zero hides real spend, which is
 * worse than an approximate figure or an explicit null.
 *
 * An uncertain outcome is signalled by the caller passing no usable request shape, that
 * is a non-positive or non-finite width or height, or a quality outside the published
 * tiers. That is the case where the attempt may or may not have generated an image.
 */
export function calculateAttemptCost(
  usage: ImageUsage | null | undefined,
  model: string,
  width: number,
  height: number,
  quality: string
): AttemptCost {
  const entry = findRateEntry(model)
  if (!entry) {
    // An unrecognised model gets no pricing at all. Falling back to another model's
    // rates, as the chat helper does, is what produces silently wrong spend figures.
    return { costUsd: null, basis: 'unknown', rateVersion: UNKNOWN_RATE_VERSION }
  }

  const outputTokens = toTokenCount(usage?.output_tokens)
  const detailTextTokens = toTokenCount(usage?.input_tokens_details?.text_tokens)
  const detailImageTokens = toTokenCount(usage?.input_tokens_details?.image_tokens)
  const totalInputTokens = toTokenCount(usage?.input_tokens)

  // Without a details breakdown the split is unknowable, so all input tokens are charged
  // at the text rate. Input is a small fraction of an image bill (output dominates at
  // $30 per 1M), so the exposure here is cents on the dollar, not a hidden multiple.
  const hasDetailBreakdown = detailTextTokens > 0 || detailImageTokens > 0
  const textTokens = hasDetailBreakdown ? detailTextTokens : totalInputTokens
  const imageTokens = detailImageTokens

  if (outputTokens > 0 || textTokens > 0 || imageTokens > 0) {
    const costUsd =
      (textTokens / 1_000_000) * entry.textInputPerMillionUsd +
      (imageTokens / 1_000_000) * entry.imageInputPerMillionUsd +
      (outputTokens / 1_000_000) * entry.imageOutputPerMillionUsd
    return { costUsd: roundUsd(costUsd), basis: 'calculated', rateVersion: entry.rateVersion }
  }

  const resolvedQuality = resolveQuality(quality)
  if (!resolvedQuality || !isPositiveFinite(width) || !isPositiveFinite(height)) {
    return { costUsd: null, basis: 'unknown', rateVersion: entry.rateVersion }
  }

  const estimated = estimateImageCostUsd(entry, resolvedQuality, width, height)
  if (estimated === null) {
    return { costUsd: null, basis: 'unknown', rateVersion: entry.rateVersion }
  }
  return { costUsd: roundUsd(estimated), basis: 'estimated', rateVersion: entry.rateVersion }
}

/**
 * Forward-looking budget for a whole run, before any request is made and so before any
 * usage exists. Always an estimate, with the same caveats as `estimateImageCostUsd`.
 *
 * Throws for an unknown model or quality rather than returning 0. A zero budget reads as
 * "this run is free", which is the exact misreporting this module exists to prevent.
 */
export function estimateRunCostUsd(
  model: string,
  quality: string,
  variantSizes: Array<{ width: number; height: number }>
): number {
  const entry = findRateEntry(model)
  if (!entry) {
    throw new RangeError(
      `No image rate table entry for model "${model}". Add one to IMAGE_RATE_TABLE rather than pricing it as another model.`
    )
  }
  const resolvedQuality = resolveQuality(quality)
  if (!resolvedQuality) {
    throw new RangeError(
      `Cannot estimate a run at quality "${quality}". Published reference prices exist only for low, medium and high.`
    )
  }

  // Summed at full precision and rounded once. Rounding each variant to 6 places first
  // and adding the results would discard a slice of every image in the run.
  let total = 0
  for (const size of variantSizes) {
    if (!isPositiveFinite(size.width) || !isPositiveFinite(size.height)) {
      throw new RangeError(
        `Cannot estimate a variant of ${size.width}x${size.height}. Both dimensions must be positive.`
      )
    }
    const estimated = estimateImageCostUsd(entry, resolvedQuality, size.width, size.height)
    if (estimated === null) {
      throw new RangeError(`No reference prices for model "${model}" at quality "${quality}".`)
    }
    total += estimated
  }
  return roundUsd(total)
}
