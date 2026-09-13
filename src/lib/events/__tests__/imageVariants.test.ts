import { describe, expect, it } from 'vitest'
import {
  ASPECT_RATIO_TOLERANCE,
  EVENT_IMAGE_VARIANTS,
  EVENT_IMAGE_VARIANT_ORDER,
  aspectRatioMatches,
  buildEventImageStoragePath,
  buildVariantPrompt,
  describeAspectRatio,
  formatBytes,
  isEventImageVariant,
  isOwnedByEvent,
  qrMinimumFor,
  sanitiseFileName,
  storagePathFromPublicUrl,
} from '../imageVariants'
import { QR_MAX_WIDTH_FRAC, QR_MIN_WIDTH_FRAC } from '../artwork/geometry'
import { TABLE_TALKER_PANEL_WIDTH_MM } from '../artwork/print-sheet'

/**
 * The migration's CHECK constraint on event_images.image_type. Kept here so the
 * config and the database cannot drift apart without a test failing.
 */
const DATABASE_VARIANTS = ['square', 'landscape', 'social', 'story', 'print_poster', 'table_talker']

describe('variant configuration', () => {
  it('matches the database CHECK constraint exactly', () => {
    expect([...EVENT_IMAGE_VARIANT_ORDER].sort()).toEqual([...DATABASE_VARIANTS].sort())
    expect(Object.keys(EVENT_IMAGE_VARIANTS).sort()).toEqual([...DATABASE_VARIANTS].sort())
  })

  it('only exposes the three web variants to the public API', () => {
    const webServed = EVENT_IMAGE_VARIANT_ORDER.filter((v) => EVENT_IMAGE_VARIANTS[v].webServed)
    expect(webServed).toEqual(['square', 'landscape', 'social'])
  })

  it('keeps the print poster off poster_image_url', () => {
    // poster_image_url belongs to the square. The website prefers it over hero,
    // so a print file there would be served as a web image.
    expect(EVENT_IMAGE_VARIANTS.print_poster.cacheColumn).toBe('print_poster_url')
    expect(EVENT_IMAGE_VARIANTS.square.cacheColumn).toBe('hero_image_url')
  })

  it('accepts PDF for the print poster only', () => {
    expect(EVENT_IMAGE_VARIANTS.print_poster.acceptedMimeTypes).toContain('application/pdf')
    for (const variant of EVENT_IMAGE_VARIANT_ORDER.filter((v) => v !== 'print_poster')) {
      expect(EVENT_IMAGE_VARIANTS[variant].acceptedMimeTypes).not.toContain('application/pdf')
    }
  })

  it('gives the print poster the larger cap', () => {
    expect(EVENT_IMAGE_VARIANTS.print_poster.maxBytes).toBeGreaterThan(
      EVENT_IMAGE_VARIANTS.square.maxBytes
    )
  })

  it('recognises only real variant keys', () => {
    expect(isEventImageVariant('square')).toBe(true)
    expect(isEventImageVariant('hero')).toBe(false)
    expect(isEventImageVariant('primary')).toBe(false)
    expect(isEventImageVariant(null)).toBe(false)
  })
})

describe('aspectRatioMatches', () => {
  it('accepts each variant at its target size', () => {
    for (const variant of EVENT_IMAGE_VARIANT_ORDER) {
      const { targetWidth, targetHeight } = EVENT_IMAGE_VARIANTS[variant]
      expect(aspectRatioMatches(variant, targetWidth, targetHeight)).toBe(true)
    }
  })

  it('refuses a square dropped into the landscape tile', () => {
    expect(aspectRatioMatches('landscape', 1080, 1080)).toBe(false)
  })

  it('refuses a landscape dropped into the story tile', () => {
    expect(aspectRatioMatches('story', 1920, 1080)).toBe(false)
  })

  it('takes a DL panel on the table talker tile, and refuses the near misses', () => {
    expect(aspectRatioMatches('table_talker', 1169, 2480)).toBe(true)
    // A real export a pixel or two out is fine.
    expect(aspectRatioMatches('table_talker', 1080, 2291)).toBe(true)
    // A story (9:16), an A5 flyer and a 1:2 strip are all the wrong shape, and
    // printing any of them in a DL slot would leave a band or cut an edge.
    expect(aspectRatioMatches('table_talker', 1080, 1920)).toBe(false)
    expect(aspectRatioMatches('table_talker', 1748, 2480)).toBe(false)
    expect(aspectRatioMatches('table_talker', 1080, 2160)).toBe(false)
  })

  it('tolerates a slightly off export', () => {
    // 1920x1004 rather than 1005, the sort of thing a real export produces.
    expect(aspectRatioMatches('social', 1920, 1004)).toBe(true)
    expect(aspectRatioMatches('square', 1080, 1040)).toBe(true)
  })

  it('refuses a shape outside the tolerance', () => {
    expect(aspectRatioMatches('square', 1080, 1350)).toBe(false)
  })

  it('treats unknown dimensions as acceptable rather than a rejection', () => {
    // PDFs and undecodable files report zeroes, which must not block an upload.
    expect(aspectRatioMatches('print_poster', 0, 0)).toBe(true)
  })

  it('uses a proportional tolerance', () => {
    const justInside = 1 + ASPECT_RATIO_TOLERANCE * 0.9
    expect(aspectRatioMatches('square', Math.round(1000 * justInside), 1000)).toBe(true)
    const justOutside = 1 + ASPECT_RATIO_TOLERANCE * 1.5
    expect(aspectRatioMatches('square', Math.round(1000 * justOutside), 1000)).toBe(false)
  })
})

describe('describeAspectRatio', () => {
  it('gives a readable ratio for simple shapes', () => {
    expect(describeAspectRatio(1080, 1080)).toBe('1:1')
    expect(describeAspectRatio(1920, 1080)).toBe('16:9')
    expect(describeAspectRatio(1080, 1920)).toBe('9:16')
  })

  it('falls back to a decimal when the reduced ratio is meaningless', () => {
    // 1920x1005 reduces to 128:67, which tells nobody anything.
    expect(describeAspectRatio(1920, 1005)).toBe('1.91:1')
  })

  it('handles missing dimensions', () => {
    expect(describeAspectRatio(0, 0)).toBe('an unknown shape')
  })
})

describe('storage path handling', () => {
  const base = 'https://p.supabase.co/storage/v1/object/public/event-images/'

  it('recovers the path from a public URL', () => {
    expect(storagePathFromPublicUrl(`${base}events/abc/square/1_a.png`)).toBe(
      'events/abc/square/1_a.png'
    )
  })

  it('decodes escaped characters and drops a query string', () => {
    expect(storagePathFromPublicUrl(`${base}events/abc/square/1_a%20b.png?v=2`)).toBe(
      'events/abc/square/1_a b.png'
    )
  })

  it('returns null for anything outside the bucket', () => {
    expect(storagePathFromPublicUrl('https://example.com/x.png')).toBeNull()
    expect(storagePathFromPublicUrl(null)).toBeNull()
    expect(storagePathFromPublicUrl('')).toBeNull()
  })

  it('treats only the event own folder as owned', () => {
    expect(isOwnedByEvent('events/abc/square/1.png', 'abc')).toBe(true)
    expect(isOwnedByEvent('events/other/square/1.png', 'abc')).toBe(false)
    // The live case: 16 events point at a category object, one shared by 8.
    expect(isOwnedByEvent('categories/cat-1/hero/1.png', 'abc')).toBe(false)
    expect(isOwnedByEvent(null, 'abc')).toBe(false)
  })

  it('builds a predictable, sanitised path', () => {
    expect(buildEventImageStoragePath('abc', 'social', 'My Poster (final).png', 1700000000000)).toBe(
      'events/abc/social/1700000000000_My_Poster_final.png'
    )
  })

  it('never produces an empty file name', () => {
    expect(sanitiseFileName('!!!')).toBe('unnamed')
  })
})

describe('buildVariantPrompt', () => {
  const prompt = buildVariantPrompt()

  it('asks for every variant except the square, which is the source image', () => {
    expect(prompt).not.toContain('Square (source image)')
    for (const variant of EVENT_IMAGE_VARIANT_ORDER.filter((v) => v !== 'square')) {
      expect(prompt).toContain(EVENT_IMAGE_VARIANTS[variant].promptLabel)
    }
  })

  it('quotes the exact dimensions the upload validates against', () => {
    // The whole point of generating this: a hardcoded prompt would eventually
    // ask for a size the tile then refuses.
    for (const variant of EVENT_IMAGE_VARIANT_ORDER.filter((v) => v !== 'square')) {
      const { targetWidth, targetHeight } = EVENT_IMAGE_VARIANTS[variant]
      expect(prompt).toContain(`${targetWidth} x ${targetHeight} px`)
    }
  })

  it('names the story, landscape and cover sizes the owner asked for', () => {
    expect(prompt).toContain('Instagram story: 9:16, 1080 x 1920 px')
    expect(prompt).toContain('Landscape: 16:9, 1920 x 1080 px')
    expect(prompt).toContain('Facebook event cover / link preview: 1.91:1, 1920 x 1005 px')
  })

  it('flags the two print sizes as 300 dpi, and no screen size', () => {
    expect(prompt).toContain('2480 x 3508 px at 300 dpi')
    expect(prompt).toContain('1169 x 2480 px at 300 dpi')
    expect(prompt.match(/300 dpi/g)).toHaveLength(2)
  })

  it('asks for the slim table talker with its size and how to compose it', () => {
    expect(prompt).toContain(
      '- Slim table talker for print: DL portrait (99 x 210 mm), 1169 x 2480 px at 300 dpi. ' +
        'Tall and slim: stack the elements vertically rather than shrinking the square layout to fit the width.'
    )
  })

  it('tells the tool to re-compose rather than stretch', () => {
    expect(prompt.toLowerCase()).toContain('re-compose')
    expect(prompt.toLowerCase()).toContain('inside the frame')
  })

  it('is plain text that survives a copy and paste', () => {
    expect(prompt).not.toMatch(/<[^>]+>/)
    expect(prompt.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(5)
  })
})

describe('print specs', () => {
  const printVariants = EVENT_IMAGE_VARIANT_ORDER.filter((v) => EVENT_IMAGE_VARIANTS[v].print !== null)

  it('marks exactly the print variants as printed', () => {
    expect(printVariants).toEqual(['print_poster', 'table_talker'])
    for (const variant of printVariants) {
      expect(EVENT_IMAGE_VARIANTS[variant].webServed).toBe(false)
    }
  })

  it('never lets a QR at the floor print under its millimetre minimum', () => {
    for (const variant of printVariants) {
      const print = EVENT_IMAGE_VARIANTS[variant].print!
      expect(print.qrMinWidthFrac * print.printedWidthMm).toBeGreaterThanOrEqual(print.qrMinMm)
      // Rounded up by at most one step of the fourth decimal place, so the
      // floor is not needlessly larger than the millimetres it stands for.
      expect(print.qrMinWidthFrac - print.qrMinMm / print.printedWidthMm).toBeLessThan(0.0001)
    }
  })

  it('keeps every floor inside what the database and the route accept', () => {
    for (const variant of printVariants) {
      const { qrMinWidthFrac } = EVENT_IMAGE_VARIANTS[variant].print!
      expect(qrMinWidthFrac).toBeGreaterThanOrEqual(QR_MIN_WIDTH_FRAC)
      expect(qrMinWidthFrac).toBeLessThan(QR_MAX_WIDTH_FRAC)
    }
  })

  it('keeps the poster exactly where it was', () => {
    expect(EVENT_IMAGE_VARIANTS.print_poster.print).toMatchObject({
      printedWidthMm: 210,
      qrMinMm: 21,
      qrMinWidthFrac: QR_MIN_WIDTH_FRAC,
      qrChannel: 'poster',
      surfaceName: 'poster',
      printedSizeLabel: 'the A4 poster',
    })
  })

  it('measures the table talker QR against its panel on the A4 sheet', () => {
    expect(EVENT_IMAGE_VARIANTS.table_talker.print).toMatchObject({
      printedWidthMm: TABLE_TALKER_PANEL_WIDTH_MM,
      qrMinMm: 15,
      qrMinWidthFrac: 0.1625,
      qrChannel: 'table_talker',
      surfaceName: 'table talker',
    })
    // The poster's 10% floor would be a 9mm code on this panel.
    expect(QR_MIN_WIDTH_FRAC * TABLE_TALKER_PANEL_WIDTH_MM).toBeLessThan(10)
  })

  it('keeps the table talker off the website and away from PDF', () => {
    expect(EVENT_IMAGE_VARIANTS.table_talker.webServed).toBe(false)
    expect(EVENT_IMAGE_VARIANTS.table_talker.acceptedMimeTypes).not.toContain('application/pdf')
    expect(EVENT_IMAGE_VARIANTS.table_talker.cacheColumn).toBe('table_talker_url')
  })

  it('gives each print surface its own QR channel', () => {
    const channels = printVariants.map((v) => EVENT_IMAGE_VARIANTS[v].print!.qrChannel)
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('hands the geometry the surface minimum, and nothing for a screen', () => {
    expect(qrMinimumFor('square')).toBeNull()
    expect(qrMinimumFor('story')).toBeNull()
    expect(qrMinimumFor('print_poster')).toEqual({ widthFrac: QR_MIN_WIDTH_FRAC, mm: 21, surfaceName: 'poster' })
  })
})

describe('formatBytes', () => {
  it('reads naturally at each scale', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB')
  })
})
