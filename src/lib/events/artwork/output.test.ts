// @vitest-environment node
//
// Real sharp, no mock. These assertions are about what the native encoder
// actually produces, so mocking it would test nothing.

import { describe, expect, it } from 'vitest'
import { PRINT_POSTER_DENSITY_DPI, validateCompositeOutput } from './output'
import { EVENT_IMAGE_VARIANTS } from '@/lib/events/imageVariants'

async function makePng(width: number, height: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width, height, channels: 4, background: { r: 120, g: 120, b: 120, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

describe('validateCompositeOutput', () => {
  it('accepts a composite that kept the original dimensions', async () => {
    const buffer = await makePng(1055, 1491)
    const result = await validateCompositeOutput(buffer, 'print_poster', {
      width: 1055,
      height: 1491,
    })
    expect(result).toEqual({ ok: true, width: 1055, height: 1491, bytes: buffer.length })
  })

  it('accepts a real-world poster that is nowhere near the nominal A4 target', async () => {
    // Production posters are around 1055x1491, about 128dpi across A4, and the
    // upload path has always accepted them. Validating against the variant's
    // nominal 2480x3508 target would reject every one of them.
    const config = EVENT_IMAGE_VARIANTS.print_poster
    expect(config.targetWidth).toBe(2480)
    const buffer = await makePng(1055, 1491)
    await expect(
      validateCompositeOutput(buffer, 'print_poster', { width: 1055, height: 1491 })
    ).resolves.toMatchObject({ ok: true })
  })

  it('rejects a composite that changed the dimensions, naming both sizes', async () => {
    const buffer = await makePng(1080, 1080)
    const result = await validateCompositeOutput(buffer, 'square', { width: 1055, height: 1055 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure')
    expect(result.reason).toContain('1055x1055')
    expect(result.reason).toContain('1080x1080')
    expect(result.reason).toContain('unchanged')
  })

  it('rejects a non-png buffer', async () => {
    const sharp = (await import('sharp')).default
    const jpeg = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer()
    const result = await validateCompositeOutput(jpeg, 'square', { width: 400, height: 400 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure')
    expect(result.reason).toContain('png')
  })

  it('rejects a buffer that cannot be decoded', async () => {
    const result = await validateCompositeOutput(Buffer.from('not an image'), 'square', {
      width: 10,
      height: 10,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure')
    expect(result.reason).toContain('could not be decoded')
  })

  it('rejects a buffer over the variant limit', async () => {
    const buffer = await makePng(64, 64)
    const padded = Buffer.concat([
      buffer,
      Buffer.alloc(EVENT_IMAGE_VARIANTS.square.maxBytes + 1, 0),
    ])
    const result = await validateCompositeOutput(padded, 'square', { width: 64, height: 64 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure')
    expect(result.reason).toContain('over the')
  })

  it('rejects an unknown variant without throwing', async () => {
    const buffer = await makePng(64, 64)
    const result = await validateCompositeOutput(
      buffer,
      'not_a_variant' as never,
      { width: 64, height: 64 }
    )
    expect(result.ok).toBe(false)
  })

  it('states A4 at 300dpi for the print density', () => {
    expect(PRINT_POSTER_DENSITY_DPI).toBe(300)
  })
})
