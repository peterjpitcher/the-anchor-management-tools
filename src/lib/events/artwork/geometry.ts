/**
 * Placement geometry for the venue logo and the booking QR code on event artwork.
 *
 * This module is the ONLY place that decides where those two things sit. The
 * browser preview and the server-side compositor both import it, so what a
 * member of staff drags on screen is what the rendered file gets. Anything that
 * recomputes a corner, an inset or a QR size for itself will drift away from the
 * other side within a release.
 *
 * Conventions, all of them deliberate:
 *
 * - Every placement input is a FRACTION of an image edge in the range 0 to 1,
 *   and every such name ends in `Frac`. There are no percentages anywhere in
 *   this module, and no function takes a 0 to 100 number. Mixing the two is what
 *   the naming rule exists to prevent.
 * - Every pixel output is an integer. Sizes and positions use `Math.round`; the
 *   single exception is `qrMinWidthPx`, which uses `Math.ceil` so the printed
 *   code can never come out under the stated 40mm minimum (see below).
 * - Rects are `{ x, y, width, height }` in pixels, x and y being the top-left
 *   corner, y growing downwards, which is what both a canvas and Sharp expect.
 * - Pure functions only. No I/O, no state, no imports.
 */

/**
 * The venue logo pair (`public/guest/anchor-logo-white.png` and
 * `public/guest/anchor-logo-black.png`) is 934x421 with a real alpha channel.
 * 934 / 421 = 2.2185...
 */
export const LOGO_ASPECT = 934 / 421

/**
 * The widest the logo may be drawn, as a fraction of the image width.
 *
 * 0.35 keeps the logo inside its own native resolution on the largest canvas we
 * produce: the A4 poster is 2480px wide, and 2480 * 0.35 = 868px, still under
 * the 934px the source file actually contains. Going wider would upscale the
 * artwork and soften the edges in print.
 */
export const LOGO_MAX_WIDTH_FRAC = 0.35

/** Below this the logo is unreadable at social sizes, so it is the floor. */
export const LOGO_MIN_WIDTH_FRAC = 0.08

/** What a new placement starts at before anyone drags it. */
export const LOGO_DEFAULT_WIDTH_FRAC = 0.22

/**
 * The margin held clear at the edge of every canvas, as a fraction of the SHORT
 * edge. Taking it from the short edge keeps the visual gap even on a 9:16 story
 * instead of shoving a portrait canvas's side margins out to a fifth of its
 * width.
 */
export const INSET_FRAC = 0.04

/**
 * The smallest a QR code may be printed. The app's designer README states a 40mm
 * minimum for a poster QR, which is the size a phone camera reliably locks onto
 * from arm's length on a wall.
 */
export const QR_MIN_MM = 40

/** A4 portrait is 210mm wide. The print poster canvas is A4 at 300dpi. */
export const A4_WIDTH_MM = 210

export type Corner = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'

/** A rectangle in image pixels. x and y are the top-left corner. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type QrPlacementResult = { ok: true } | { ok: false; reason: string }

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(value, min), max)
}

function isLeftCorner(corner: Corner): boolean {
  return corner === 'top_left' || corner === 'bottom_left'
}

function isTopCorner(corner: Corner): boolean {
  return corner === 'top_left' || corner === 'top_right'
}

/**
 * The edge margin in pixels for a canvas: `INSET_FRAC` of the short edge,
 * rounded to the nearest pixel.
 *
 * Worked examples on the five variant canvases:
 *   1080x1080 -> round(1080 * 0.04) = round(43.2) = 43
 *   1920x1080 -> round(1080 * 0.04) = 43
 *   1920x1005 -> round(1005 * 0.04) = round(40.2) = 40
 *   1080x1920 -> round(1080 * 0.04) = 43
 *   2480x3508 -> round(2480 * 0.04) = round(99.2) = 99
 */
export function insetPx(imageW: number, imageH: number): number {
  return Math.round(Math.min(imageW, imageH) * INSET_FRAC)
}

/**
 * Where the logo actually sits, for a corner and a requested width.
 *
 * `widthFrac` is a fraction of the image WIDTH and is clamped to
 * [`LOGO_MIN_WIDTH_FRAC`, `LOGO_MAX_WIDTH_FRAC`], so a caller cannot produce a
 * logo the reservation below does not cover. The height follows from
 * `LOGO_ASPECT`; the logo is never stretched.
 */
export function logoRect(
  imageW: number,
  imageH: number,
  corner: Corner,
  widthFrac: number
): Rect {
  const frac = clamp(widthFrac, LOGO_MIN_WIDTH_FRAC, LOGO_MAX_WIDTH_FRAC)
  const inset = insetPx(imageW, imageH)
  const width = Math.round(imageW * frac)
  const height = Math.round(width / LOGO_ASPECT)

  return {
    x: isLeftCorner(corner) ? inset : imageW - inset - width,
    y: isTopCorner(corner) ? inset : imageH - inset - height,
    width,
    height,
  }
}

/**
 * The keep-clear region for a corner: the corner itself, its inset margin, and
 * the LARGEST logo permitted on this canvas.
 *
 * It is derived from `logoRect` at `LOGO_MAX_WIDTH_FRAC` rather than from a
 * fixed reservation, which is the whole point of the function. A fixed 30%-wide
 * by 18%-tall box was smaller than a logo drawn at the permitted 35%, so a QR
 * could pass validation and still land under the logo.
 *
 * Working, on the 1920x1080 landscape canvas:
 *   inset            = round(min(1920, 1080) * 0.04) = round(43.2)   = 43
 *   max logo width   = round(1920 * 0.35)            = round(672)    = 672
 *   max logo height  = round(672 / (934 / 421))      = round(302.90) = 303
 *   reserved width   = 672 + 43 = 715
 *   reserved height  = 303 + 43 = 346
 *
 * The inset is added ONCE, not twice: the reservation runs from the canvas edge
 * to the far side of the largest logo, and the logo already starts one inset in
 * from that edge. Adding a second inset would reserve dead space beyond the
 * logo, which is what the `gap` argument to `validateQrPlacement` is for.
 *
 * That gives 715x346 on this canvas. The review that specified this module
 * quoted 723x346. The height agrees, which confirms the single-inset basis; the
 * width does not, and 723 cannot be reached from these formulae (it needs either
 * a 680px max logo, i.e. 35.4% of the width, or a 51px horizontal inset against
 * a 43px vertical one). 715 is what the stated constants produce, so 715 is what
 * this module returns and what the tests assert.
 */
export function reservedLogoRect(imageW: number, imageH: number, corner: Corner): Rect {
  const inset = insetPx(imageW, imageH)
  const maxLogo = logoRect(imageW, imageH, corner, LOGO_MAX_WIDTH_FRAC)
  const width = maxLogo.width + inset
  const height = maxLogo.height + inset

  return {
    x: isLeftCorner(corner) ? 0 : imageW - width,
    y: isTopCorner(corner) ? 0 : imageH - height,
    width,
    height,
  }
}

/**
 * The 40mm print minimum expressed as a fraction of an A4 page width.
 * 40 / 210 = 0.19047...
 */
export function qrMinWidthFrac(): number {
  return QR_MIN_MM / A4_WIDTH_MM
}

/**
 * The 40mm print minimum in pixels for a poster of a given pixel width.
 *
 * Rounded UP, on purpose. On the 2480px A4 canvas the exact figure is
 * 2480 * 40 / 210 = 472.38px; rounding down to 472 prints at 39.9mm, which is
 * under the minimum we tell designers we hold to. So this returns 473.
 */
export function qrMinWidthPx(posterWidthPx: number): number {
  return Math.ceil((posterWidthPx * QR_MIN_MM) / A4_WIDTH_MM)
}

/**
 * Where the QR code sits, given the centre point staff dragged it to.
 *
 * The code is always square. `widthFrac` is a fraction of the poster WIDTH, and
 * is clamped so the square still fits between the insets on the short edge.
 * `centreXFrac` and `centreYFrac` are fractions of the width and height; the
 * resulting rect is then clamped so the whole code, including its inset margin,
 * stays on the canvas. A centre fraction of 0 or 1 therefore parks the code
 * against the margin rather than hanging it off the edge.
 */
export function qrRect(
  posterW: number,
  posterH: number,
  centreXFrac: number,
  centreYFrac: number,
  widthFrac: number
): Rect {
  const inset = insetPx(posterW, posterH)
  const maxSide = Math.max(1, Math.min(posterW, posterH) - inset * 2)
  const side = clamp(Math.round(posterW * widthFrac), 1, maxSide)

  const maxX = Math.max(inset, posterW - inset - side)
  const maxY = Math.max(inset, posterH - inset - side)
  const x = clamp(Math.round(posterW * centreXFrac - side / 2), inset, maxX)
  const y = clamp(Math.round(posterH * centreYFrac - side / 2), inset, maxY)

  return { x, y, width: side, height: side }
}

/**
 * Do two rects come within `gap` pixels of each other?
 *
 * `a` is grown by `gap` on all four sides and tested for intersection with `b`,
 * which is symmetric in the two rects. Edges that merely touch do not count as
 * an overlap.
 */
export function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  const left = a.x - gap
  const top = a.y - gap
  const right = a.x + a.width + gap
  const bottom = a.y + a.height + gap

  return left < b.x + b.width && b.x < right && top < b.y + b.height && b.y < bottom
}

/**
 * Is this QR placement printable?
 *
 * Three ways it can fail, checked in the order a person would notice them:
 *   1. any part of the code is off the canvas, or it has no area;
 *   2. it is smaller than the 40mm print minimum for this poster width;
 *   3. it comes within one inset of the logo's keep-clear region.
 *
 * The gap used against the logo is `insetPx` for the canvas, the same margin
 * used everywhere else here, so a code that clears the logo also looks like it
 * clears it.
 *
 * Pass `logo` as null when the artwork carries no logo. This validator is for
 * the print poster path: the 40mm rule is a print rule and has no meaning on a
 * screen-only variant.
 */
export function validateQrPlacement(
  posterW: number,
  posterH: number,
  qr: Rect,
  logo: Rect | null
): QrPlacementResult {
  if (qr.width <= 0 || qr.height <= 0) {
    return { ok: false, reason: 'The QR code has no size.' }
  }

  if (
    qr.x < 0 ||
    qr.y < 0 ||
    qr.x + qr.width > posterW ||
    qr.y + qr.height > posterH
  ) {
    return { ok: false, reason: 'The QR code falls outside the poster.' }
  }

  const minWidth = qrMinWidthPx(posterW)
  if (qr.width < minWidth) {
    return {
      ok: false,
      reason: `The QR code is smaller than the ${QR_MIN_MM}mm print minimum (${minWidth}px on this poster).`,
    }
  }

  if (logo && rectsOverlap(qr, logo, insetPx(posterW, posterH))) {
    return { ok: false, reason: 'The QR code is too close to the logo.' }
  }

  return { ok: true }
}
