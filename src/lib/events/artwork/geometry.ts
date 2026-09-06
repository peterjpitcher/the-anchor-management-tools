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
 *   code can never come out under the stated 21mm minimum (see below).
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

/** Minimum QR width on an A4 poster when set to 10% of the page width. */
export const QR_MIN_MM = 21

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
 * The logo rectangle when it is positioned freely rather than snapped to a
 * corner, from a centre point given as a fraction of each edge.
 *
 * Clamped exactly the way `qrRect` is, so a centre parked on an edge pulls the
 * logo back inside the inset margin rather than letting it hang off the canvas.
 * A centre of 0 or 1 is therefore a legitimate request, not a corrupt value.
 *
 * The width is clamped to the same bounds `logoRect` uses, so a freely placed
 * logo can never be larger than a cornered one and can never exceed the 934px
 * the logo file actually contains.
 */
export function logoRectFree(
  imageW: number,
  imageH: number,
  centreXFrac: number,
  centreYFrac: number,
  widthFrac: number
): Rect {
  const inset = insetPx(imageW, imageH)
  const frac = clamp(widthFrac, LOGO_MIN_WIDTH_FRAC, LOGO_MAX_WIDTH_FRAC)

  // Fit the logo inside the inset margin on both axes before placing it, so an
  // oversized request on a narrow canvas degrades rather than overflowing.
  const maxWidth = Math.max(1, imageW - inset * 2)
  const maxHeight = Math.max(1, imageH - inset * 2)
  let width = clamp(Math.round(imageW * frac), 1, maxWidth)
  let height = Math.round(width / LOGO_ASPECT)
  if (height > maxHeight) {
    height = maxHeight
    width = Math.round(height * LOGO_ASPECT)
  }

  const maxX = Math.max(inset, imageW - inset - width)
  const maxY = Math.max(inset, imageH - inset - height)
  const x = clamp(Math.round(imageW * centreXFrac - width / 2), inset, maxX)
  const y = clamp(Math.round(imageH * centreYFrac - height / 2), inset, maxY)

  return { x, y, width, height }
}

/**
 * How the logo is placed. Exactly one of the two shapes, mirroring the
 * `event_images_logo_placement_exclusive` constraint in the database: storing
 * both a corner and a centre would leave the compositor guessing which the
 * person meant.
 */
export type LogoPlacement =
  | { mode: 'corner'; corner: Corner; widthFrac: number }
  | { mode: 'free'; centreXFrac: number; centreYFrac: number; widthFrac: number }

/** Resolve either placement shape to a rectangle, so callers need one path. */
export function resolveLogoRect(
  imageW: number,
  imageH: number,
  placement: LogoPlacement
): Rect {
  return placement.mode === 'corner'
    ? logoRect(imageW, imageH, placement.corner, placement.widthFrac)
    : logoRectFree(
        imageW,
        imageH,
        placement.centreXFrac,
        placement.centreYFrac,
        placement.widthFrac
      )
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

/** The same minimum is used by the editor and server validation. */
export function qrMinWidthFrac(): number {
  return QR_MIN_WIDTH_FRAC
}

/** Keep this aligned with the event_images QR width constraint. */
export const QR_MIN_WIDTH_FRAC = 0.1

/** The A4 physical size expressed as a width fraction. */
export const QR_MIN_WIDTH_FRAC_EXACT = QR_MIN_MM / A4_WIDTH_MM

/**
 * The widest a QR may be drawn, as a fraction of the image width.
 *
 * A sanity guard rather than a print rule: a code wider than two fifths of the
 * image is not a placement, it is a mistake. Matches the
 * `event_images_qr_width_frac_check` ceiling and the route's Zod bound.
 */
export const QR_MAX_WIDTH_FRAC = 0.4

/**
 * What a new QR starts at before anyone changes it: 0.20 of the width, which is
 * 42mm on A4. Comfortably over the 21mm floor without dominating the poster.
 * The previous 0.22 (46mm) started larger than most artwork wanted.
 */
export const QR_DEFAULT_WIDTH_FRAC = 0.2

/** Round up so the rendered QR never falls below 10% of the poster width. */
export function qrMinWidthPx(posterWidthPx: number): number {
  return Math.ceil(posterWidthPx * QR_MIN_WIDTH_FRAC)
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
  // Round up to preserve the requested width on every canvas size.
  const side = clamp(Math.ceil(posterW * widthFrac), 1, maxSide)

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
 *   2. it is smaller than the 21mm print minimum for this poster width;
 *   3. it comes within one inset of the logo's keep-clear region.
 *
 * The gap used against the logo is `insetPx` for the canvas, the same margin
 * used everywhere else here, so a code that clears the logo also looks like it
 * clears it.
 *
 * Pass `logo` as null when the artwork carries no logo. This validator is for
 * the print poster path: the 21mm rule is a print rule and has no meaning on a
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

  // The BLOCK is what lands on the artwork: the code plus its BOOK NOW strip.
  // Validating the code alone would let the strip hang off the edge.
  const block = qrBlockRect(qr)
  if (
    block.x < 0 ||
    block.y < 0 ||
    block.x + block.width > posterW ||
    block.y + block.height > posterH
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

  if (logo && rectsOverlap(block, logo, insetPx(posterW, posterH))) {
    return { ok: false, reason: 'The QR code is too close to the logo.' }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Logo drop shadow
//
// A white logo disappears on pale artwork and a black one disappears on dark
// artwork, so each carries a shadow in the opposite colour. It is the contrast
// that does the work, not decoration: without it the mark is invisible on
// exactly the artwork where it matters most.
//
// The measurements are fractions of the LOGO width, not the canvas, so the
// shadow scales with the mark rather than growing on a poster and vanishing on
// a story.
// ---------------------------------------------------------------------------

/** How far the shadow is pushed down and right, as a fraction of logo width. */
export const LOGO_SHADOW_OFFSET_FRAC = 0.025

/** Gaussian sigma for the shadow, as a fraction of logo width. */
export const LOGO_SHADOW_BLUR_FRAC = 0.035

/** Deliberately short of opaque, so the shadow reads as depth and not an outline. */
export const LOGO_SHADOW_OPACITY = 0.55

export type LogoColour = 'white' | 'black'

/** The shadow is always the opposite of the mark, which is the entire point. */
export function shadowColourFor(logoColour: LogoColour): '#000000' | '#ffffff' {
  return logoColour === 'white' ? '#000000' : '#ffffff'
}

export interface LogoShadowSpec {
  colour: '#000000' | '#ffffff'
  offsetXPx: number
  offsetYPx: number
  blurPx: number
  opacity: number
}

/**
 * The shadow measurements in pixels for a given logo rectangle.
 *
 * Both the server compositor and the browser preview call this, so what is seen
 * on screen is what gets rendered. `blurPx` is a Gaussian sigma: sharp takes it
 * directly, and CSS `drop-shadow` takes roughly twice it as its blur radius,
 * which `cssDropShadow` below already accounts for.
 */
export function logoShadowSpec(logo: Rect, logoColour: LogoColour): LogoShadowSpec {
  const offset = Math.max(1, Math.round(logo.width * LOGO_SHADOW_OFFSET_FRAC))
  return {
    colour: shadowColourFor(logoColour),
    offsetXPx: offset,
    offsetYPx: offset,
    blurPx: Math.max(1, Math.round(logo.width * LOGO_SHADOW_BLUR_FRAC)),
    opacity: LOGO_SHADOW_OPACITY,
  }
}

/**
 * The same shadow as a CSS `drop-shadow` filter value, for the preview.
 *
 * CSS expresses blur as a radius of about twice the Gaussian sigma sharp uses,
 * so the sigma is doubled here rather than in the caller. The two will never be
 * pixel identical (different rasterisers), but they agree on placement, colour
 * and weight, which is what someone positioning a logo is judging.
 */
export function cssDropShadow(spec: LogoShadowSpec): string {
  const rgb = spec.colour === '#000000' ? '0, 0, 0' : '255, 255, 255'
  return `drop-shadow(${spec.offsetXPx}px ${spec.offsetYPx}px ${spec.blurPx * 2}px rgba(${rgb}, ${spec.opacity}))`
}

// ---------------------------------------------------------------------------
// The BOOK NOW strip
//
// A bare QR on a poster tells nobody what it is for. A labelled strip beside it
// does. It sits ALONGSIDE the code and never over it: error correction H would
// survive some occlusion, but a strip down one side removes a whole column of
// modules, which is far worse for a scanner than the centred logos that
// occlusion budget is usually spent on.
//
// `qr_width_frac` keeps meaning the CODE width, so the 21mm print minimum and
// the database CHECK constraints all still mean what they say. The strip makes
// the placed BLOCK wider than the code, and it is the block that has to fit on
// the canvas and clear the logo.
// ---------------------------------------------------------------------------

/** Strip width as a fraction of the code width. */
export const QR_STRIP_WIDTH_FRAC_OF_CODE = 0.22

/** The label. Short, imperative, and legible rotated at small sizes. */
export const QR_STRIP_LABEL = 'BOOK NOW'

/**
 * Which side of the code the strip sits on.
 *
 * Left, so the label is read before the code on a left-to-right poster. One
 * constant, so moving it to the right is a single edit.
 */
export const QR_STRIP_SIDE: 'left' | 'right' = 'left'

/** The strip beside a given code rectangle. */
export function qrStripRect(code: Rect): Rect {
  const width = Math.max(1, Math.round(code.width * QR_STRIP_WIDTH_FRAC_OF_CODE))
  return {
    x: QR_STRIP_SIDE === 'left' ? code.x - width : code.x + code.width,
    y: code.y,
    width,
    height: code.height,
  }
}

/**
 * The code and its strip as one rectangle.
 *
 * This is what gets validated and what the preview draws a box around, because
 * it is what actually lands on the artwork.
 */
export function qrBlockRect(code: Rect): Rect {
  const strip = qrStripRect(code)
  return {
    x: Math.min(code.x, strip.x),
    y: code.y,
    width: code.width + strip.width,
    height: code.height,
  }
}

/**
 * Place the code so that the whole BLOCK, strip included, stays on the canvas.
 *
 * `qrRect` positions the code alone, which would let the strip hang off the
 * edge when the code is pushed hard against it. This shifts the code back by
 * however much the strip overhangs.
 */
export function qrCodeRectWithinCanvas(
  posterW: number,
  posterH: number,
  centreXFrac: number,
  centreYFrac: number,
  widthFrac: number
): Rect {
  const inset = insetPx(posterW, posterH)
  const code = qrRect(posterW, posterH, centreXFrac, centreYFrac, widthFrac)
  const block = qrBlockRect(code)

  let dx = 0
  if (block.x < inset) dx = inset - block.x
  const blockRight = block.x + block.width
  if (blockRight > posterW - inset) dx = Math.min(dx, posterW - inset - blockRight)

  return { ...code, x: code.x + dx }
}

// ---------------------------------------------------------------------------
// Snapping
//
// Dragging to a visual centre by eye is guesswork, and being one pixel out is
// obvious once printed. Snap targets pull a drag onto the exact centre when it
// is already close, and let go as soon as the drag moves past the threshold, so
// a deliberate off-centre placement is still possible.
// ---------------------------------------------------------------------------

/** Centre of the canvas on each axis. Thirds were considered and left out: on
 *  artwork this small they produce more false snaps than useful ones. */
export const SNAP_TARGETS_FRAC: readonly number[] = [0.5]

/** How close a drag has to get before it snaps, as a fraction of the edge. */
export const SNAP_THRESHOLD_FRAC = 0.02

export interface SnapResult {
  /** The value to use, snapped when within the threshold. */
  value: number
  /** The target it snapped to, or null when it did not snap. Drives the guide. */
  snappedTo: number | null
}

/**
 * Snap a 0-to-1 position onto the nearest target when it is close enough.
 *
 * Pure, so the preview and any test agree. Returns which target it caught so
 * the caller can draw a guide line exactly where the snap happened rather than
 * guessing.
 */
export function snapFrac(
  value: number,
  targets: readonly number[] = SNAP_TARGETS_FRAC,
  threshold: number = SNAP_THRESHOLD_FRAC
): SnapResult {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  // A hair of tolerance, because 0.5 + 0.02 is 0.5200000000000001 in binary
  // floating point and a drag that lands exactly on the threshold should snap
  // rather than fall through on a rounding artefact.
  const limit = threshold + 1e-9

  for (const target of targets) {
    const distance = Math.abs(value - target)
    if (distance <= limit && distance < bestDistance) {
      best = target
      bestDistance = distance
    }
  }

  return best === null ? { value, snappedTo: null } : { value: best, snappedTo: best }
}
