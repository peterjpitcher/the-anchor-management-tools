// @vitest-environment node
/**
 * These tests run the real `sharp`, the real `qrcode` and the real logo files
 * that ship in `public/guest/`, on purpose.
 *
 * A mocked sharp would report whatever the mock was told to report. It would
 * say the logo landed in the top left when it landed in the bottom right, and
 * it would say `public/logo-black.png` had an alpha channel when it has three
 * channels and none. Those two are exactly the bugs this module exists to stop,
 * so every placement claim below is proved by reading pixels back out of the
 * composited PNG rather than by the call not throwing.
 *
 * No network: the QR codes encode a URL string but nothing fetches it.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  LOGO_SOURCES,
  compositeArtwork,
  loadLogoBuffer,
  logoShadowPaddingPx,
  qrStripSvg,
  renderQrAtWidth,
  type CompositeSpec,
  type LogoColour,
} from './composite'
import {
  logoRect,
  logoRectFree,
  logoShadowSpec,
  qrBlockRect,
  qrCodeRectWithinCanvas,
  qrMinWidthPx,
  qrStripRect,
  QR_STRIP_LABEL,
  type Corner,
  type Rect,
} from './geometry'
import { validateCompositeOutput } from './output'
import { EVENT_IMAGE_VARIANTS } from '@/lib/events/imageVariants'

const POSTER = EVENT_IMAGE_VARIANTS.print_poster
const SQUARE = EVENT_IMAGE_VARIANTS.square
const BOOKING_URL = 'https://www.the-anchor.pub/events/quiz-night'

/** A flat mid grey, so both the white and the black logo are visible against it. */
const BACKGROUND = { r: 128, g: 128, b: 128, alpha: 1 }

interface RawImage {
  data: Buffer
  width: number
  height: number
  channels: number
}

async function createSource(width: number, height: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  return sharp({ create: { width, height, channels: 4, background: BACKGROUND } })
    .png()
    .toBuffer()
}

async function decode(buffer: Buffer): Promise<RawImage> {
  const sharp = (await import('sharp')).default
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

function pixelAt(image: RawImage, x: number, y: number): number[] {
  const offset = (y * image.width + x) * image.channels
  return Array.from(image.data.subarray(offset, offset + image.channels))
}

/**
 * The bounding box of every pixel that differs from the flat background, plus
 * how many there are.
 *
 * This is the actual placement proof. The source is a single uniform colour, so
 * anything that is not that colour was drawn by the compositor, and where those
 * pixels are is where the compositor put it.
 */
function changedBounds(
  image: RawImage
): { count: number; minX: number; minY: number; maxX: number; maxY: number } {
  let count = 0
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const [r, g, b] = pixelAt(image, x, y)
      if (r !== BACKGROUND.r || g !== BACKGROUND.g || b !== BACKGROUND.b) {
        count += 1
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  return { count, minX, minY, maxX, maxY }
}

/** Mean brightness over a rectangle, used to tell the white logo from the black one. */
function meanBrightness(
  image: RawImage,
  rect: { x: number; y: number; width: number; height: number }
): number {
  let total = 0
  let seen = 0
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const [r, g, b] = pixelAt(image, x, y)
      total += (r + g + b) / 3
      seen += 1
    }
  }
  return seen === 0 ? 0 : total / seen
}

/**
 * The bounding box of the MARK alone, told apart from its own drop shadow by
 * colour rather than by position.
 *
 * The shadow is always the opposite of the mark, so over a mid grey background
 * only the mark can make a pixel lighter than the grey when it is white, and
 * only the mark can make one darker when it is black. That is what lets these
 * tests still prove the logo lands exactly on the rect `geometry.ts` computed,
 * which a plain changed-pixel box no longer can now that a blurred shadow spills
 * past every edge of it.
 */
function markBounds(
  image: RawImage,
  colour: LogoColour
): { count: number; minX: number; minY: number; maxX: number; maxY: number } {
  let count = 0
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const [r, g, b] = pixelAt(image, x, y)
      const mean = (r + g + b) / 3
      const isMark = colour === 'white' ? mean > BACKGROUND.r : mean < BACKGROUND.r
      if (!isMark) continue
      count += 1
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  return { count, minX, minY, maxX, maxY }
}

/**
 * How far outside its own rect the logo's shadow may legitimately paint, edge by
 * edge.
 *
 * Taken from `logoShadowSpec` and the compositor's own padding rather than from
 * numbers typed in here, so these bounds follow the shadow if it is ever
 * retuned. The shadow is pushed down and right, so it reaches `pad + offset`
 * that way and only `pad - offset` up and left. That asymmetry is asserted
 * directly further down.
 */
function shadowReach(
  logo: Rect,
  colour: LogoColour
): { left: number; top: number; right: number; bottom: number } {
  const spec = logoShadowSpec(logo, colour)
  const pad = logoShadowPaddingPx(spec)

  return {
    left: Math.max(0, pad - spec.offsetXPx),
    top: Math.max(0, pad - spec.offsetYPx),
    right: pad + spec.offsetXPx,
    bottom: pad + spec.offsetYPx,
  }
}

function unwrap(result: Awaited<ReturnType<typeof compositeArtwork>>): Buffer {
  if (!result.ok) {
    throw new Error(`Expected a composite, got ${result.failure.code}: ${result.failure.detail}`)
  }
  return result.buffer
}

describe('LOGO_SOURCES', () => {
  it('points only at the two files that actually have an alpha channel', async () => {
    const sharp = (await import('sharp')).default

    for (const colour of ['white', 'black'] as LogoColour[]) {
      expect(LOGO_SOURCES[colour]).toBe(`public/guest/anchor-logo-${colour}.png`)

      const metadata = await sharp(await loadLogoBuffer(colour)).metadata()
      expect(metadata.hasAlpha).toBe(true)
      expect(metadata.width).toBe(934)
      expect(metadata.height).toBe(421)
    }
  })

  it('does not point at public/logo-black.png, which has no alpha', async () => {
    const sharp = (await import('sharp')).default
    const metadata = await sharp(path.resolve(process.cwd(), 'public/logo-black.png')).metadata()

    // If this ever starts reporting an alpha channel the guard in composite.ts
    // still holds, but the reason for excluding this file has changed.
    expect(metadata.hasAlpha).toBe(false)
    expect(Object.values(LOGO_SOURCES)).not.toContain('public/logo-black.png')
  })
})

describe('compositeArtwork, logo placement', () => {
  const CORNERS: Corner[] = ['top_left', 'top_right', 'bottom_left', 'bottom_right']

  // Free placement exists because plenty of artwork leaves no usable corner.
  // Same pixel-level proof as the corner cases: the only thing that may differ
  // from the untouched background is what geometry.ts said would be painted.
  it.each([
    [0.5, 0.5],
    [0.2, 0.8],
    [0.0, 0.0],
    [1.0, 1.0],
  ])('draws a freely placed logo exactly where logoRectFree says, at %s,%s', async (cx, cy) => {
    const widthFrac = 0.22
    const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)

    const buffer = unwrap(
      await compositeArtwork(source, {
        variant: 'square',
        logo: {
          placement: { mode: 'free', centreXFrac: cx, centreYFrac: cy, widthFrac },
          colour: 'white',
        },
        qr: null,
      })
    )

    const image = await decode(buffer)
    const expected = logoRectFree(
      SQUARE.targetWidth,
      SQUARE.targetHeight,
      cx,
      cy,
      widthFrac
    )
    // The mark itself, shadow excluded, fills exactly the rect geometry gave.
    const mark = markBounds(image, 'white')
    expect(mark.count).toBeGreaterThan(0)
    expect(mark.minX).toBe(expected.x)
    expect(mark.minY).toBe(expected.y)
    expect(mark.maxX).toBe(expected.x + expected.width - 1)
    expect(mark.maxY).toBe(expected.y + expected.height - 1)

    // Everything painted, shadow included, stays inside the shadow's reach.
    const reach = shadowReach(expected, 'white')
    const bounds = changedBounds(image)
    expect(bounds.minX).toBeGreaterThanOrEqual(expected.x - reach.left)
    expect(bounds.minY).toBeGreaterThanOrEqual(expected.y - reach.top)
    expect(bounds.maxX).toBeLessThanOrEqual(expected.x + expected.width - 1 + reach.right)
    expect(bounds.maxY).toBeLessThanOrEqual(expected.y + expected.height - 1 + reach.bottom)
  })

  it('places a centred logo somewhere a corner never could', async () => {
    const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)
    const centred = logoRectFree(SQUARE.targetWidth, SQUARE.targetHeight, 0.5, 0.5, 0.22)
    for (const corner of CORNERS) {
      const cornered = logoRect(SQUARE.targetWidth, SQUARE.targetHeight, corner, 0.22)
      expect(centred).not.toEqual(cornered)
    }
    // And it really composites, rather than only computing a rect.
    const buffer = unwrap(
      await compositeArtwork(source, {
        variant: 'square',
        logo: {
          placement: { mode: 'free', centreXFrac: 0.5, centreYFrac: 0.5, widthFrac: 0.22 },
          colour: 'white',
        },
        qr: null,
      })
    )
    expect(changedBounds(await decode(buffer)).count).toBeGreaterThan(0)
  })

  it.each(CORNERS)('draws the logo exactly where logoRect says for %s', async (corner) => {
    const widthFrac = 0.22
    const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)

    const buffer = unwrap(
      await compositeArtwork(source, {
        variant: 'square',
        logo: { placement: { mode: 'corner', corner, widthFrac }, colour: 'white' },
        qr: null,
      })
    )

    const image = await decode(buffer)
    const expected = logoRect(SQUARE.targetWidth, SQUARE.targetHeight, corner, widthFrac)

    // The mark was drawn exactly on the rect geometry.ts specified, and filled
    // it rather than landing as a speck inside it. The logo's own artwork
    // reaches all four edges of its 934x421 canvas, so these are equalities.
    // The shadow is excluded by colour, not by position, so this is still the
    // placement proof it always was.
    const mark = markBounds(image, 'white')
    expect(mark.count).toBeGreaterThan(0)
    expect(mark.minX).toBe(expected.x)
    expect(mark.minY).toBe(expected.y)
    expect(mark.maxX).toBe(expected.x + expected.width - 1)
    expect(mark.maxY).toBe(expected.y + expected.height - 1)

    // Nothing at all was painted beyond the shadow's own reach past that rect.
    const reach = shadowReach(expected, 'white')
    const bounds = changedBounds(image)
    expect(bounds.minX).toBeGreaterThanOrEqual(expected.x - reach.left)
    expect(bounds.minY).toBeGreaterThanOrEqual(expected.y - reach.top)
    expect(bounds.maxX).toBeLessThanOrEqual(expected.x + expected.width - 1 + reach.right)
    expect(bounds.maxY).toBeLessThanOrEqual(expected.y + expected.height - 1 + reach.bottom)

    // The other three corners are untouched: the inset margin at the opposite
    // corner is still exactly the background colour.
    const opposite: Record<Corner, [number, number]> = {
      top_left: [SQUARE.targetWidth - 1, SQUARE.targetHeight - 1],
      top_right: [0, SQUARE.targetHeight - 1],
      bottom_left: [SQUARE.targetWidth - 1, 0],
      bottom_right: [0, 0],
    }
    const [ox, oy] = opposite[corner]
    expect(pixelAt(image, ox, oy).slice(0, 3)).toEqual([BACKGROUND.r, BACKGROUND.g, BACKGROUND.b])
  })

  it('honours the width fraction rather than a fixed size', async () => {
    const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)

    const narrow = await decode(
      unwrap(
        await compositeArtwork(source, {
          variant: 'square',
          logo: { placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.12  }, colour: 'white' },
          qr: null,
        })
      )
    )
    const wide = await decode(
      unwrap(
        await compositeArtwork(source, {
          variant: 'square',
          logo: { placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.32  }, colour: 'white' },
          qr: null,
        })
      )
    )

    const narrowMark = markBounds(narrow, 'white')
    const wideMark = markBounds(wide, 'white')
    const narrowExpected = logoRect(SQUARE.targetWidth, SQUARE.targetHeight, 'top_left', 0.12)
    const wideExpected = logoRect(SQUARE.targetWidth, SQUARE.targetHeight, 'top_left', 0.32)

    // Measured on the mark, so the shadow cannot inflate either width.
    expect(narrowMark.maxX - narrowMark.minX + 1).toBeLessThanOrEqual(narrowExpected.width)
    expect(wideMark.maxX - wideMark.minX + 1).toBeLessThanOrEqual(wideExpected.width)
    expect(wideMark.maxX).toBeGreaterThan(narrowMark.maxX)

    // The shadow scales with the mark rather than staying a fixed size, so the
    // wider logo also paints further past its own rect than the narrow one.
    expect(shadowReach(wideExpected, 'white').right).toBeGreaterThan(
      shadowReach(narrowExpected, 'white').right
    )
  })

  it('produces visibly different output for the white and the black logo', async () => {
    const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)
    const spec = (colour: LogoColour): CompositeSpec => ({
      variant: 'square',
      logo: { placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.24 }, colour },
      qr: null,
    })

    const white = unwrap(await compositeArtwork(source, spec('white')))
    const black = unwrap(await compositeArtwork(source, spec('black')))

    expect(white.equals(black)).toBe(false)

    const rect = logoRect(SQUARE.targetWidth, SQUARE.targetHeight, 'top_left', 0.24)
    const whiteMean = meanBrightness(await decode(white), rect)
    const blackMean = meanBrightness(await decode(black), rect)

    // Both are drawn over the same mid grey, so the white mark must lift the
    // mean and the black mark must drop it.
    expect(whiteMean).toBeGreaterThan(BACKGROUND.r)
    expect(blackMean).toBeLessThan(BACKGROUND.r)
  })

  it('produces artwork with no logo when logo is null, without failing', async () => {
    const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)

    const result = await compositeArtwork(source, { variant: 'square', logo: null, qr: null })
    expect(result.ok).toBe(true)

    const bounds = changedBounds(await decode(unwrap(result)))
    expect(bounds.count).toBe(0)
  })
})

describe('compositeArtwork, logo failures are visible', () => {
  it('fails with logo_asset_missing and returns no buffer when the file is not there', async () => {
    const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)

    const result = await compositeArtwork(
      source,
      {
        variant: 'square',
        logo: { placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.22  }, colour: 'white' },
        qr: null,
      },
      {
        logoSources: {
          white: 'public/guest/this-logo-does-not-exist.png',
          black: 'public/guest/this-logo-does-not-exist.png',
        },
      }
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.failure.code).toBe('logo_asset_missing')
    expect(result).not.toHaveProperty('buffer')
  })

  it('fails with logo_asset_invalid when the logo source has no alpha channel', async () => {
    const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)

    const result = await compositeArtwork(
      source,
      {
        variant: 'square',
        logo: { placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.22  }, colour: 'black' },
        qr: null,
      },
      // The real file someone would reach for by name. It is 400x180 with three
      // channels, and compositing it would stamp an opaque white box.
      { logoSources: { white: 'public/logo-black.png', black: 'public/logo-black.png' } }
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.failure.code).toBe('logo_asset_invalid')
    expect(result.failure.detail).toContain('alpha')
    expect(result).not.toHaveProperty('buffer')
  })

  it('fails rather than quietly dropping the logo when the file is unreadable rubbish', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'composite-logo-'))
    const rubbish = path.join(directory, 'not-an-image.png')
    fs.writeFileSync(rubbish, 'this is not a png')

    try {
      const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)
      const result = await compositeArtwork(
        source,
        {
          variant: 'square',
          logo: { placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.22  }, colour: 'white' },
          qr: null,
        },
        { logoSources: { white: rubbish, black: rubbish } }
      )

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.failure.code).toBe('logo_asset_invalid')
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('renderQrAtWidth', () => {
  it('renders at exactly the requested width, never resampled from 1200', async () => {
    const sharp = (await import('sharp')).default

    for (const width of [106, 248, 473, 620, 900]) {
      const metadata = await sharp(await renderQrAtWidth(BOOKING_URL, width)).metadata()
      expect(metadata.width).toBe(width)
      expect(metadata.height).toBe(width)
    }
  })

  it('keeps the quiet zone as an opaque white plate', async () => {
    const image = await decode(await renderQrAtWidth(BOOKING_URL, 600))

    // Every corner of the code is inside the 4 module quiet zone.
    for (const [x, y] of [
      [0, 0],
      [image.width - 1, 0],
      [0, image.height - 1],
      [image.width - 1, image.height - 1],
    ]) {
      expect(pixelAt(image, x, y)).toEqual([255, 255, 255, 255])
    }
  })

  it('rejects a width that is not a positive whole number', async () => {
    await expect(renderQrAtWidth(BOOKING_URL, 0)).rejects.toThrow(/positive whole number/)
    await expect(renderQrAtWidth(BOOKING_URL, 12.5)).rejects.toThrow(/positive whole number/)
  })
})

describe('compositeArtwork, QR code on the poster', () => {
  const posterSpec = (overrides: Partial<CompositeSpec> = {}): CompositeSpec => ({
    variant: 'print_poster',
    logo: { placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.22  }, colour: 'white' },
    qr: { centreXFrac: 0.5, centreYFrac: 0.82, widthFrac: 0.25, url: BOOKING_URL },
    ...overrides,
  })

  it('lands the QR where the geometry says, with its quiet zone plate intact', async () => {
    const source = await createSource(POSTER.targetWidth, POSTER.targetHeight)
    const spec = posterSpec()
    const image = await decode(unwrap(await compositeArtwork(source, spec)))

    if (!spec.qr) throw new Error('unreachable')
    const expected = qrCodeRectWithinCanvas(
      POSTER.targetWidth,
      POSTER.targetHeight,
      spec.qr.centreXFrac,
      spec.qr.centreYFrac,
      spec.qr.widthFrac
    )

    // The four corners of the placed rect are the quiet zone, so all four must
    // be opaque white. If anything had trimmed or alpha keyed the plate these
    // would read back as the mid grey background.
    expect(pixelAt(image, expected.x, expected.y)).toEqual([255, 255, 255, 255])
    expect(pixelAt(image, expected.x + expected.width - 1, expected.y)).toEqual([255, 255, 255, 255])
    expect(pixelAt(image, expected.x, expected.y + expected.height - 1)).toEqual([255, 255, 255, 255])
    expect(
      pixelAt(image, expected.x + expected.width - 1, expected.y + expected.height - 1)
    ).toEqual([255, 255, 255, 255])

    // Just above the rect is still untouched background, which pins the edge.
    // Left of it is the BOOK NOW strip, not background, so the pin is taken
    // from the row above the block rather than from the corner beside it.
    expect(pixelAt(image, expected.x, expected.y - 1).slice(0, 3)).toEqual([
      BACKGROUND.r,
      BACKGROUND.g,
      BACKGROUND.b,
    ])

    // And there are real dark modules inside it, so it is a code and not a plate.
    expect(meanBrightness(image, expected)).toBeLessThan(250)
  })

  it('rejects a QR that overlaps the logo', async () => {
    const source = await createSource(POSTER.targetWidth, POSTER.targetHeight)

    const result = await compositeArtwork(
      source,
      posterSpec({
        // Same corner as the logo.
        qr: { centreXFrac: 0.12, centreYFrac: 0.06, widthFrac: 0.25, url: BOOKING_URL },
      })
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.failure.code).toBe('placement_invalid')
    expect(result.failure.detail).toContain('logo')
  })

  it('rejects a QR under the 10% width minimum', async () => {
    const source = await createSource(POSTER.targetWidth, POSTER.targetHeight)
    const minimum = qrMinWidthPx(POSTER.targetWidth)

    const result = await compositeArtwork(
      source,
      posterSpec({
        qr: { centreXFrac: 0.5, centreYFrac: 0.82, widthFrac: 0.09, url: BOOKING_URL },
      })
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.failure.code).toBe('placement_invalid')
    expect(result.failure.detail).toContain(String(minimum))

    // The same placement one pixel over the minimum is accepted, so the
    // rejection is the size rule and not something else about the position.
    const justOver = await compositeArtwork(
      source,
      posterSpec({
        qr: {
          centreXFrac: 0.5,
          centreYFrac: 0.82,
          widthFrac: (minimum + 1) / POSTER.targetWidth,
          url: BOOKING_URL,
        },
      })
    )
    expect(justOver.ok).toBe(true)
  })

  it('places a QR with no logo at all', async () => {
    const source = await createSource(POSTER.targetWidth, POSTER.targetHeight)
    const result = await compositeArtwork(source, posterSpec({ logo: null }))
    expect(result.ok).toBe(true)
  })
})

describe('compositeArtwork, output contract', () => {
  it('preserves 300dpi density on the poster and sets none on the screen variants', async () => {
    const sharp = (await import('sharp')).default

    const poster = unwrap(
      await compositeArtwork(await createSource(POSTER.targetWidth, POSTER.targetHeight), {
        variant: 'print_poster',
        logo: { placement: { mode: 'corner', corner: 'bottom_right', widthFrac: 0.22  }, colour: 'white' },
        qr: { centreXFrac: 0.5, centreYFrac: 0.5, widthFrac: 0.25, url: BOOKING_URL },
      })
    )
    const posterMeta = await sharp(poster).metadata()
    expect(posterMeta.density).toBe(300)
    expect(posterMeta.format).toBe('png')
    expect(posterMeta.width).toBe(POSTER.targetWidth)
    expect(posterMeta.height).toBe(POSTER.targetHeight)

    const square = unwrap(
      await compositeArtwork(await createSource(SQUARE.targetWidth, SQUARE.targetHeight), {
        variant: 'square',
        logo: { placement: { mode: 'corner', corner: 'bottom_right', widthFrac: 0.22  }, colour: 'white' },
        qr: null,
      })
    )
    expect((await sharp(square).metadata()).density).not.toBe(300)
  })

  it('is deterministic: the same source and spec give byte-identical output', async () => {
    const source = await createSource(POSTER.targetWidth, POSTER.targetHeight)
    const spec: CompositeSpec = {
      variant: 'print_poster',
      logo: { placement: { mode: 'corner', corner: 'top_right', widthFrac: 0.27  }, colour: 'black' },
      qr: { centreXFrac: 0.5, centreYFrac: 0.8, widthFrac: 0.22, url: BOOKING_URL },
    }

    const first = unwrap(await compositeArtwork(source, spec))
    const second = unwrap(await compositeArtwork(source, spec))

    expect(first.equals(second)).toBe(true)
  })

  it('fails with source_invalid on artwork it cannot decode', async () => {
    const result = await compositeArtwork(Buffer.from('not an image at all'), {
      variant: 'square',
      logo: { placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.22  }, colour: 'white' },
      qr: null,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.failure.code).toBe('source_invalid')
  })
})

describe('compositeArtwork, the logo drop shadow', () => {
  const CORNER: Corner = 'top_left'
  const WIDTH_FRAC = 0.22
  const RECT = logoRect(SQUARE.targetWidth, SQUARE.targetHeight, CORNER, WIDTH_FRAC)

  async function shadowed(colour: LogoColour): Promise<RawImage> {
    const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)
    return decode(
      unwrap(
        await compositeArtwork(source, {
          variant: 'square',
          logo: { placement: { mode: 'corner', corner: CORNER, widthFrac: WIDTH_FRAC }, colour },
          qr: null,
        })
      )
    )
  }

  /** Every painted pixel outside the logo's own rect, split by which way it moved. */
  function outsideTheRect(
    image: RawImage,
    rect: Rect
  ): { towardsShadow: number; awayFromShadow: number; strongest: number } {
    let towardsShadow = 0
    let awayFromShadow = 0
    let strongest = 0

    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const inside =
          x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
        if (inside) continue

        const [r, g, b] = pixelAt(image, x, y)
        const delta = (r + g + b) / 3 - BACKGROUND.r
        if (delta === 0) continue
        if (delta < 0) {
          towardsShadow += 1
        } else {
          awayFromShadow += 1
        }
        strongest = Math.max(strongest, Math.abs(delta))
      }
    }

    return { towardsShadow, awayFromShadow, strongest }
  }

  it('paints a BLACK shadow outside a white logo and a WHITE one outside a black logo', async () => {
    // The logo overlay is exactly its own rect, so anything painted outside it
    // is the shadow and nothing else. Over a mid grey background a black shadow
    // can only darken and a white one can only lighten, so counting which way
    // each pixel moved is a direct proof of the shadow's colour.
    const white = outsideTheRect(await shadowed('white'), RECT)
    expect(white.towardsShadow).toBeGreaterThan(0)
    expect(white.awayFromShadow).toBe(0)
    expect(white.strongest).toBeGreaterThan(4)

    const black = await shadowed('black')
    let lighter = 0
    let darker = 0
    for (let y = 0; y < black.height; y += 1) {
      for (let x = 0; x < black.width; x += 1) {
        const inside =
          x >= RECT.x && x < RECT.x + RECT.width && y >= RECT.y && y < RECT.y + RECT.height
        if (inside) continue
        const [r, g, b] = pixelAt(black, x, y)
        const delta = (r + g + b) / 3 - BACKGROUND.r
        if (delta > 0) lighter += 1
        if (delta < 0) darker += 1
      }
    }
    expect(lighter).toBeGreaterThan(0)
    expect(darker).toBe(0)
  })

  it('rescues a white logo on white artwork, which is the whole point of it', async () => {
    const sharp = (await import('sharp')).default
    const white = { r: 255, g: 255, b: 255, alpha: 1 }
    const source = await sharp({
      create: {
        width: SQUARE.targetWidth,
        height: SQUARE.targetHeight,
        channels: 4,
        background: white,
      },
    })
      .png()
      .toBuffer()

    const image = await decode(
      unwrap(
        await compositeArtwork(source, {
          variant: 'square',
          logo: {
            placement: { mode: 'corner', corner: CORNER, widthFrac: WIDTH_FRAC },
            colour: 'white',
          },
          qr: null,
        })
      )
    )

    // Without a shadow a white logo on white artwork paints nothing a reader
    // could see. Count how much of it is now visible, and how strongly.
    let visible = 0
    let strongest = 0
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const [r] = pixelAt(image, x, y)
        const delta = white.r - r
        if (delta <= 0) continue
        visible += 1
        strongest = Math.max(strongest, delta)
      }
    }

    expect(visible).toBeGreaterThan(RECT.width * RECT.height * 0.5)
    expect(strongest).toBeGreaterThan(40)
  })

  it('offsets the shadow down and right, not up and left', async () => {
    const image = await shadowed('white')
    const bounds = changedBounds(image)

    const overhangLeft = RECT.x - bounds.minX
    const overhangTop = RECT.y - bounds.minY
    const overhangRight = bounds.maxX - (RECT.x + RECT.width - 1)
    const overhangBottom = bounds.maxY - (RECT.y + RECT.height - 1)

    expect(overhangRight).toBeGreaterThan(overhangLeft)
    expect(overhangBottom).toBeGreaterThan(overhangTop)
    expect(overhangRight).toBeGreaterThan(0)
    expect(overhangBottom).toBeGreaterThan(0)
  })

  it.each(['top_left', 'top_right', 'bottom_left', 'bottom_right'] as Corner[])(
    'keeps a full width logo at %s inside the canvas, at the same size it started',
    async (corner) => {
      // The widest logo the geometry permits, in every corner, because branding
      // must never resize the artwork whatever the shadow does at the edge.
      const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)

      const buffer = unwrap(
        await compositeArtwork(source, {
          variant: 'square',
          logo: { placement: { mode: 'corner', corner, widthFrac: 0.35 }, colour: 'white' },
          qr: null,
        })
      )

      const image = await decode(buffer)
      expect(image.width).toBe(SQUARE.targetWidth)
      expect(image.height).toBe(SQUARE.targetHeight)

      const validation = await validateCompositeOutput(buffer, 'square', {
        width: SQUARE.targetWidth,
        height: SQUARE.targetHeight,
      })
      expect(validation.ok).toBe(true)

      // Nothing escaped: the painted box is still inside the canvas.
      const bounds = changedBounds(image)
      expect(bounds.minX).toBeGreaterThanOrEqual(0)
      expect(bounds.minY).toBeGreaterThanOrEqual(0)
      expect(bounds.maxX).toBeLessThanOrEqual(SQUARE.targetWidth - 1)
      expect(bounds.maxY).toBeLessThanOrEqual(SQUARE.targetHeight - 1)
    }
  )

  it('cuts the shadow at the canvas edge instead of letting it off', async () => {
    // The bottom right corner at the widest permitted logo is where the shadow
    // genuinely overruns: its reach past the mark is larger than the inset
    // margin left below and beside it. That is the case the clipping exists for,
    // and this asserts it is really being exercised rather than assumed.
    const rect = logoRect(SQUARE.targetWidth, SQUARE.targetHeight, 'bottom_right', 0.35)
    const reach = shadowReach(rect, 'white')
    expect(rect.x + rect.width - 1 + reach.right).toBeGreaterThan(SQUARE.targetWidth - 1)
    expect(rect.y + rect.height - 1 + reach.bottom).toBeGreaterThan(SQUARE.targetHeight - 1)

    const source = await createSource(SQUARE.targetWidth, SQUARE.targetHeight)
    const buffer = unwrap(
      await compositeArtwork(source, {
        variant: 'square',
        logo: {
          placement: { mode: 'corner', corner: 'bottom_right', widthFrac: 0.35 },
          colour: 'white',
        },
        qr: null,
      })
    )

    const image = await decode(buffer)
    expect(image.width).toBe(SQUARE.targetWidth)
    expect(image.height).toBe(SQUARE.targetHeight)
  })
})

describe('compositeArtwork, the BOOK NOW strip', () => {
  const CENTRE_X = 0.5
  const CENTRE_Y = 0.82
  const WIDTH_FRAC = 0.25

  const CODE = qrCodeRectWithinCanvas(
    POSTER.targetWidth,
    POSTER.targetHeight,
    CENTRE_X,
    CENTRE_Y,
    WIDTH_FRAC
  )
  const STRIP = qrStripRect(CODE)

  async function poster(
    qr: CompositeSpec['qr'] = {
      centreXFrac: CENTRE_X,
      centreYFrac: CENTRE_Y,
      widthFrac: WIDTH_FRAC,
      url: BOOKING_URL,
    }
  ): Promise<RawImage> {
    const source = await createSource(POSTER.targetWidth, POSTER.targetHeight)
    return decode(
      unwrap(
        await compositeArtwork(source, {
          variant: 'print_poster',
          logo: {
            placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.22 },
            colour: 'white',
          },
          qr,
        })
      )
    )
  }

  it('leaves every module of the code untouched', async () => {
    // The strongest possible statement of "the strip does not overlap the code":
    // the composited code region is compared pixel for pixel against the code
    // rendered on its own, with no strip anywhere near it. A strip that took out
    // even one column of modules would show up here immediately.
    const image = await poster()
    const bare = await decode(await renderQrAtWidth(BOOKING_URL, CODE.width))

    expect(bare.width).toBe(CODE.width)
    expect(bare.height).toBe(CODE.height)

    let differing = 0
    for (let y = 0; y < CODE.height; y += 1) {
      for (let x = 0; x < CODE.width; x += 1) {
        const placed = pixelAt(image, CODE.x + x, CODE.y + y).slice(0, 3)
        const alone = pixelAt(bare, x, y).slice(0, 3)
        if (placed.join() !== alone.join()) differing += 1
      }
    }

    expect(differing).toBe(0)
  })

  it('draws the strip beside the code, never over it', () => {
    expect(STRIP.width).toBeGreaterThan(0)
    expect(STRIP.height).toBe(CODE.height)
    expect(STRIP.y).toBe(CODE.y)
    // Left of the code, ending exactly where the code begins.
    expect(STRIP.x + STRIP.width).toBe(CODE.x)
  })

  it('paints a black strip carrying light lettering', async () => {
    const image = await poster()

    let dark = 0
    let light = 0
    let lightMinX = Number.POSITIVE_INFINITY
    let lightMinY = Number.POSITIVE_INFINITY
    let lightMaxX = -1
    let lightMaxY = -1

    for (let y = STRIP.y; y < STRIP.y + STRIP.height; y += 1) {
      for (let x = STRIP.x; x < STRIP.x + STRIP.width; x += 1) {
        const [r, g, b] = pixelAt(image, x, y)
        const mean = (r + g + b) / 3
        if (mean < 40) dark += 1
        if (mean > 200) {
          light += 1
          if (x < lightMinX) lightMinX = x
          if (x > lightMaxX) lightMaxX = x
          if (y < lightMinY) lightMinY = y
          if (y > lightMaxY) lightMaxY = y
        }
      }
    }

    const area = STRIP.width * STRIP.height
    // Mostly black plate, with real lettering on it. The glyphs cannot be read
    // back, so this asserts coverage: enough light pixels to be a word rather
    // than a stray mark, and far fewer of them than there is plate.
    expect(dark / area).toBeGreaterThan(0.5)
    expect(light / area).toBeGreaterThan(0.02)
    expect(light).toBeLessThan(dark)

    // And that lettering sits inside the strip rather than spilling over the
    // code beside it.
    expect(lightMinX).toBeGreaterThanOrEqual(STRIP.x)
    expect(lightMaxX).toBeLessThan(STRIP.x + STRIP.width)
    expect(lightMinY).toBeGreaterThanOrEqual(STRIP.y)
    expect(lightMaxY).toBeLessThan(STRIP.y + STRIP.height)

    // The label runs the long way down the strip, which is what tells a reader
    // it belongs to the code beside it.
    expect(lightMaxY - lightMinY).toBeGreaterThan(lightMaxX - lightMinX)
  })

  it('keeps the whole block on the canvas when the code is pushed hard against an edge', async () => {
    // A centre fraction of 0 parks the code against the left margin. The strip
    // sits on that side, so placing the code alone would hang it off the canvas.
    const code = qrCodeRectWithinCanvas(POSTER.targetWidth, POSTER.targetHeight, 0, 0.5, 0.1905)
    const block = qrBlockRect(code)

    expect(block.x).toBeGreaterThanOrEqual(0)
    expect(block.x + block.width).toBeLessThanOrEqual(POSTER.targetWidth)
    expect(block.y).toBeGreaterThanOrEqual(0)
    expect(block.y + block.height).toBeLessThanOrEqual(POSTER.targetHeight)

    const image = await poster({
      centreXFrac: 0,
      centreYFrac: 0.5,
      widthFrac: 0.1905,
      url: BOOKING_URL,
    })
    expect(image.width).toBe(POSTER.targetWidth)
    expect(image.height).toBe(POSTER.targetHeight)

    // The strip really is drawn there, hard against the margin.
    const strip = qrStripRect(code)
    const middle = pixelAt(image, strip.x + Math.floor(strip.width / 2), strip.y + 4)
    expect((middle[0] + middle[1] + middle[2]) / 3).toBeLessThan(40)
  })

  it('uses font-independent outlines and takes its label from geometry.ts', () => {
    const svg = qrStripSvg(STRIP).toString('utf8')

    expect(svg).toContain(QR_STRIP_LABEL)
    // Serverless runtimes can have no fonts at all.
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('font-family')
    expect(svg.match(/<path /g)).toHaveLength(7)
    // Reads bottom to top, the usual convention for a vertical label.
    expect(svg).toContain('rotate(-90')
    // Sized to the rect geometry.ts computed, so the rasterised strip lands
    // exactly where the block says it does.
    expect(svg).toContain(`width="${STRIP.width}"`)
    expect(svg).toContain(`height="${STRIP.height}"`)
  })

  it.each([0.1, 0.25])('renders seven distinct letters, not missing-font boxes, at %s width', async (widthFrac) => {
    const sharp = (await import('sharp')).default
    const code = qrCodeRectWithinCanvas(POSTER.targetWidth, POSTER.targetHeight, 0.5, 0.5, widthFrac)
    const strip = qrStripRect(code)
    // Rotate the real raster back to a horizontal word to separate its glyphs.
    const image = await decode(await sharp(qrStripSvg(strip)).rotate(90).png().toBuffer())
    const letterWidths: number[] = []
    let currentWidth = 0
    for (let x = 0; x < image.width; x += 1) {
      let hasInk = false
      for (let y = 0; y < image.height; y += 1) {
        if (pixelAt(image, x, y)[0] > 200) hasInk = true
      }
      if (hasInk) currentWidth += 1
      else if (currentWidth > 0) {
        letterWidths.push(currentWidth)
        currentWidth = 0
      }
    }
    if (currentWidth > 0) letterWidths.push(currentWidth)

    expect(letterWidths).toHaveLength(7)
    // Missing-glyph squares previously passed a white-pixel coverage check.
    // A real W is substantially wider than an O; identical boxes cannot pass.
    expect(letterWidths[6]).toBeGreaterThan(letterWidths[1] * 1.25)
    expect(Math.abs(letterWidths[1] - letterWidths[2])).toBeLessThanOrEqual(1)
    expect(Math.abs(letterWidths[1] - letterWidths[5])).toBeLessThanOrEqual(1)
  })

  it('rasterises the strip at exactly the rect size, with a legible label', async () => {
    const sharp = (await import('sharp')).default
    const rendered = await sharp(qrStripSvg(STRIP)).png().toBuffer()
    const metadata = await sharp(rendered).metadata()

    expect(metadata.width).toBe(STRIP.width)
    expect(metadata.height).toBe(STRIP.height)

    // At the 10% width minimum on A4 the strip is narrower than this one, so
    // check the label is still worth printing there too.
    const smallest = qrStripRect({
      x: 0,
      y: 0,
      width: qrMinWidthPx(POSTER.targetWidth),
      height: qrMinWidthPx(POSTER.targetWidth),
    })
    const small = await sharp(qrStripSvg(smallest)).png().toBuffer()
    const image = await decode(small)

    let light = 0
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const [r, g, b] = pixelAt(image, x, y)
        if ((r + g + b) / 3 > 200) light += 1
      }
    }
    expect(light / (image.width * image.height)).toBeGreaterThan(0.02)
  })
})

describe('composite.ts implementation guarantees', () => {
  let sourceText = ''

  beforeAll(() => {
    sourceText = fs.readFileSync(path.join(__dirname, 'composite.ts'), 'utf8')
  })

  afterAll(() => {
    sourceText = ''
  })

  it('uses sharp composite rather than hand rolled pixel work', () => {
    expect(sourceText).toContain('.composite(')
  })

  it('imports sharp dynamically and never statically', () => {
    expect(sourceText).toContain("await import('sharp')")
    expect(sourceText).not.toMatch(/^import .*from 'sharp'/m)
  })

  it('takes its geometry from geometry.ts instead of reimplementing it', () => {
    expect(sourceText).toMatch(/from '\.\/geometry'/)
    // Either the direct corner helper or the union resolver; both live in geometry.ts.
    expect(sourceText).toMatch(/\b(logoRect|resolveLogoRect)\(/)
    // The block-aware placement, not the bare code rect: the strip has to fit
    // on the canvas too.
    expect(sourceText).toContain('qrCodeRectWithinCanvas(')
    expect(sourceText).toContain('qrStripRect(')
    expect(sourceText).toContain('logoShadowSpec(')
    expect(sourceText).toContain('validateQrPlacement(')

    // The shadow measurements and the strip's label belong to geometry.ts and
    // are imported, never retyped here. The preview reads the same numbers, and
    // two copies would drift within a release.
    expect(sourceText).toContain('QR_STRIP_LABEL')
    expect(sourceText).not.toContain("'BOOK NOW'")
    expect(sourceText).not.toContain('0.025')
    expect(sourceText).not.toContain('0.035')
    expect(sourceText).not.toContain('0.22')

    // The numbers geometry.ts owns must not appear here at all: the inset
    // fraction, the logo aspect ratio, the 10% minimum and the A4 width.
    expect(sourceText).not.toContain('0.04')
    expect(sourceText).not.toContain('934 / 421')
    expect(sourceText).not.toContain('/ 210')
  })

  it('does not resample the QR down from the 1200px pack width', () => {
    // The 1200px pack width is never imported, so there is nothing to
    // downsample from, and the width handed to the renderer is the target one.
    expect(sourceText).not.toMatch(/import\s*\{[^}]*QR_PNG_WIDTH/)
    expect(sourceText).toContain('width: widthPx')
  })
})
