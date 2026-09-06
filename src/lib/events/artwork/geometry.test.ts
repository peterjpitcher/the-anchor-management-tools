import { describe, expect, it } from 'vitest'
import {
  A4_WIDTH_MM,
  INSET_FRAC,
  LOGO_ASPECT,
  LOGO_DEFAULT_WIDTH_FRAC,
  LOGO_MAX_WIDTH_FRAC,
  LOGO_MIN_WIDTH_FRAC,
  QR_MIN_MM,
  insetPx,
  logoRect,
  qrMinWidthFrac,
  qrMinWidthPx,
  qrRect,
  rectsOverlap,
  reservedLogoRect,
  validateQrPlacement,
  type Corner,
  type Rect,
} from './geometry'
import {
  EVENT_IMAGE_VARIANTS,
  EVENT_IMAGE_VARIANT_ORDER,
} from '../imageVariants'

const CORNERS: readonly Corner[] = ['top_left', 'top_right', 'bottom_left', 'bottom_right']

/** The five real canvases, read from the variant config so a new one is covered too. */
const CANVASES = EVENT_IMAGE_VARIANT_ORDER.map((key) => ({
  key,
  width: EVENT_IMAGE_VARIANTS[key].targetWidth,
  height: EVENT_IMAGE_VARIANTS[key].targetHeight,
}))

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function isWholeRect(rect: Rect): boolean {
  return (
    Number.isInteger(rect.x) &&
    Number.isInteger(rect.y) &&
    Number.isInteger(rect.width) &&
    Number.isInteger(rect.height)
  )
}

describe('constants', () => {
  it('pins the logo aspect to the source file, 934x421', () => {
    expect(LOGO_ASPECT).toBeCloseTo(2.2185, 4)
    expect(LOGO_ASPECT).toBe(934 / 421)
  })

  it('orders the logo width bounds min < default < max', () => {
    expect(LOGO_MIN_WIDTH_FRAC).toBeLessThan(LOGO_DEFAULT_WIDTH_FRAC)
    expect(LOGO_DEFAULT_WIDTH_FRAC).toBeLessThan(LOGO_MAX_WIDTH_FRAC)
  })

  it('keeps every fraction inside 0 to 1', () => {
    for (const frac of [
      LOGO_MIN_WIDTH_FRAC,
      LOGO_DEFAULT_WIDTH_FRAC,
      LOGO_MAX_WIDTH_FRAC,
      INSET_FRAC,
      qrMinWidthFrac(),
    ]) {
      expect(frac).toBeGreaterThan(0)
      expect(frac).toBeLessThanOrEqual(1)
    }
  })

  it('keeps the widest logo inside the 934px native artwork on the biggest canvas', () => {
    const poster = EVENT_IMAGE_VARIANTS.print_poster
    expect(logoRect(poster.targetWidth, poster.targetHeight, 'top_left', LOGO_MAX_WIDTH_FRAC).width)
      .toBeLessThanOrEqual(934)
  })

  it('checks there are five canvases to reason about', () => {
    expect(CANVASES).toHaveLength(5)
  })
})

describe('insetPx', () => {
  it('takes 4 per cent of the SHORT edge, rounded', () => {
    expect(insetPx(1080, 1080)).toBe(43) // round(43.2)
    expect(insetPx(1920, 1080)).toBe(43)
    expect(insetPx(1920, 1005)).toBe(40) // round(40.2)
    expect(insetPx(1080, 1920)).toBe(43) // portrait uses the width, not the height
    expect(insetPx(2480, 3508)).toBe(99) // round(99.2)
  })

  it('is an integer on every canvas', () => {
    for (const canvas of CANVASES) {
      expect(Number.isInteger(insetPx(canvas.width, canvas.height))).toBe(true)
    }
  })
})

describe('logoRect', () => {
  it('places the widest logo in each corner of the landscape canvas', () => {
    // inset 43, width round(1920 * 0.35) = 672, height round(672 / 2.2185) = 303
    expect(logoRect(1920, 1080, 'top_left', LOGO_MAX_WIDTH_FRAC)).toEqual({
      x: 43,
      y: 43,
      width: 672,
      height: 303,
    })
    expect(logoRect(1920, 1080, 'top_right', LOGO_MAX_WIDTH_FRAC)).toEqual({
      x: 1205, // 1920 - 43 - 672
      y: 43,
      width: 672,
      height: 303,
    })
    expect(logoRect(1920, 1080, 'bottom_left', LOGO_MAX_WIDTH_FRAC)).toEqual({
      x: 43,
      y: 734, // 1080 - 43 - 303
      width: 672,
      height: 303,
    })
    expect(logoRect(1920, 1080, 'bottom_right', LOGO_MAX_WIDTH_FRAC)).toEqual({
      x: 1205,
      y: 734,
      width: 672,
      height: 303,
    })
  })

  it('clamps a requested width to the permitted range', () => {
    const tooWide = logoRect(1920, 1080, 'top_left', 0.9)
    expect(tooWide.width).toBe(logoRect(1920, 1080, 'top_left', LOGO_MAX_WIDTH_FRAC).width)

    const tooNarrow = logoRect(1920, 1080, 'top_left', 0.01)
    expect(tooNarrow.width).toBe(logoRect(1920, 1080, 'top_left', LOGO_MIN_WIDTH_FRAC).width)
    expect(tooNarrow.width).toBe(154) // round(1920 * 0.08) = round(153.6)
  })

  it('holds the logo aspect at every permitted width', () => {
    for (const canvas of CANVASES) {
      for (const frac of [LOGO_MIN_WIDTH_FRAC, LOGO_DEFAULT_WIDTH_FRAC, LOGO_MAX_WIDTH_FRAC]) {
        const rect = logoRect(canvas.width, canvas.height, 'top_left', frac)
        expect(rect.width / rect.height).toBeCloseTo(LOGO_ASPECT, 1)
        expect(isWholeRect(rect)).toBe(true)
      }
    }
  })

  it('stays on the canvas in every corner, on every canvas, at every permitted width', () => {
    for (const canvas of CANVASES) {
      const full: Rect = { x: 0, y: 0, width: canvas.width, height: canvas.height }
      for (const corner of CORNERS) {
        for (const frac of [LOGO_MIN_WIDTH_FRAC, LOGO_DEFAULT_WIDTH_FRAC, LOGO_MAX_WIDTH_FRAC]) {
          expect(contains(full, logoRect(canvas.width, canvas.height, corner, frac))).toBe(true)
        }
      }
    }
  })
})

describe('reservedLogoRect', () => {
  it('reserves the corner, its inset and the widest permitted logo', () => {
    // inset 43 + max logo 672x303 = 715x346, anchored on the corner.
    expect(reservedLogoRect(1920, 1080, 'top_left')).toEqual({
      x: 0,
      y: 0,
      width: 715,
      height: 346,
    })
    expect(reservedLogoRect(1920, 1080, 'top_right')).toEqual({
      x: 1205, // 1920 - 715
      y: 0,
      width: 715,
      height: 346,
    })
    expect(reservedLogoRect(1920, 1080, 'bottom_left')).toEqual({
      x: 0,
      y: 734, // 1080 - 346
      width: 715,
      height: 346,
    })
    expect(reservedLogoRect(1920, 1080, 'bottom_right')).toEqual({
      x: 1205,
      y: 734,
      width: 715,
      height: 346,
    })
  })

  it('reserves the right box on the A4 poster', () => {
    // inset 99, max logo round(2480 * 0.35) = 868 wide, round(868 / 2.2185) = 391 tall.
    expect(reservedLogoRect(2480, 3508, 'top_left')).toEqual({
      x: 0,
      y: 0,
      width: 967,
      height: 490,
    })
  })

  it('CONTAINS a logo drawn at the maximum width, on every canvas and corner', () => {
    // The invariant a fixed 30% by 18% reservation broke: a logo at the permitted
    // 35% stuck out of its own keep-clear box, so a QR could validate and still
    // print underneath the logo.
    for (const canvas of CANVASES) {
      for (const corner of CORNERS) {
        const reserved = reservedLogoRect(canvas.width, canvas.height, corner)
        const widest = logoRect(canvas.width, canvas.height, corner, LOGO_MAX_WIDTH_FRAC)
        expect(
          contains(reserved, widest),
          `${canvas.key} ${corner}: ${JSON.stringify(widest)} escapes ${JSON.stringify(reserved)}`
        ).toBe(true)
      }
    }
  })

  it('also contains a logo at the default and minimum widths', () => {
    for (const canvas of CANVASES) {
      for (const corner of CORNERS) {
        const reserved = reservedLogoRect(canvas.width, canvas.height, corner)
        for (const frac of [LOGO_MIN_WIDTH_FRAC, LOGO_DEFAULT_WIDTH_FRAC]) {
          expect(contains(reserved, logoRect(canvas.width, canvas.height, corner, frac))).toBe(true)
        }
      }
    }
  })

  it('stays on the canvas and returns whole pixels', () => {
    for (const canvas of CANVASES) {
      const full: Rect = { x: 0, y: 0, width: canvas.width, height: canvas.height }
      for (const corner of CORNERS) {
        const reserved = reservedLogoRect(canvas.width, canvas.height, corner)
        expect(contains(full, reserved)).toBe(true)
        expect(isWholeRect(reserved)).toBe(true)
      }
    }
  })
})

describe('qrMinWidthPx and qrMinWidthFrac', () => {
  it('rounds UP on the A4 poster, 473 not 472', () => {
    // 2480 * 40 / 210 = 472.38. A floor would print at 39.9mm, under the minimum.
    expect(qrMinWidthPx(2480)).toBe(473)
    expect(Math.floor((2480 * QR_MIN_MM) / A4_WIDTH_MM)).toBe(472)
  })

  it('never returns a width that prints under 40mm', () => {
    for (const posterWidth of [1080, 1240, 1920, 2480, 4961]) {
      const px = qrMinWidthPx(posterWidth)
      expect(Number.isInteger(px)).toBe(true)
      expect((px * A4_WIDTH_MM) / posterWidth).toBeGreaterThanOrEqual(QR_MIN_MM)
    }
  })

  it('expresses the same minimum as a fraction of the page width', () => {
    expect(qrMinWidthFrac()).toBeCloseTo(0.190476, 6)
    expect(Math.ceil(2480 * qrMinWidthFrac())).toBe(473)
  })
})

describe('qrRect', () => {
  it('centres a square on the requested point', () => {
    // side = round(2480 * 0.25) = 620; x = round(1240 - 310) = 930.
    expect(qrRect(2480, 3508, 0.5, 0.5, 0.25)).toEqual({
      x: 930,
      y: 1444, // round(1754 - 310)
      width: 620,
      height: 620,
    })
  })

  it('never leaves the canvas at the extreme centre fractions or the maximum width', () => {
    for (const canvas of CANVASES) {
      const full: Rect = { x: 0, y: 0, width: canvas.width, height: canvas.height }
      const inset = insetPx(canvas.width, canvas.height)
      for (const cx of [0, 0.25, 0.5, 0.75, 1]) {
        for (const cy of [0, 0.25, 0.5, 0.75, 1]) {
          for (const frac of [qrMinWidthFrac(), 0.3, 0.6, 1]) {
            const rect = qrRect(canvas.width, canvas.height, cx, cy, frac)
            expect(
              contains(full, rect),
              `${canvas.key} centre ${cx}/${cy} at ${frac}: ${JSON.stringify(rect)}`
            ).toBe(true)
            expect(rect.width).toBe(rect.height)
            expect(isWholeRect(rect)).toBe(true)
            // The inset margin is respected on all four sides.
            expect(rect.x).toBeGreaterThanOrEqual(inset)
            expect(rect.y).toBeGreaterThanOrEqual(inset)
            expect(rect.x + rect.width).toBeLessThanOrEqual(canvas.width - inset)
            expect(rect.y + rect.height).toBeLessThanOrEqual(canvas.height - inset)
          }
        }
      }
    }
  })

  it('clamps an oversized request to the space between the insets', () => {
    // 2480x3508, inset 99: the widest square that fits is 2480 - 198 = 2282.
    expect(qrRect(2480, 3508, 0.5, 0.5, 1)).toEqual({
      x: 99,
      y: 613, // round(1754 - 1141)
      width: 2282,
      height: 2282,
    })
  })

  it('parks the code against the margin at centre fractions of 0 and 1', () => {
    const inset = insetPx(2480, 3508)
    const topLeft = qrRect(2480, 3508, 0, 0, 0.25)
    expect(topLeft.x).toBe(inset)
    expect(topLeft.y).toBe(inset)

    const bottomRight = qrRect(2480, 3508, 1, 1, 0.25)
    expect(bottomRight.x + bottomRight.width).toBe(2480 - inset)
    expect(bottomRight.y + bottomRight.height).toBe(3508 - inset)
  })

  it('never returns a zero or negative side', () => {
    expect(qrRect(2480, 3508, 0.5, 0.5, 0).width).toBeGreaterThan(0)
    expect(qrRect(2480, 3508, 0.5, 0.5, -1).width).toBeGreaterThan(0)
  })
})

describe('rectsOverlap', () => {
  const a: Rect = { x: 100, y: 100, width: 100, height: 100 }

  it('is false for clearly separate rects', () => {
    expect(rectsOverlap(a, { x: 400, y: 400, width: 50, height: 50 }, 0)).toBe(false)
  })

  it('is true for rects that intersect', () => {
    expect(rectsOverlap(a, { x: 150, y: 150, width: 100, height: 100 }, 0)).toBe(true)
  })

  it('treats touching edges as clear when the gap is zero', () => {
    expect(rectsOverlap(a, { x: 200, y: 100, width: 50, height: 50 }, 0)).toBe(false)
  })

  it('treats the same touching edges as too close once a gap is required', () => {
    expect(rectsOverlap(a, { x: 200, y: 100, width: 50, height: 50 }, 10)).toBe(true)
  })

  it('is symmetric in its two rects', () => {
    const b: Rect = { x: 205, y: 105, width: 50, height: 50 }
    expect(rectsOverlap(a, b, 20)).toBe(rectsOverlap(b, a, 20))
    expect(rectsOverlap(a, b, 2)).toBe(rectsOverlap(b, a, 2))
  })
})

describe('validateQrPlacement', () => {
  const posterW = 2480
  const posterH = 3508
  const logo = logoRect(posterW, posterH, 'top_left', LOGO_MAX_WIDTH_FRAC)

  it('accepts a code low on the poster, away from the logo', () => {
    const qr = qrRect(posterW, posterH, 0.5, 0.8, 0.25)
    expect(validateQrPlacement(posterW, posterH, qr, logo)).toEqual({ ok: true })
  })

  it('accepts the same code when the artwork carries no logo', () => {
    const qr = qrRect(posterW, posterH, 0.5, 0.8, 0.25)
    expect(validateQrPlacement(posterW, posterH, qr, null)).toEqual({ ok: true })
  })

  it('rejects a code that overlaps the logo', () => {
    const qr = qrRect(posterW, posterH, 0.2, 0.08, 0.25)
    const result = validateQrPlacement(posterW, posterH, qr, logo)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/logo/i)
  })

  it('rejects a code that clears the logo but not the required gap', () => {
    const gap = insetPx(posterW, posterH)
    const reserved = reservedLogoRect(posterW, posterH, 'top_left')
    const side = qrMinWidthPx(posterW)
    // Sat just below the reservation, inside the gap, so it does not intersect
    // the logo itself but is still too close to it.
    const qr: Rect = { x: reserved.x, y: reserved.y + reserved.height + Math.floor(gap / 2), width: side, height: side }
    expect(rectsOverlap(qr, logo, 0)).toBe(false)
    const result = validateQrPlacement(posterW, posterH, qr, logo)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/logo/i)
  })

  it('rejects a code that would sit outside the canvas', () => {
    const side = qrMinWidthPx(posterW)
    for (const qr of [
      { x: -10, y: 1000, width: side, height: side },
      { x: 1000, y: -1, width: side, height: side },
      { x: posterW - side + 1, y: 1000, width: side, height: side },
      { x: 1000, y: posterH - side + 1, width: side, height: side },
    ]) {
      const result = validateQrPlacement(posterW, posterH, qr, null)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/outside/i)
    }
  })

  it('rejects a code under the 40mm print minimum', () => {
    const tooSmall = qrMinWidthPx(posterW) - 1 // 472px prints at 39.9mm
    const qr: Rect = { x: 1000, y: 2000, width: tooSmall, height: tooSmall }
    const result = validateQrPlacement(posterW, posterH, qr, null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('40mm')
  })

  it('accepts a code at exactly the 40mm minimum', () => {
    const side = qrMinWidthPx(posterW)
    const qr: Rect = { x: 1000, y: 2000, width: side, height: side }
    expect(validateQrPlacement(posterW, posterH, qr, null)).toEqual({ ok: true })
  })

  it('rejects a code with no area', () => {
    const result = validateQrPlacement(posterW, posterH, { x: 100, y: 100, width: 0, height: 0 }, null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/no size/i)
  })
})
