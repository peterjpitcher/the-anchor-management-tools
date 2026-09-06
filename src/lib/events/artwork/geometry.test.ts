import { readFileSync } from 'fs'
import { resolve } from 'path'
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
  logoRectFree,
  resolveLogoRect,
  QR_MIN_WIDTH_FRAC,
  QR_MIN_WIDTH_FRAC_EXACT,
  shadowColourFor,
  logoShadowSpec,
  cssDropShadow,
  qrStripRect,
  qrBlockRect,
  qrCodeRectWithinCanvas,
  snapFrac,
  SNAP_THRESHOLD_FRAC,
  QR_ADVISORY_MIN_WIDTH_FRAC,
  QR_DEFAULT_WIDTH_FRAC,
  QR_MAX_WIDTH_FRAC,
  qrHardMinWidthPx,
  isBelowPrintGuidance,
  qrWidthMm,
} from './geometry'
import { EVENT_IMAGE_VARIANTS, EVENT_IMAGE_VARIANT_ORDER } from '@/lib/events/imageVariants'
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

  it('expresses the same minimum as the ENFORCED fraction, rounded up', () => {
    // Deliberately 0.1905 and not the exact 40/210 = 0.190476. The enforced
    // floor has to sit at or above the exact ratio, never below it, or the
    // smallest legal code prints under 40mm. It also has to match the database
    // CHECK and the route's Zod bound, both of which use 0.1905; returning the
    // unrounded ratio here meant the geometric minimum was rejected with a 400.
    // The 40mm guidance is now ADVISORY, not the enforced floor. It still has
    // to round UP, or the warning would let a code under 40mm through silently.
    expect(QR_ADVISORY_MIN_WIDTH_FRAC).toBe(0.1905)
    expect(QR_ADVISORY_MIN_WIDTH_FRAC).toBeGreaterThan(40 / 210)
    expect(qrMinWidthPx(2480)).toBe(473)
    // The ENFORCED floor is lower, so 0.20 can sit mid-range.
    expect(qrMinWidthFrac()).toBe(0.12)
    // And the rect built at that fraction is at least the minimum pixel width.
    expect(qrRect(2480, 3508, 0.5, 0.5, QR_ADVISORY_MIN_WIDTH_FRAC).width)
      .toBeGreaterThanOrEqual(qrMinWidthPx(2480))
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
    // Shifted right by the strip width so the whole BLOCK stays on the canvas.
    // Without that the bounds check fires first and this stops testing the gap.
    const stripWidth = qrStripRect({ x: 0, y: 0, width: side, height: side }).width
    const qr: Rect = {
      x: reserved.x + insetPx(posterW, posterH) + stripWidth,
      y: reserved.y + reserved.height + Math.floor(gap / 2),
      width: side,
      height: side,
    }
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

  it('ALLOWS a code under the 40mm guidance, and flags it instead', () => {
    // 40mm is now advisory. The editor warns; it does not refuse. Refusing was
    // what made the smallest allowed code still too big for busy artwork.
    const underGuidance = qrMinWidthPx(posterW) - 1 // 472px, prints at 39.9mm
    const qr: Rect = { x: 1000, y: 2000, width: underGuidance, height: underGuidance }
    expect(validateQrPlacement(posterW, posterH, qr, null).ok).toBe(true)
    expect(isBelowPrintGuidance(underGuidance / posterW)).toBe(true)
  })

  it('rejects a code under the HARD floor, which is what still cannot print', () => {
    const tooSmall = qrHardMinWidthPx(posterW) - 1
    const qr: Rect = { x: 1000, y: 2000, width: tooSmall, height: tooSmall }
    const result = validateQrPlacement(posterW, posterH, qr, null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('too small')
  })

  it('puts the default at the exact midpoint of the range', () => {
    // The slider opens mid-travel and moves the same distance either way.
    expect(QR_DEFAULT_WIDTH_FRAC).toBeCloseTo((QR_MIN_WIDTH_FRAC + QR_MAX_WIDTH_FRAC) / 2, 10)
  })

  it('reports the printed width in millimetres for the readout', () => {
    expect(qrWidthMm(QR_MIN_WIDTH_FRAC)).toBeCloseTo(25.2, 1)
    expect(qrWidthMm(QR_DEFAULT_WIDTH_FRAC)).toBeCloseTo(42, 1)
    expect(qrWidthMm(QR_MAX_WIDTH_FRAC)).toBeCloseTo(58.8, 1)
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

describe('logoRectFree', () => {
  const CANVASES = EVENT_IMAGE_VARIANT_ORDER.map((variant) => ({
    variant,
    w: EVENT_IMAGE_VARIANTS[variant].targetWidth,
    h: EVENT_IMAGE_VARIANTS[variant].targetHeight,
  }))

  it('centres the logo on the requested point when there is room', () => {
    const rect = logoRectFree(1920, 1080, 0.5, 0.5, 0.22)
    expect(rect.x + rect.width / 2).toBeCloseTo(960, 0)
    expect(rect.y + rect.height / 2).toBeCloseTo(540, 0)
  })

  it('keeps the 934:421 aspect of the logo file', () => {
    const rect = logoRectFree(1920, 1080, 0.5, 0.5, 0.3)
    expect(rect.width / rect.height).toBeCloseTo(LOGO_ASPECT, 1)
  })

  it('never hangs off the canvas, at any centre on any variant', () => {
    for (const { variant, w, h } of CANVASES) {
      for (const cx of [0, 0.25, 0.5, 0.75, 1]) {
        for (const cy of [0, 0.25, 0.5, 0.75, 1]) {
          for (const wf of [0.08, 0.22, 0.35]) {
            const r = logoRectFree(w, h, cx, cy, wf)
            const inset = insetPx(w, h)
            expect(r.x, `${variant} x at ${cx},${cy}`).toBeGreaterThanOrEqual(inset)
            expect(r.y, `${variant} y at ${cx},${cy}`).toBeGreaterThanOrEqual(inset)
            expect(r.x + r.width, `${variant} right at ${cx},${cy}`).toBeLessThanOrEqual(w - inset)
            expect(r.y + r.height, `${variant} bottom at ${cx},${cy}`).toBeLessThanOrEqual(h - inset)
          }
        }
      }
    }
  })

  it('clamps the width to the same bounds as a cornered logo', () => {
    const tooWide = logoRectFree(1920, 1080, 0.5, 0.5, 0.9)
    const atMax = logoRectFree(1920, 1080, 0.5, 0.5, LOGO_MAX_WIDTH_FRAC)
    expect(tooWide.width).toBe(atMax.width)

    const tooNarrow = logoRectFree(1920, 1080, 0.5, 0.5, 0.001)
    const atMin = logoRectFree(1920, 1080, 0.5, 0.5, LOGO_MIN_WIDTH_FRAC)
    expect(tooNarrow.width).toBe(atMin.width)
  })

  it('returns whole pixels', () => {
    const r = logoRectFree(1055, 1491, 0.33, 0.67, 0.19)
    for (const value of [r.x, r.y, r.width, r.height]) {
      expect(Number.isInteger(value)).toBe(true)
    }
  })
})

describe('resolveLogoRect', () => {
  it('matches logoRect for a corner placement', () => {
    const viaUnion = resolveLogoRect(1920, 1080, {
      mode: 'corner',
      corner: 'bottom_right',
      widthFrac: 0.22,
    })
    expect(viaUnion).toEqual(logoRect(1920, 1080, 'bottom_right', 0.22))
  })

  it('matches logoRectFree for a free placement', () => {
    const viaUnion = resolveLogoRect(1920, 1080, {
      mode: 'free',
      centreXFrac: 0.4,
      centreYFrac: 0.6,
      widthFrac: 0.22,
    })
    expect(viaUnion).toEqual(logoRectFree(1920, 1080, 0.4, 0.6, 0.22))
  })

  it('lets a freely placed logo be rejected against a QR the same way a cornered one is', () => {
    const logo = resolveLogoRect(2480, 3508, {
      mode: 'free',
      centreXFrac: 0.5,
      centreYFrac: 0.5,
      widthFrac: 0.3,
    })
    const qr = qrRect(2480, 3508, 0.5, 0.5, 0.25)
    const verdict = validateQrPlacement(2480, 3508, qr, logo)
    expect(verdict.ok).toBe(false)
  })
})

describe('the QR minimum width floor agrees everywhere it is written down', () => {
  it('keeps the 40mm advisory rounded up, separate from the enforced floor', () => {
    expect(QR_ADVISORY_MIN_WIDTH_FRAC).toBe(0.1905)
    expect(QR_MIN_WIDTH_FRAC).toBe(0.12)
    expect(QR_MIN_WIDTH_FRAC_EXACT).toBeCloseTo(0.190476, 6)
    // The rounding direction is the safety property: the enforced floor must
    // never be below the exact ratio, or a code could print under 40mm.
    expect(QR_ADVISORY_MIN_WIDTH_FRAC).toBeGreaterThan(QR_MIN_WIDTH_FRAC_EXACT)
  })

  it('matches the database CHECK constraint in the branding migration', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../../supabase/migrations/20260906160000_qr_width_range.sql'),
      'utf8'
    )
    // If someone changes one and not the other, the smallest legal code either
    // fails validation or prints too small. Both are silent until it is printed.
    expect(sql).toContain(`qr_width_frac >= ${QR_MIN_WIDTH_FRAC}`)
    expect(sql).toContain(`qr_width_frac <= ${QR_MAX_WIDTH_FRAC}`)
  })

  it('a QR at the ADVISORY floor still clears 40mm on the A4 canvas', () => {
    const widthPx = qrRect(2480, 3508, 0.5, 0.5, QR_ADVISORY_MIN_WIDTH_FRAC).width
    const mm = (widthPx / 2480) * 210
    expect(mm).toBeGreaterThanOrEqual(40)
    expect(widthPx).toBeGreaterThanOrEqual(qrMinWidthPx(2480))
  })
})

describe('logo drop shadow', () => {
  it('shadows a white logo in black and a black logo in white', () => {
    expect(shadowColourFor('white')).toBe('#000000')
    expect(shadowColourFor('black')).toBe('#ffffff')
  })

  it('scales with the logo, not the canvas', () => {
    const small = logoShadowSpec(logoRect(1080, 1080, 'top_left', 0.08), 'white')
    const large = logoShadowSpec(logoRect(2480, 3508, 'top_left', 0.35), 'white')
    expect(large.offsetXPx).toBeGreaterThan(small.offsetXPx)
    expect(large.blurPx).toBeGreaterThan(small.blurPx)
  })

  it('never collapses to a zero offset or blur on a tiny logo', () => {
    const spec = logoShadowSpec({ x: 0, y: 0, width: 10, height: 5 }, 'black')
    expect(spec.offsetXPx).toBeGreaterThanOrEqual(1)
    expect(spec.blurPx).toBeGreaterThanOrEqual(1)
  })

  it('renders a CSS filter that doubles the sigma for the blur radius', () => {
    const spec = logoShadowSpec(logoRect(1920, 1080, 'top_left', 0.22), 'white')
    const css = cssDropShadow(spec)
    expect(css).toContain(`${spec.blurPx * 2}px`)
    expect(css).toContain('rgba(0, 0, 0,')
    expect(cssDropShadow(logoShadowSpec(logoRect(1920, 1080, 'top_left', 0.22), 'black')))
      .toContain('rgba(255, 255, 255,')
  })
})

describe('the BOOK NOW strip', () => {
  const CODE = qrRect(2480, 3508, 0.5, 0.5, 0.2)

  it('sits beside the code and never over it', () => {
    const strip = qrStripRect(CODE)
    expect(rectsOverlap(strip, CODE, 0)).toBe(false)
  })

  it('does not reduce the scannable code, so the 40mm rule still holds', () => {
    // qr_width_frac keeps meaning the CODE width. The block is simply wider.
    expect(CODE.width).toBeGreaterThanOrEqual(qrMinWidthPx(2480))
    expect(qrBlockRect(CODE).width).toBeGreaterThan(CODE.width)
  })

  it('makes the block exactly code plus strip, at the code height', () => {
    const strip = qrStripRect(CODE)
    const block = qrBlockRect(CODE)
    expect(block.width).toBe(CODE.width + strip.width)
    expect(block.height).toBe(CODE.height)
  })

  it('keeps the whole block on the canvas even when pushed into the edge', () => {
    for (const [cx, cy] of [[0, 0], [1, 1], [0, 1], [1, 0], [0.5, 0.5]] as const) {
      const code = qrCodeRectWithinCanvas(2480, 3508, cx, cy, 0.2)
      const block = qrBlockRect(code)
      const inset = insetPx(2480, 3508)
      expect(block.x, `block left at ${cx},${cy}`).toBeGreaterThanOrEqual(inset)
      expect(block.x + block.width, `block right at ${cx},${cy}`).toBeLessThanOrEqual(2480 - inset)
    }
  })

  it('rejects a placement whose STRIP falls off, not just the code', () => {
    // A code hard against the left edge is legal on its own; with a strip to its
    // left it is not, and that is the case this guard exists for.
    const code = qrRect(2480, 3508, 0, 0.5, 0.2)
    const verdict = validateQrPlacement(2480, 3508, code, null)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('expected a rejection')
    expect(verdict.reason).toContain('outside the poster')
  })
})

describe('snapFrac', () => {
  it('snaps onto the centre when close', () => {
    expect(snapFrac(0.49)).toEqual({ value: 0.5, snappedTo: 0.5 })
    expect(snapFrac(0.51)).toEqual({ value: 0.5, snappedTo: 0.5 })
  })

  it('leaves a deliberate off-centre placement alone', () => {
    expect(snapFrac(0.3)).toEqual({ value: 0.3, snappedTo: null })
    expect(snapFrac(0.8)).toEqual({ value: 0.8, snappedTo: null })
  })

  it('releases as soon as the drag passes the threshold', () => {
    const justInside = snapFrac(0.5 + SNAP_THRESHOLD_FRAC)
    const justOutside = snapFrac(0.5 + SNAP_THRESHOLD_FRAC + 0.001)
    expect(justInside.snappedTo).toBe(0.5)
    expect(justOutside.snappedTo).toBeNull()
    expect(justOutside.value).toBeCloseTo(0.521, 3)
  })

  it('reports which target it caught, so a guide can be drawn there', () => {
    expect(snapFrac(0.2, [0.2, 0.5, 0.8]).snappedTo).toBe(0.2)
    expect(snapFrac(0.79, [0.2, 0.5, 0.8]).snappedTo).toBe(0.8)
  })

  it('picks the nearest target when two are in range', () => {
    expect(snapFrac(0.51, [0.5, 0.53], 0.05).snappedTo).toBe(0.5)
  })
})
