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
 *    `renderQrAtWidth` below. Its BOOK NOW strip is drawn ALONGSIDE the code and
 *    never over it: error correction H would survive some occlusion, but a strip
 *    down one side takes out a whole column of modules, which is far worse for a
 *    scanner than the centred marks that occlusion budget usually pays for.
 *
 * 5. The logo carries a drop shadow in the OPPOSITE colour, because a white mark
 *    disappears on pale artwork and a black one disappears on dark artwork. The
 *    shadow is the logo's own shape taken from its alpha channel, never a
 *    rectangle, and it is clipped to the canvas so branding cannot change the
 *    image's size.
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
  resolveLogoRect,
  type LogoPlacement,
  logoShadowSpec,
  type LogoShadowSpec,
  qrCodeRectWithinCanvas,
  qrStripRect,
  validateQrPlacement,
  QR_STRIP_LABEL,
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
  /**
   * Null means the staff member deliberately chose no logo.
   *
   * `placement` is either a corner with a standard inset or a free centre
   * point, never both, mirroring the database constraint. Free placement exists
   * because plenty of artwork leaves no usable corner.
   */
  logo: { placement: LogoPlacement; colour: LogoColour } | null
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
 * How far past the silhouette the shadow's own canvas is padded, in Gaussian
 * sigmas. Three is where the tail is under half a percent of the peak, so the
 * blur falls away inside its own frame. Without the padding the Gaussian is cut
 * off at the silhouette's edge and the shadow ends in a hard line, which is the
 * one thing a shadow must not do.
 */
const SHADOW_BLUR_SIGMAS = 3

/** Fully transparent, used to pad the shadow's frame. */
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

/**
 * The BOOK NOW strip, in plain black and white on purpose.
 *
 * The design briefs have not supplied a brand colour for this, and flat white on
 * flat black is what survives a photocopier, a cheap poster print and a phone
 * camera in a dim corridor. Nothing here is decorative.
 */
const QR_STRIP_BACKGROUND = '#000000'
const QR_STRIP_INK = '#ffffff'

/**
 * Original vector outlines for the fixed label, in a 100-unit cap height.
 * Sharp's SVG renderer cannot rely on system fonts being installed on Vercel:
 * even generic sans-serif can render missing-glyph squares there. Paths keep
 * the exported lettering identical in every runtime, without a font asset.
 */
const QR_LABEL_GLYPHS: Record<string, { width: number; path: string }> = {
  B: {
    width: 70,
    path: 'M0 0H36Q66 0 66 25Q66 41 53 48Q70 54 70 74Q70 100 37 100H0Z ' +
      'M19 17V40H34Q47 40 47 28Q47 17 34 17Z M19 57V83H36Q50 83 50 70Q50 57 36 57Z',
  },
  O: {
    width: 70,
    path: 'M35 0Q70 0 70 50Q70 100 35 100Q0 100 0 50Q0 0 35 0Z ' +
      'M35 18Q19 18 19 50Q19 82 35 82Q51 82 51 50Q51 18 35 18Z',
  },
  K: {
    width: 70,
    path: 'M0 0H19V40L47 0H70L35 48L70 100H47L19 59V100H0Z',
  },
  N: {
    width: 70,
    path: 'M0 100V0H20L51 64V0H70V100H50L19 36V100Z',
  },
  W: {
    width: 100,
    path: 'M0 0H20L31 69L42 12H58L69 69L80 0H100L80 100H60L50 48L40 100H20Z',
  },
}

const QR_LABEL_CAP_HEIGHT = 100
const QR_LABEL_TRACKING = 10
const QR_LABEL_SPACE_WIDTH = 40
const QR_LABEL_HEIGHT_FRAC_OF_STRIP_WIDTH = 0.55

/**
 * How far the shadow's own frame is padded beyond the logo rectangle, in pixels.
 *
 * Exported so a test can work out how far outside the logo rect the shadow may
 * legitimately paint without hard coding `SHADOW_BLUR_SIGMAS` in two places.
 * Combined with the spec's offset it gives the reach on each edge: `pad +
 * offset` down and right, `pad - offset` up and left.
 */
export function logoShadowPaddingPx(spec: LogoShadowSpec): number {
  return Math.max(1, Math.round(spec.blurPx * SHADOW_BLUR_SIGMAS))
}

/** A rectangle cut down to what actually lands on the canvas. */
interface ClippedOverlay {
  /** Where the visible part goes on the canvas. */
  x: number
  y: number
  width: number
  height: number
  /** Where that visible part starts inside the overlay itself. */
  sourceX: number
  sourceY: number
}

/**
 * Cut an overlay rectangle down to the part that lands on the canvas.
 *
 * A blurred shadow beside a logo in a corner reaches past the canvas edge by
 * design. sharp does trim an overhanging overlay itself, but it refuses one
 * larger than the base image outright, and neither behaviour is worth leaning on
 * for something whose failure mode is a resized poster. Cutting the overlay here
 * keeps the output the same size as the input, which `validateCompositeOutput`
 * asserts and a printed poster would reveal.
 *
 * Returns null when nothing of the rectangle is on the canvas.
 */
function clipToCanvas(
  rect: Rect,
  canvas: { width: number; height: number }
): ClippedOverlay | null {
  const x = Math.max(rect.x, 0)
  const y = Math.max(rect.y, 0)
  const right = Math.min(rect.x + rect.width, canvas.width)
  const bottom = Math.min(rect.y + rect.height, canvas.height)

  if (right <= x || bottom <= y) return null

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    sourceX: x - rect.x,
    sourceY: y - rect.y,
  }
}

/**
 * The logo's drop shadow as a ready-to-composite overlay, or null when it falls
 * entirely off the canvas.
 *
 * Built in four steps, none of them optional:
 *
 * 1. The logo is resized to its final rectangle and padded with transparency so
 *    the blur has room to fall away (see `SHADOW_BLUR_SIGMAS`).
 * 2. Its ALPHA channel becomes the mask. That is what makes the shadow the
 *    logo's shape rather than a rectangle over the artwork.
 * 3. That mask is faded to the spec's opacity, then joined as the alpha channel
 *    of a flat plate in the shadow colour.
 * 4. The result is offset and clipped to the canvas.
 *
 * Each of those is its own sharp call rather than one chained pipeline, and both
 * PNG round trips are load bearing. sharp flags a freshly extracted alpha band
 * as premultiplied and then silently ignores tone operations applied to it, so
 * fading the mask in that state is a no-op and the shadow comes out fully
 * opaque; re-encoding clears the flag. Chaining also reorders operations into
 * sharp's own fixed pipeline order rather than the order they are written in,
 * which is how an earlier attempt ended up compositing a four band overlay onto
 * a three band plate and failing with `images do not have same numbers of
 * bands`.
 *
 * `spec.blurPx` is a Gaussian sigma, which is what `.blur()` takes directly.
 */
async function renderLogoShadow(
  logoBuffer: Buffer,
  logo: Rect,
  spec: LogoShadowSpec,
  canvas: { width: number; height: number }
): Promise<Overlay | null> {
  const sharp = (await import('sharp')).default

  const pad = logoShadowPaddingPx(spec)
  const width = logo.width + pad * 2
  const height = logo.height + pad * 2

  const padded = await sharp(logoBuffer)
    .resize(logo.width, logo.height, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: TRANSPARENT })
    .png()
    .toBuffer()

  const mask = await sharp(padded).extractChannel('alpha').png().toBuffer()
  const blurred = await sharp(mask).blur(spec.blurPx).png().toBuffer()
  const faded = await sharp(blurred).linear(spec.opacity, 0).raw().toBuffer()

  const shadow = await sharp({
    create: { width, height, channels: 3, background: spec.colour },
  })
    .joinChannel(faded, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()

  const clipped = clipToCanvas(
    {
      x: logo.x - pad + spec.offsetXPx,
      y: logo.y - pad + spec.offsetYPx,
      width,
      height,
    },
    canvas
  )
  if (!clipped) return null

  const input = await sharp(shadow)
    .extract({
      left: clipped.sourceX,
      top: clipped.sourceY,
      width: clipped.width,
      height: clipped.height,
    })
    .png()
    .toBuffer()

  return { input, left: clipped.x, top: clipped.y }
}

/**
 * The BOOK NOW strip as an SVG, sized to the rectangle `qrStripRect` returned.
 *
 * The label runs vertically and reads bottom to top, the usual convention for a
 * vertical label, which is what `rotate(-90)` about the strip's centre gives.
 * Exported so a test can rasterise it on its own rather than only ever seeing it
 * through a full composite.
 *
 * `QR_STRIP_LABEL` is plain capitals with a single space, so there is nothing
 * here to escape for XML. Anything else would need escaping before it went into
 * the markup.
 */
export function qrStripSvg(strip: Rect): Buffer {
  let labelWidth = 0
  const paths = Array.from(QR_STRIP_LABEL, (letter) => {
    const x = labelWidth
    if (letter === ' ') {
      labelWidth += QR_LABEL_SPACE_WIDTH + QR_LABEL_TRACKING
      return ''
    }
    const glyph = QR_LABEL_GLYPHS[letter]
    if (!glyph) throw new Error(`No vector outline for QR label character: ${letter}`)
    labelWidth += glyph.width + QR_LABEL_TRACKING
    return `<path transform="translate(${x} 0)" d="${glyph.path}"/>`
  }).join('')
  labelWidth -= QR_LABEL_TRACKING

  const scale = Math.min(
    strip.width * QR_LABEL_HEIGHT_FRAC_OF_STRIP_WIDTH / QR_LABEL_CAP_HEIGHT,
    strip.height * 0.9 / labelWidth
  )
  const centreX = strip.width / 2
  const centreY = strip.height / 2

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${strip.width}" height="${strip.height}" ` +
      `viewBox="0 0 ${strip.width} ${strip.height}">` +
      `<title>${QR_STRIP_LABEL}</title>` +
      `<rect x="0" y="0" width="${strip.width}" height="${strip.height}" fill="${QR_STRIP_BACKGROUND}"/>` +
      `<g transform="translate(${centreX} ${centreY}) rotate(-90) scale(${scale}) ` +
      `translate(${-labelWidth / 2} ${-QR_LABEL_CAP_HEIGHT / 2})" ` +
      `fill="${QR_STRIP_INK}" fill-rule="evenodd">${paths}</g>` +
      `</svg>`,
    'utf8'
  )
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
 * discovered after it has been printed. The 10% width minimum is applied to
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
    ? resolveLogoRect(imageW, imageH, spec.logo.placement)
    : null

  // `qrCodeRectWithinCanvas`, not `qrRect`: the code is only half of what gets
  // drawn, and a code pushed hard against an edge would otherwise hang its BOOK
  // NOW strip off the canvas. `validateQrPlacement` checks the whole block too.
  const qrPlacement: Rect | null = spec.qr
    ? qrCodeRectWithinCanvas(
        imageW,
        imageH,
        spec.qr.centreXFrac,
        spec.qr.centreYFrac,
        spec.qr.widthFrac
      )
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

      // The shadow goes on first so the mark sits over it, and its colour is the
      // opposite of the mark's: that contrast is the only reason a white logo
      // survives pale artwork and a black one survives dark artwork.
      const shadow = await renderLogoShadow(
        logoBuffer,
        logoPlacement,
        logoShadowSpec(logoPlacement, spec.logo.colour),
        { width: imageW, height: imageH }
      )
      if (shadow) overlays.push(shadow)

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

      // A bare code tells nobody what it is for. The strip is placed by
      // `qrStripRect`, which puts it beside the code and never over it, and
      // `validateQrPlacement` has already confirmed the pair fits on the canvas,
      // so there is nothing here to clip. It shares the QR's catch on purpose:
      // if the SVG cannot be rasterised the whole composite fails visibly rather
      // than quietly shipping a code with no label on it.
      const strip = qrStripRect(qrPlacement)
      const stripBuffer = await sharp(qrStripSvg(strip)).png().toBuffer()

      overlays.push({ input: stripBuffer, left: strip.x, top: strip.y })
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
