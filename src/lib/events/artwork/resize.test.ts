// @vitest-environment node
/**
 * These tests run the real `sharp`, on purpose.
 *
 * The rest of the repo mocks it (see `src/lib/expenses/__tests__/imageProcessor.test.ts`)
 * because it only needs to prove the pipeline was called. Here the pixel
 * dimensions ARE the contract: a mocked sharp would happily report 2480x3508
 * while the real one returned 1414x2000, which is exactly the failure this
 * module exists to prevent. Sources are built with sharp itself, so no fixture
 * files have to be checked in.
 */

import { describe, it, expect } from 'vitest'
import {
  RESIZE_OPTIONS,
  PRINT_POSTER_DENSITY_DPI,
  resizeToVariant,
  validateGeneratedImage,
} from './resize'
import { EVENT_IMAGE_VARIANTS, type EventImageVariant } from '@/lib/events/imageVariants'

interface Size {
  width: number
  height: number
}

/**
 * The size each variant actually arrives at.
 *
 * The four generated ones are the provider request sizes from
 * `src/lib/events/artwork/sizes.ts`, repeated literally rather than imported,
 * so this suite fails loudly if that table moves rather than quietly following
 * it. The square is never generated: it is the owner's uploaded artwork, so its
 * source is whatever they exported, here a plausible 1200x1200.
 */
const SOURCE_SIZES: Record<EventImageVariant, Size> = {
  square: { width: 1200, height: 1200 },
  landscape: { width: 1936, height: 1088 },
  social: { width: 1920, height: 1008 },
  story: { width: 1088, height: 1936 },
  print_poster: { width: 1600, height: 2272 }, // the `standard` poster profile
}

/** The `high` poster profile, which upscales far less but is still an upscale. */
const HIGH_POSTER_SOURCE: Size = { width: 2416, height: 3424 }

const VARIANTS = Object.keys(SOURCE_SIZES) as EventImageVariant[]

async function createImage(
  size: Size,
  background: { r: number; g: number; b: number; alpha: number } = {
    r: 24,
    g: 96,
    b: 168,
    alpha: 1,
  }
): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width: size.width, height: size.height, channels: 4, background },
  })
    .png()
    .toBuffer()
}

async function readMetadata(
  buffer: Buffer
): Promise<{ width?: number; height?: number; format?: string; density?: number }> {
  const sharp = (await import('sharp')).default
  const metadata = await sharp(buffer).metadata()
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    density: metadata.density,
  }
}

/**
 * The share of one edge `cover` throws away, as a percentage.
 *
 * `cover` scales by whichever factor is larger so the frame is filled, then
 * trims the overflow off the other axis.
 */
function cropPercentage(source: Size, target: Size): number {
  const scale = Math.max(target.width / source.width, target.height / source.height)
  const scaledWidth = source.width * scale
  const scaledHeight = source.height * scale
  const widthCrop = (scaledWidth - target.width) / scaledWidth
  const heightCrop = (scaledHeight - target.height) / scaledHeight
  return Math.max(widthCrop, heightCrop) * 100
}

describe('RESIZE_OPTIONS', () => {
  it('uses cover, so the artwork is never stretched or letterboxed', () => {
    // If this fails, read the comment on RESIZE_OPTIONS before changing it.
    // `fill` distorts the artwork and `contain` adds bars; `cover` costs under
    // 0.5% of one edge, which is the accepted trade-off.
    expect(RESIZE_OPTIONS.fit).toBe('cover')
    expect(RESIZE_OPTIONS.position).toBe('centre')
    expect(RESIZE_OPTIONS.kernel).toBe('lanczos3')
    // False on purpose: the A4 poster has to upscale, no legal request size
    // covers 2480x3508.
    expect(RESIZE_OPTIONS.withoutEnlargement).toBe(false)
  })
})

describe('resizeToVariant', () => {
  it.each(VARIANTS)('brings %s to exactly its target size', async (variant) => {
    const config = EVENT_IMAGE_VARIANTS[variant]
    const source = await createImage(SOURCE_SIZES[variant])

    const output = await resizeToVariant(source, variant)
    const metadata = await readMetadata(output)

    expect(metadata.width).toBe(config.targetWidth)
    expect(metadata.height).toBe(config.targetHeight)
    expect(metadata.format).toBe('png')
  }, 20000)

  it('upscales the standard poster profile to A4 at 300dpi', async () => {
    const source = await createImage(SOURCE_SIZES.print_poster)
    expect(SOURCE_SIZES.print_poster.width).toBeLessThan(
      EVENT_IMAGE_VARIANTS.print_poster.targetWidth
    )

    const output = await resizeToVariant(source, 'print_poster')
    const metadata = await readMetadata(output)

    expect(metadata.width).toBe(2480)
    expect(metadata.height).toBe(3508)
    expect(metadata.density).toBe(PRINT_POSTER_DENSITY_DPI)
  }, 20000)

  it('upscales the high poster profile to A4 at 300dpi as well', async () => {
    const source = await createImage(HIGH_POSTER_SOURCE)

    const output = await resizeToVariant(source, 'print_poster')
    const metadata = await readMetadata(output)

    expect(metadata.width).toBe(2480)
    expect(metadata.height).toBe(3508)
    expect(metadata.density).toBe(PRINT_POSTER_DENSITY_DPI)
  }, 20000)

  it('leaves the screen variants without a print density', async () => {
    const source = await createImage(SOURCE_SIZES.landscape)

    const output = await resizeToVariant(source, 'landscape')
    const metadata = await readMetadata(output)

    expect(metadata.density).toBeUndefined()
  }, 20000)

  it('fills the frame rather than letterboxing it', async () => {
    // A flat source resized with `contain` would gain transparent black bars,
    // dragging the minimum of every channel to zero. `cover` cannot, because it
    // fills the frame from the source alone.
    const sharp = (await import('sharp')).default
    const background = { r: 24, g: 96, b: 168, alpha: 1 }
    const source = await createImage(SOURCE_SIZES.social, background)

    const output = await resizeToVariant(source, 'social')
    const stats = await sharp(output).stats()

    const [red, green, blue] = stats.channels
    expect(red.min).toBeCloseTo(background.r, 0)
    expect(green.min).toBeCloseTo(background.g, 0)
    expect(blue.min).toBeCloseTo(background.b, 0)
    expect(stats.isOpaque).toBe(true)
  }, 20000)

  it('rejects an unknown variant', async () => {
    const source = await createImage({ width: 640, height: 640 })

    await expect(
      resizeToVariant(source, 'banner' as unknown as EventImageVariant)
    ).rejects.toThrow(/Unknown event image variant/)
  })
})

describe('the crop cover has to make', () => {
  it.each(VARIANTS)('stays under 0.5% of an edge for %s', (variant) => {
    const config = EVENT_IMAGE_VARIANTS[variant]
    const crop = cropPercentage(SOURCE_SIZES[variant], {
      width: config.targetWidth,
      height: config.targetHeight,
    })

    expect(crop).toBeLessThan(0.5)
  })

  it('stays under 0.5% for the high poster profile too', () => {
    const crop = cropPercentage(HIGH_POSTER_SOURCE, {
      width: EVENT_IMAGE_VARIANTS.print_poster.targetWidth,
      height: EVENT_IMAGE_VARIANTS.print_poster.targetHeight,
    })

    expect(crop).toBeLessThan(0.5)
  })
})

describe('validateGeneratedImage', () => {
  it('accepts a correctly resized image', async () => {
    const source = await createImage(SOURCE_SIZES.landscape)
    const output = await resizeToVariant(source, 'landscape')

    const result = await validateGeneratedImage(output, 'landscape')

    expect(result).toEqual({
      ok: true,
      width: 1920,
      height: 1080,
      bytes: output.length,
    })
  }, 20000)

  it('rejects an image at the wrong size, naming both sizes', async () => {
    // The raw generation size, never resized: the exact mistake this catches.
    const source = await createImage(SOURCE_SIZES.social)

    const result = await validateGeneratedImage(source, 'social')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a rejection')
    expect(result.reason).toContain('1920x1005')
    expect(result.reason).toContain('1920x1008')
  })

  it('rejects an image that is not a png', async () => {
    const sharp = (await import('sharp')).default
    // Right dimensions, wrong container, so the reason is about the format.
    const jpeg = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: '#1860a8' },
    })
      .jpeg()
      .toBuffer()

    const result = await validateGeneratedImage(jpeg, 'landscape')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a rejection')
    expect(result.reason).toContain('should be a png')
    expect(result.reason).toContain('jpeg')
  })

  it('rejects an image over the variant limit', async () => {
    const source = await createImage(SOURCE_SIZES.landscape)
    const output = await resizeToVariant(source, 'landscape')
    // Padding after IEND keeps the png decodable at the right size, so the
    // only thing wrong with this buffer is its length.
    const oversized = Buffer.concat([
      output,
      Buffer.alloc(EVENT_IMAGE_VARIANTS.landscape.maxBytes, 0),
    ])

    const result = await validateGeneratedImage(oversized, 'landscape')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a rejection')
    expect(result.reason).toContain('over the')
    expect(result.reason).toContain('limit')
  }, 20000)

  it('rejects a buffer that is not an image at all', async () => {
    const result = await validateGeneratedImage(
      Buffer.from('the provider returned an error page, not an image'),
      'square'
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a rejection')
    expect(result.reason).toContain('could not be decoded')
  })

  it('gives each failure its own reason', async () => {
    const sharp = (await import('sharp')).default
    const wrongSize = await createImage(SOURCE_SIZES.landscape)
    const notPng = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: '#1860a8' },
    })
      .jpeg()
      .toBuffer()
    const output = await resizeToVariant(wrongSize, 'landscape')
    const oversized = Buffer.concat([
      output,
      Buffer.alloc(EVENT_IMAGE_VARIANTS.landscape.maxBytes, 0),
    ])

    const reasons = await Promise.all(
      [wrongSize, notPng, oversized, Buffer.from('not an image')].map(async (buffer) => {
        const result = await validateGeneratedImage(buffer, 'landscape')
        return result.ok ? 'accepted' : result.reason
      })
    )

    expect(new Set(reasons).size).toBe(reasons.length)
  }, 20000)
})
