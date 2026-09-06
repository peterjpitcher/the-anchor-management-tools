/**
 * Checks a composited image before it replaces the live artwork.
 *
 * Compositing paints a logo and, on print variants, a QR code onto an uploaded
 * image. It must never change the image's dimensions, so the check here is
 * "same size in, same size out", not "matches the variant's target size".
 *
 * That distinction matters. `EVENT_IMAGE_VARIANTS` states an ideal target
 * (the poster is nominally 2480x3508, A4 at 300dpi), but the upload path has
 * only ever validated aspect ratio, never pixels, and real uploads sit well
 * below the ideal. Asserting the target here would reject artwork the app has
 * accepted happily for months. Geometry is expressed in fractions of the edge
 * precisely so it scales to whatever was actually uploaded.
 *
 * `sharp` is imported dynamically, never statically. It is a native module and
 * every call site in this repo does the same deliberately (see
 * `src/lib/expenses/imageProcessor.ts`); a static import risks the serverless
 * bundle.
 *
 * `optimiseImage()` from `src/lib/expenses/imageProcessor.ts` is NOT reused: it
 * clamps any edge over 2000px, which would silently shrink a full-size A4
 * poster to 1414x2000.
 *
 * Pure image work: no network, database or filesystem access.
 */

import {
  EVENT_IMAGE_VARIANTS,
  formatBytes,
  type EventImageVariant,
} from '@/lib/events/imageVariants'

/**
 * A4 at 300dpi. Written into a composited poster's PNG so print software lays
 * it out at A4 without an operator picking a scaling percentage by hand. The
 * screen variants carry no density: it means nothing on the web and is one more
 * thing to get wrong.
 */
export const PRINT_POSTER_DENSITY_DPI = 300

export type CompositeOutputValidation =
  | { ok: true; width: number; height: number; bytes: number }
  | { ok: false; reason: string }

/**
 * Decode a composited buffer and confirm it is safe to store.
 *
 * Deliberately decodes the bytes again rather than trusting anything the
 * compositor reports, so a geometry bug that grew or shrank the canvas is
 * caught here and not on a printed poster. Returns a specific reason rather
 * than a bare false, because "the artwork failed validation" tells an operator
 * nothing.
 */
export async function validateCompositeOutput(
  buffer: Buffer,
  variant: EventImageVariant,
  expected: { width: number; height: number }
): Promise<CompositeOutputValidation> {
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
    return { ok: false, reason: `The ${config.label} image has no readable width and height.` }
  }

  // The whole point of the check: branding must not resize the artwork.
  if (width !== expected.width || height !== expected.height) {
    return {
      ok: false,
      reason: `Adding branding changed the ${config.label} image from ${expected.width}x${expected.height} to ${width}x${height}. It should be unchanged.`,
    }
  }

  if (buffer.length > config.maxBytes) {
    return {
      ok: false,
      reason: `The branded ${config.label} image is ${formatBytes(buffer.length)}, over the ${formatBytes(config.maxBytes)} limit.`,
    }
  }

  return { ok: true, width, height, bytes: buffer.length }
}
