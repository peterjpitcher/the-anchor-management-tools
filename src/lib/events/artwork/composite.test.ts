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
  renderQrAtWidth,
  type CompositeSpec,
  type LogoColour,
} from './composite'
import { logoRect, logoRectFree, qrRect, qrMinWidthPx, type Corner } from './geometry'
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
    const bounds = changedBounds(image)

    expect(bounds.count).toBeGreaterThan(0)
    expect(bounds.minX).toBeGreaterThanOrEqual(expected.x)
    expect(bounds.minY).toBeGreaterThanOrEqual(expected.y)
    expect(bounds.maxX).toBeLessThanOrEqual(expected.x + expected.width - 1)
    expect(bounds.maxY).toBeLessThanOrEqual(expected.y + expected.height - 1)
    expect(bounds.minX - expected.x).toBeLessThanOrEqual(2)
    expect(bounds.minY - expected.y).toBeLessThanOrEqual(2)
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
    const bounds = changedBounds(image)

    expect(bounds.count).toBeGreaterThan(0)

    // Nothing was drawn outside the rect geometry.ts specified.
    expect(bounds.minX).toBeGreaterThanOrEqual(expected.x)
    expect(bounds.minY).toBeGreaterThanOrEqual(expected.y)
    expect(bounds.maxX).toBeLessThanOrEqual(expected.x + expected.width - 1)
    expect(bounds.maxY).toBeLessThanOrEqual(expected.y + expected.height - 1)

    // And it filled that rect rather than landing as a speck inside it. The
    // logo's own artwork reaches all four edges of its 934x421 canvas, so the
    // painted bounds should sit within a pixel or two of the rect's edges.
    expect(bounds.minX - expected.x).toBeLessThanOrEqual(2)
    expect(bounds.minY - expected.y).toBeLessThanOrEqual(2)
    expect(expected.x + expected.width - 1 - bounds.maxX).toBeLessThanOrEqual(2)
    expect(expected.y + expected.height - 1 - bounds.maxY).toBeLessThanOrEqual(2)

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

    const narrowBounds = changedBounds(narrow)
    const wideBounds = changedBounds(wide)
    const narrowExpected = logoRect(SQUARE.targetWidth, SQUARE.targetHeight, 'top_left', 0.12)
    const wideExpected = logoRect(SQUARE.targetWidth, SQUARE.targetHeight, 'top_left', 0.32)

    expect(narrowBounds.maxX - narrowBounds.minX + 1).toBeLessThanOrEqual(narrowExpected.width)
    expect(wideBounds.maxX - wideBounds.minX + 1).toBeLessThanOrEqual(wideExpected.width)
    expect(wideBounds.maxX).toBeGreaterThan(narrowBounds.maxX)
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

    for (const width of [473, 620, 900]) {
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

  it('lands the QR where qrRect says, with its quiet zone plate intact', async () => {
    const source = await createSource(POSTER.targetWidth, POSTER.targetHeight)
    const spec = posterSpec()
    const image = await decode(unwrap(await compositeArtwork(source, spec)))

    if (!spec.qr) throw new Error('unreachable')
    const expected = qrRect(
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

    // Just outside the rect is still untouched background, which pins the edge.
    expect(pixelAt(image, expected.x - 1, expected.y - 1).slice(0, 3)).toEqual([
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

  it('rejects a QR under the 40mm print minimum', async () => {
    const source = await createSource(POSTER.targetWidth, POSTER.targetHeight)
    const minimum = qrMinWidthPx(POSTER.targetWidth)

    const result = await compositeArtwork(
      source,
      posterSpec({
        qr: { centreXFrac: 0.5, centreYFrac: 0.82, widthFrac: 0.1, url: BOOKING_URL },
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
    expect(sourceText).toContain('qrRect(')
    expect(sourceText).toContain('validateQrPlacement(')

    // The numbers geometry.ts owns must not appear here at all: the inset
    // fraction, the logo aspect ratio, the 40mm minimum and the A4 width.
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
