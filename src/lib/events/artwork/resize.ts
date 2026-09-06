/**
 * Brings a raw generated image to the exact pixel size its variant needs, and
 * checks the result independently afterwards.
 *
 * Why this module has to exist: the image provider only accepts request sizes
 * whose edges are multiples of 16, and not one of our five display targets
 * qualifies. `src/lib/events/artwork/sizes.ts` explains how each request size
 * is chosen; everything here deals only with what comes back. In every case
 * the returned image is within 0.5% of the target's aspect ratio, so the
 * correction is a small, uniform scale plus a sliver of crop.
 *
 * Two rules that have to survive future editing:
 *
 * 1. `sharp` is imported dynamically, never statically. It is a native module
 *    and every call site in this repo does the same thing deliberately (see
 *    `src/lib/expenses/imageProcessor.ts`); a static import risks the
 *    serverless bundle.
 * 2. `optimiseImage()` from `src/lib/expenses/imageProcessor.ts` is NOT reused
 *    here. It clamps any edge over 2000px, which would silently shrink the
 *    2480x3508 A4 poster to 1414x2000. The four screen variants were never at
 *    risk, the poster always was.
 *
 * Pure image work: no network, database or filesystem access.
 */

import {
  EVENT_IMAGE_VARIANTS,
  formatBytes,
  type EventImageVariant,
} from '@/lib/events/imageVariants'

/**
 * The resize contract, exported so a test can assert nobody quietly swapped
 * the fit mode.
 *
 * `cover` is the deliberate choice, and the alternatives are both worse:
 *   - `fill` would STRETCH the artwork, distorting faces, logos and type.
 *   - `contain` would LETTERBOX it, adding bars the designer never drew.
 *   - `cover` crops at most 0.5% of one edge, because the generated ratio is
 *     always within 0.5% of the target. On a 1920px edge that is under 10px.
 *
 * That crop is the accepted trade-off: a few pixels off an edge beats either
 * distorted artwork or bars down the side.
 *
 * `withoutEnlargement: false` is also deliberate. Downscaling is normally the
 * safe direction and upscaling the risky one, but the A4 poster is the stated
 * exception: 2480x3508 is 8,699,840 pixels, over the provider's 8,294,400 cap,
 * so no legal request size can cover it and BOTH poster profiles upscale on
 * purpose. Do not "fix" this to `true`; it would leave the poster at request
 * size and the print would come out at the wrong physical dimensions.
 */
export const RESIZE_OPTIONS = {
  fit: 'cover',
  position: 'centre',
  kernel: 'lanczos3',
  withoutEnlargement: false,
} as const

/**
 * A4 at 300dpi. Written into the poster's PNG so print software lays it out at
 * A4 without an operator picking a scaling percentage by hand. The four screen
 * variants carry no density: it means nothing on the web and is one more thing
 * to get wrong.
 */
export const PRINT_POSTER_DENSITY_DPI = 300

export type GeneratedImageValidation =
  | { ok: true; width: number; height: number; bytes: number }
  | { ok: false; reason: string }

/**
 * Resize a generated image to its variant's exact target size and re-encode it
 * as PNG.
 *
 * PNG because it is lossless: these images are re-encoded again downstream
 * (storage, the poster PDF, social crops) and stacking lossy passes shows.
 */
export async function resizeToVariant(
  buffer: Buffer,
  variant: EventImageVariant
): Promise<Buffer> {
  const config = EVENT_IMAGE_VARIANTS[variant]
  if (!config) {
    throw new Error(`Unknown event image variant: ${String(variant)}`)
  }

  const sharp = (await import('sharp')).default

  let pipeline = sharp(buffer, { failOn: 'none' }).resize(
    config.targetWidth,
    config.targetHeight,
    RESIZE_OPTIONS
  )

  if (variant === 'print_poster') {
    pipeline = pipeline.withMetadata({ density: PRINT_POSTER_DENSITY_DPI })
  }

  return pipeline.png({ compressionLevel: 9 }).toBuffer()
}

/**
 * Decode a buffer and check it really is what the variant requires.
 *
 * Deliberately independent of `resizeToVariant`: it decodes the bytes again
 * rather than trusting any width, height or format a caller hands over, so a
 * pipeline change that stops producing the right size is caught here and not
 * on a printed poster. Returns a specific reason rather than a bare false,
 * because "the artwork failed validation" tells an operator nothing.
 */
export async function validateGeneratedImage(
  buffer: Buffer,
  variant: EventImageVariant
): Promise<GeneratedImageValidation> {
  const config = EVENT_IMAGE_VARIANTS[variant]
  if (!config) {
    return { ok: false, reason: `Unknown event image variant: ${String(variant)}` }
  }

  const sharp = (await import('sharp')).default

  let width: number | undefined
  let height: number | undefined
  let format: string | undefined

  try {
    const metadata = await sharp(buffer).metadata()
    width = metadata.width
    height = metadata.height
    format = metadata.format
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `The ${config.label} image could not be decoded: ${message}` }
  }

  if (format !== 'png') {
    return {
      ok: false,
      reason: `The ${config.label} image should be a png, but it is ${format ?? 'an unknown format'}.`,
    }
  }

  if (!width || !height) {
    return {
      ok: false,
      reason: `The ${config.label} image has no readable width and height.`,
    }
  }

  if (width !== config.targetWidth || height !== config.targetHeight) {
    return {
      ok: false,
      reason: `The ${config.label} image should be exactly ${config.targetWidth}x${config.targetHeight}, but it is ${width}x${height}.`,
    }
  }

  if (buffer.length > config.maxBytes) {
    return {
      ok: false,
      reason: `The ${config.label} image is ${formatBytes(buffer.length)}, over the ${formatBytes(config.maxBytes)} limit.`,
    }
  }

  return { ok: true, width, height, bytes: buffer.length }
}
