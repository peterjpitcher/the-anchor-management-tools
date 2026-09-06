/**
 * Stamps the venue logo, and on the poster a booking QR code, onto generated
 * event artwork.
 *
 * Where this sits in the pipeline: the image provider returns a raw image,
 * `src/lib/events/artwork/resize.ts` brings it to the variant's exact pixel
 * size, and this module brands it. Everything here is pure image work: it
 * reads two files out of the deployment bundle and touches no network,
 * database or clock.
 *
 * Four rules that have to survive future editing:
 *
 * 1. `sharp` is imported dynamically, never statically. It is a native module
 *    and every call site in this repo does the same thing deliberately (see
 *    `src/lib/expenses/imageProcessor.ts`); a static import risks the
 *    serverless bundle. There is no static type import of it either, so this
 *    file has no compile-time coupling to sharp at all.
 *
 * 2. Placement is NEVER computed here. Every corner, inset and QR size comes
 *    from `src/lib/events/artwork/geometry.ts`, which the browser preview also
 *    imports. That shared module is the only reason what a member of staff
 *    drags on screen is what the rendered file gets. Recomputing any of it
 *    here would drift from the preview within a release.
 *
 * 3. Branding failure is VISIBLE, not graceful. If a logo was asked for and
 *    cannot be loaded, this fails and returns no buffer. `src/lib/pdf/document-logo.ts`
 *    does the opposite and renders the PDF unbranded; that is right for an
 *    invoice footer, where a missing logo beats a missing invoice, and wrong
 *    here, where the branding IS the deliverable. Quietly shipping unbranded
 *    artwork would be discovered on a printed poster. Only an explicit
 *    `logo: null` produces artwork with no logo.
 *
 * 4. The QR code is rasterised straight at its final pixel width and its white
 *    quiet zone is left alone. Both are scanning requirements, explained at
 *    `renderQrAtWidth` below.
 *
 * Output is always PNG, lossless, because these images are re-encoded again
 * downstream (storage, the poster PDF, social crops) and stacking lossy passes
 * shows. The same source and the same spec always produce byte-identical
 * output, which is what lets the route store the result at a content addressed
 * `composite-{placementHash}.png` path and serve it from cache.
 */

import fs from 'fs/promises'
import path from 'path'
import QRCode from 'qrcode'
import { QR_OPTIONS } from '@/lib/export/qr-pack'
import type { EventImageVariant } from '@/lib/events/imageVariants'
import { PRINT_POSTER_DENSITY_DPI } from './output'
import {
  logoRect,
  qrRect,
  validateQrPlacement,
  type Corner,
  type Rect,
} from './geometry'

export type LogoColour = 'white' | 'black'

/**
 * The two logo files, relative to the project root.
 *
 * Both are 934x421 with a REAL alpha channel, which is the whole reason these
 * two and not the others. `public/logo-black.png` is 400x180 with three
 * channels and no alpha, so compositing it would stamp an opaque white
 * rectangle across the artwork; `public/logo.png` is byte-identical to the PWA
 * icons and must not be repurposed. The `hasAlpha` assertion in
 * `compositeArtwork` is the guard against someone repointing these constants
 * at either of them.
 *
 * These paths are named in `outputFileTracingIncludes` in `next.config.mjs`.
 * Next does not trace `public/` files that are read at runtime, so removing
 * that entry ships a serverless bundle without them and every composite fails
 * with `logo_asset_missing`.
 */
export const LOGO_SOURCES: Record<LogoColour, string> = {
  white: 'public/guest/anchor-logo-white.png',
  black: 'public/guest/anchor-logo-black.png',
}

export interface CompositeSpec {
  variant: EventImageVariant
  /** Null means the staff member deliberately chose no logo. */
  logo: { corner: Corner; colour: LogoColour; widthFrac: number } | null
  /** Null means no QR code. In practice only the print poster carries one. */
  qr: { centreXFrac: number; centreYFrac: number; widthFrac: number; url: string } | null
}

export type CompositeFailure =
  | { code: 'logo_asset_missing'; detail: string }
  | { code: 'logo_asset_invalid'; detail: string }
  | { code: 'qr_render_failed'; detail: string }
  | { code: 'placement_invalid'; detail: string }
  | { code: 'source_invalid'; detail: string }

export type CompositeResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; failure: CompositeFailure }

export interface CompositeOptions {
  /**
   * Overrides the on-disk logo paths.
   *
   * The only way to exercise the two failure paths that matter, a missing file
   * and a file with no alpha channel, against real files rather than a mocked
   * sharp. A mocked sharp would happily report `hasAlpha: true` for
   * `public/logo-black.png`, which is precisely the bug the guard exists to
   * catch. Production never passes this.
   */
  logoSources?: Record<LogoColour, string>
}

/** One overlay for sharp's `composite`, structurally its `OverlayOptions`. */
interface Overlay {
  input: Buffer
  left: number
  top: number
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read a logo file off disk.
 *
 * Throws when the file is missing or unreadable; `compositeArtwork` maps that
 * to `logo_asset_missing`. It deliberately does not swallow the error and it
 * deliberately does not cache: a per-request file read of 19KB is not worth a
 * cache that would pin a stale asset across a deployment.
 */
export async function loadLogoBuffer(
  colour: LogoColour,
  sources: Record<LogoColour, string> = LOGO_SOURCES
): Promise<Buffer> {
  const source = sources[colour]
  if (!source) {
    throw new Error(`No logo file is configured for the ${colour} logo.`)
  }

  // `resolve` rather than `join` so an absolute override path is honoured
  // instead of being appended to the working directory.
  return fs.readFile(path.resolve(process.cwd(), source))
}

/**
 * Render a QR code as a PNG at exactly `widthPx` pixels square.
 *
 * Two things here are load bearing and are not stylistic choices:
 *
 * - The code is rasterised AT its final width, not rendered at
 *   `QR_PNG_WIDTH` (1200) and resampled down. Rasterising at the target keeps
 *   every module edge on a hard pixel boundary. Resampling softens those edges,
 *   and a soft edged code is the usual cause of one that scans on a screen and
 *   fails off paper.
 * - `QR_OPTIONS` carries `margin: 4`, the specified quiet zone, and it is an
 *   opaque white plate rather than transparency. Nothing here trims it or keys
 *   it out. `widthPx` INCLUDES that quiet zone, which is why the placement
 *   geometry and the print minimum are both expressed against the same number.
 *
 * The width is verified after rendering rather than assumed. The `qrcode`
 * library falls back to its default scale, and silently returns a different
 * size, if the requested width is smaller than the code's own module count
 * plus its margins. Better to fail than to composite a code at the wrong size.
 */
export async function renderQrAtWidth(url: string, widthPx: number): Promise<Buffer> {
  if (!Number.isInteger(widthPx) || widthPx <= 0) {
    throw new Error(
      `A QR code width must be a positive whole number of pixels, got ${String(widthPx)}.`
    )
  }

  const buffer = await QRCode.toBuffer(url, { ...QR_OPTIONS, type: 'png', width: widthPx })

  const sharp = (await import('sharp')).default
  const metadata = await sharp(buffer).metadata()
  if (metadata.width !== widthPx || metadata.height !== widthPx) {
    throw new Error(
      `The QR code rendered at ${String(metadata.width)}x${String(metadata.height)} ` +
        `instead of the requested ${widthPx}x${widthPx}.`
    )
  }

  return buffer
}

/**
 * Composite the logo, and the QR code where there is one, onto the artwork.
 *
 * Geometry is taken from the decoded pixel size of `sourceBuffer`, not from the
 * variant's target size. The two are the same in the pipeline, because
 * `resizeToVariant` runs first, and using what is actually there means a
 * composite onto a differently sized canvas still lands proportionally rather
 * than off the edge.
 *
 * The QR placement is validated here, server side, before anything is drawn.
 * The slider in the browser is a convenience, not the enforcement point: it can
 * be bypassed, it can be out of date, and an unscannable poster is only
 * discovered after it has been printed. The 40mm print minimum is applied to
 * every variant that asks for a QR code, not just the poster, on the grounds
 * that a code too small to scan is a defect on any medium.
 */
export async function compositeArtwork(
  sourceBuffer: Buffer,
  spec: CompositeSpec,
  options: CompositeOptions = {}
): Promise<CompositeResult> {
  const sources = options.logoSources ?? LOGO_SOURCES
  const sharp = (await import('sharp')).default

  let imageW: number | undefined
  let imageH: number | undefined
  try {
    const metadata = await sharp(sourceBuffer, { failOn: 'none' }).metadata()
    imageW = metadata.width
    imageH = metadata.height
  } catch (error) {
    return {
      ok: false,
      failure: { code: 'source_invalid', detail: `The artwork could not be decoded: ${describe(error)}` },
    }
  }

  if (!imageW || !imageH) {
    return {
      ok: false,
      failure: { code: 'source_invalid', detail: 'The artwork has no readable width and height.' },
    }
  }

  const logoPlacement: Rect | null = spec.logo
    ? logoRect(imageW, imageH, spec.logo.corner, spec.logo.widthFrac)
    : null

  const qrPlacement: Rect | null = spec.qr
    ? qrRect(imageW, imageH, spec.qr.centreXFrac, spec.qr.centreYFrac, spec.qr.widthFrac)
    : null

  if (qrPlacement) {
    const placement = validateQrPlacement(imageW, imageH, qrPlacement, logoPlacement)
    if (!placement.ok) {
      return { ok: false, failure: { code: 'placement_invalid', detail: placement.reason } }
    }
  }

  const overlays: Overlay[] = []

  if (spec.logo && logoPlacement) {
    const source = sources[spec.logo.colour]

    let logoBuffer: Buffer
    try {
      logoBuffer = await loadLogoBuffer(spec.logo.colour, sources)
    } catch (error) {
      return {
        ok: false,
        failure: {
          code: 'logo_asset_missing',
          detail: `The ${spec.logo.colour} logo could not be read from ${String(source)}: ${describe(error)}`,
        },
      }
    }

    let hasAlpha = false
    try {
      const metadata = await sharp(logoBuffer).metadata()
      hasAlpha = metadata.hasAlpha === true
    } catch (error) {
      return {
        ok: false,
        failure: {
          code: 'logo_asset_invalid',
          detail: `The ${spec.logo.colour} logo could not be decoded: ${describe(error)}`,
        },
      }
    }

    if (!hasAlpha) {
      return {
        ok: false,
        failure: {
          code: 'logo_asset_invalid',
          detail:
            `The ${spec.logo.colour} logo at ${String(source)} has no alpha channel, so compositing it ` +
            'would stamp an opaque rectangle over the artwork.',
        },
      }
    }

    try {
      // `fill` rather than `contain`, because the target box is itself derived
      // from the logo's own aspect ratio in `logoRect`. The only difference
      // between them is the sub-pixel left over by rounding the height, and
      // `contain` would pad that with a transparent sliver instead.
      const resized = await sharp(logoBuffer)
        .resize(logoPlacement.width, logoPlacement.height, { fit: 'fill', kernel: 'lanczos3' })
        .png()
        .toBuffer()

      overlays.push({ input: resized, left: logoPlacement.x, top: logoPlacement.y })
    } catch (error) {
      return {
        ok: false,
        failure: {
          code: 'logo_asset_invalid',
          detail: `The ${spec.logo.colour} logo could not be resized: ${describe(error)}`,
        },
      }
    }
  }

  if (spec.qr && qrPlacement) {
    try {
      const qrBuffer = await renderQrAtWidth(spec.qr.url, qrPlacement.width)
      overlays.push({ input: qrBuffer, left: qrPlacement.x, top: qrPlacement.y })
    } catch (error) {
      return {
        ok: false,
        failure: { code: 'qr_render_failed', detail: describe(error) },
      }
    }
  }

  try {
    let pipeline = sharp(sourceBuffer, { failOn: 'none' })

    if (overlays.length > 0) {
      pipeline = pipeline.composite(overlays)
    }

    // The poster keeps its 300dpi density so print software lays it out at A4
    // without an operator picking a scaling percentage by hand. Same rule, and
    // the same constant, as `resizeToVariant`; the four screen variants carry
    // no density because it means nothing on the web.
    if (spec.variant === 'print_poster') {
      pipeline = pipeline.withMetadata({ density: PRINT_POSTER_DENSITY_DPI })
    }

    return { ok: true, buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer() }
  } catch (error) {
    return {
      ok: false,
      failure: { code: 'source_invalid', detail: `The artwork could not be composited: ${describe(error)}` },
    }
  }
}
