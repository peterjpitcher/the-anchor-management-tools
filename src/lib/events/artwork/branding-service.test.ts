// @vitest-environment node
/**
 * These tests run the real `sharp`, the real `qrcode` and the real logo files
 * that ship in `public/guest/`, against an in-memory stand-in for Supabase
 * storage and the two tables involved.
 *
 * The storage stand-in really keeps bytes. That is the whole point: the claim
 * this module has to prove is that branding always composites from the ORIGINAL
 * and never from the previous composite, and the only honest way to prove it is
 * to brand the same image twice and show the second result is byte-for-byte the
 * first. A mocked storage layer that returned whatever it was told would say
 * "yes" to that whatever the code did.
 *
 * No network: the QR codes encode a URL string and nothing fetches it, and the
 * short-link resolver is stubbed because its own 16 tests cover it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  logoRect,
  logoRectFree,
  qrRect,
  insetPx,
  logoShadowSpec,
  type Corner,
  type Rect,
} from './geometry'
import { logoShadowPaddingPx } from './composite'
import type { CompositeResult, CompositeSpec, LogoColour } from './composite'
import { EVENT_IMAGE_VARIANTS, type EventImageVariant } from '@/lib/events/imageVariants'

const EVENT_ID = '3f1d9e2c-7b4a-4c8e-9a11-2d5f6b7c8d90'
const OTHER_EVENT_ID = 'aa11bb22-cc33-4d44-8e55-ff6677889900'
const USER_ID = '11111111-2222-4333-8444-555566667777'
const BUCKET = 'event-images'
const PUBLIC_PREFIX = `https://cdn.test/storage/v1/object/public/${BUCKET}/`

const POSTER_LINK = {
  ok: true as const,
  shortLinkId: '99999999-8888-4777-8666-555544443333',
  shortCode: 'po1a2b3c',
  shortUrl: 'https://l.the-anchor.pub/po1a2b3c',
  destinationUrl: 'https://www.the-anchor.pub/events/quiz-night',
  wasRepaired: false,
}

// ---------------------------------------------------------------------------
// Hoisted test state. `vi.mock` factories run before the module body, so
// anything they close over has to come from `vi.hoisted`.
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  client: null as unknown,
  posterLink: null as unknown,
  compositeOverride: null as
    | null
    | ((source: Buffer, spec: CompositeSpec) => Promise<CompositeResult>),
  permission: null as unknown,
  audits: [] as Record<string, unknown>[],
  revalidated: [] as string[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => hoisted.client,
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(async (params: Record<string, unknown>) => {
    hoisted.audits.push(params)
  }),
}))

vi.mock('./poster-link', () => ({
  resolvePosterLink: vi.fn(async () => hoisted.posterLink),
}))

// The real compositor by default, so every placement claim below is proved by
// reading pixels back out of a genuinely composited PNG. Only the
// changed-dimensions test swaps it, because nothing else can produce an output
// of the wrong size.
vi.mock('./composite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./composite')>()
  return {
    ...actual,
    compositeArtwork: vi.fn(
      async (source: Buffer, spec: CompositeSpec, options?: Record<string, unknown>) =>
        hoisted.compositeOverride
          ? hoisted.compositeOverride(source, spec)
          : actual.compositeArtwork(source, spec, options as never)
    ),
  }
})

vi.mock('@/lib/api/permissions', () => ({
  requireModulePermission: vi.fn(async () => hoisted.permission),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((path: string) => {
    hoisted.revalidated.push(path)
  }),
}))

import {
  applyEventImageBranding,
  revertEventImageBranding,
  isPrintVariant,
  type BrandingResult,
  type BrandingSuccess,
} from './branding-service'

// ---------------------------------------------------------------------------
// The stand-in
// ---------------------------------------------------------------------------

interface StoredRow {
  id: string
  event_id: string
  image_type: string
  storage_path: string
  file_name: string
  mime_type: string
  file_size_bytes: number
  original_storage_path: string | null
  logo_corner: string | null
  logo_centre_x_frac: number | null
  logo_centre_y_frac: number | null
  logo_colour: string | null
  logo_width_frac: number | null
  qr_centre_x_frac: number | null
  qr_centre_y_frac: number | null
  qr_width_frac: number | null
  qr_short_link_id: string | null
}

const BRANDING_COLUMNS = [
  'original_storage_path',
  'logo_corner',
  'logo_centre_x_frac',
  'logo_centre_y_frac',
  'logo_colour',
  'logo_width_frac',
  'qr_centre_x_frac',
  'qr_centre_y_frac',
  'qr_width_frac',
  'qr_short_link_id',
] as const

class FakeSupabase {
  objects = new Map<string, Buffer>()
  events = new Map<string, Record<string, unknown>>()
  rows: StoredRow[] = []

  uploads: string[] = []
  removes: string[] = []
  downloads: string[] = []
  rpcCalls: Record<string, unknown>[] = []
  updates: number = 0

  failUpdate = false
  failRpcAfter: number | null = null

  get storage() {
    return {
      from: (bucket: string) => {
        if (bucket !== BUCKET) throw new Error(`Unexpected bucket ${bucket}`)
        return {
          download: async (path: string) => {
            this.downloads.push(path)
            const object = this.objects.get(path)
            if (!object) return { data: null, error: { message: 'Object not found' } }
            return { data: new Blob([new Uint8Array(object)]), error: null }
          },
          upload: async (path: string, body: Buffer, options?: { upsert?: boolean }) => {
            if (this.objects.has(path) && options?.upsert !== true) {
              return { data: null, error: { message: 'The resource already exists' } }
            }
            this.objects.set(path, Buffer.from(body))
            this.uploads.push(path)
            return { data: { path }, error: null }
          },
          remove: async (paths: string[]) => {
            for (const path of paths) {
              this.objects.delete(path)
              this.removes.push(path)
            }
            return { data: null, error: null }
          },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `${PUBLIC_PREFIX}${path}` } }),
        }
      },
    }
  }

  from(table: string) {
    if (table === 'events') {
      return {
        select: () => ({
          eq: (_column: string, value: string) => ({
            maybeSingle: async () => ({ data: this.events.get(value) ?? null, error: null }),
          }),
        }),
      }
    }

    if (table === 'event_images') {
      return {
        select: () => ({
          eq: (_c1: string, eventId: string) => ({
            eq: (_c2: string, variant: string) => ({
              maybeSingle: async () => ({ data: this.findRow(eventId, variant) ?? null, error: null }),
            }),
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: (_c1: string, eventId: string) => ({
            eq: async (_c2: string, variant: string) => {
              this.updates += 1
              if (this.failUpdate) return { error: { message: 'update refused' } }
              const row = this.findRow(eventId, variant)
              if (row) Object.assign(row, values)
              return { error: null }
            },
          }),
        }),
      }
    }

    throw new Error(`Unexpected table ${table}`)
  }

  async rpc(name: string, params: Record<string, unknown>) {
    if (name !== 'upsert_event_image_variant') throw new Error(`Unexpected rpc ${name}`)
    this.rpcCalls.push(params)

    if (this.failRpcAfter !== null && this.rpcCalls.length > this.failRpcAfter) {
      return { data: null, error: { message: 'rpc refused' } }
    }

    const eventId = params.p_event_id as string
    const variant = params.p_variant as string
    const event = this.events.get(eventId)
    if (!event) return { data: null, error: { message: `Event ${eventId} not found` } }

    const existing = this.findRow(eventId, variant)
    const previous = existing ? existing.storage_path : null

    if (existing) {
      existing.storage_path = params.p_storage_path as string
      existing.file_name = params.p_file_name as string
      existing.mime_type = params.p_mime_type as string
      existing.file_size_bytes = params.p_file_size_bytes as number
    } else {
      this.rows.push({
        id: `row-${this.rows.length + 1}`,
        event_id: eventId,
        image_type: variant,
        storage_path: params.p_storage_path as string,
        file_name: params.p_file_name as string,
        mime_type: params.p_mime_type as string,
        file_size_bytes: params.p_file_size_bytes as number,
        original_storage_path: null,
        logo_corner: null,
        logo_centre_x_frac: null,
        logo_centre_y_frac: null,
        logo_colour: null,
        logo_width_frac: null,
        qr_centre_x_frac: null,
        qr_centre_y_frac: null,
        qr_width_frac: null,
        qr_short_link_id: null,
      })
    }

    event[EVENT_IMAGE_VARIANTS[variant as EventImageVariant].cacheColumn] =
      params.p_public_url as string

    return { data: previous, error: null }
  }

  findRow(eventId: string, variant: string): StoredRow | undefined {
    return this.rows.find((row) => row.event_id === eventId && row.image_type === variant)
  }

  livePath(variant: EventImageVariant, eventId = EVENT_ID): string {
    const row = this.findRow(eventId, variant)
    if (!row) throw new Error(`No row for ${variant}`)
    return row.storage_path
  }

  liveBytes(variant: EventImageVariant, eventId = EVENT_ID): Buffer {
    const object = this.objects.get(this.livePath(variant, eventId))
    if (!object) throw new Error('The live object is missing from storage')
    return object
  }
}

// ---------------------------------------------------------------------------
// Image helpers. The source is a single flat colour, so anything that is not
// that colour in the output was drawn by the compositor, and where those pixels
// are is where it put it.
// ---------------------------------------------------------------------------

const BACKGROUND = { r: 128, g: 128, b: 128, alpha: 1 }

const VARIANT_SIZES: Record<EventImageVariant, { width: number; height: number }> = {
  square: { width: 400, height: 400 },
  landscape: { width: 640, height: 360 },
  social: { width: 640, height: 335 },
  story: { width: 360, height: 640 },
  // Deliberately NOT the nominal 2480x3508. Real posters in production sit
  // around here, because the upload path has only ever checked aspect ratio.
  print_poster: { width: 1055, height: 1491 },
}

async function createImage(width: number, height: number, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const pipeline = sharp({ create: { width, height, channels: 4, background: BACKGROUND } })
  return format === 'png' ? pipeline.png().toBuffer() : pipeline.jpeg().toBuffer()
}

async function dimensionsOf(buffer: Buffer): Promise<{ width: number; height: number }> {
  const sharp = (await import('sharp')).default
  const { width, height } = await sharp(buffer).metadata()
  return { width: width ?? 0, height: height ?? 0 }
}

/** The bounding box of every pixel the compositor changed. */
async function changedBounds(
  buffer: Buffer
): Promise<{ count: number; minX: number; minY: number; maxX: number; maxY: number }> {
  const sharp = (await import('sharp')).default
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  let count = 0
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels
      const changed =
        Math.abs(data[offset] - BACKGROUND.r) > 8 ||
        Math.abs(data[offset + 1] - BACKGROUND.g) > 8 ||
        Math.abs(data[offset + 2] - BACKGROUND.b) > 8
      if (!changed) continue
      count += 1
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  return { count, minX, minY, maxX, maxY }
}

/**
 * Every changed pixel sits inside this rect, allowing for anti-aliased edges
 * AND for the logo's drop shadow.
 *
 * The logo now carries a shadow in the opposite colour, so the painted area is
 * legitimately larger than `logoRect`. The blur pads the shape on all four
 * sides by `logoShadowPaddingPx`, and the offset then pushes it down and right.
 * So the extra room needed is `pad + offset` on the bottom and right, and only
 * whatever the blur reaches beyond the offset on the top and left.
 *
 * Widened rather than dropped: the assertion still proves the logo landed where
 * geometry said and that nothing else was painted, which is the whole point of
 * it. `composite.test.ts` proves the mark itself is pixel exact by separating it
 * from its shadow by colour.
 */
function expectWithin(
  bounds: { count: number; minX: number; minY: number; maxX: number; maxY: number },
  rect: Rect
): void {
  const spec = logoShadowSpec(rect, 'white')
  const pad = logoShadowPaddingPx(spec)

  expect(bounds.count).toBeGreaterThan(0)
  expect(bounds.minX).toBeGreaterThanOrEqual(rect.x - 1 - Math.max(0, pad - spec.offsetXPx))
  expect(bounds.minY).toBeGreaterThanOrEqual(rect.y - 1 - Math.max(0, pad - spec.offsetYPx))
  expect(bounds.maxX).toBeLessThanOrEqual(rect.x + rect.width + pad + spec.offsetXPx + 1)
  expect(bounds.maxY).toBeLessThanOrEqual(rect.y + rect.height + pad + spec.offsetYPx + 1)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let db: FakeSupabase

async function seedVariant(
  variant: EventImageVariant,
  options: { format?: 'png' | 'jpeg'; eventId?: string; path?: string } = {}
): Promise<{ path: string; bytes: Buffer }> {
  const eventId = options.eventId ?? EVENT_ID
  const size = VARIANT_SIZES[variant]
  const bytes = await createImage(size.width, size.height, options.format ?? 'png')
  const extension = options.format === 'jpeg' ? 'jpg' : 'png'
  const path = options.path ?? `events/${eventId}/${variant}/1700000000000_artwork.${extension}`

  db.objects.set(path, bytes)
  db.rows.push({
    id: `row-${variant}-${eventId}`,
    event_id: eventId,
    image_type: variant,
    storage_path: path,
    file_name: `artwork.${extension}`,
    mime_type: extension === 'jpg' ? 'image/jpeg' : 'image/png',
    file_size_bytes: bytes.length,
    original_storage_path: null,
    logo_corner: null,
    logo_centre_x_frac: null,
    logo_centre_y_frac: null,
    logo_colour: null,
    logo_width_frac: null,
    qr_centre_x_frac: null,
    qr_centre_y_frac: null,
    qr_width_frac: null,
    qr_short_link_id: null,
  })

  const event = db.events.get(eventId)
  if (event) event[EVENT_IMAGE_VARIANTS[variant].cacheColumn] = `${PUBLIC_PREFIX}${path}`

  return { path, bytes }
}

function cornerLogo(corner: Corner = 'top_left', colour: LogoColour = 'white', widthFrac = 0.22) {
  return { placement: { mode: 'corner' as const, corner, widthFrac }, colour }
}

function expectOk(result: BrandingResult): BrandingSuccess {
  if (!result.ok) {
    throw new Error(`Expected success, got ${result.code}: ${result.error}`)
  }
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeSupabase()
  db.events.set(EVENT_ID, { id: EVENT_ID })
  db.events.set(OTHER_EVENT_ID, { id: OTHER_EVENT_ID })
  hoisted.client = db
  hoisted.posterLink = POSTER_LINK
  hoisted.compositeOverride = null
  hoisted.permission = { ok: true, userId: USER_ID, supabase: db }
  hoisted.audits = []
  hoisted.revalidated = []
})

// ---------------------------------------------------------------------------

describe('isPrintVariant', () => {
  it('is true for the A4 poster and nothing else', () => {
    expect(isPrintVariant('print_poster')).toBe(true)
    for (const variant of ['square', 'landscape', 'social', 'story'] as EventImageVariant[]) {
      expect(isPrintVariant(variant)).toBe(false)
    }
  })
})

describe('the composite source is always the original', () => {
  it('brands the same image twice from the original, byte for byte', async () => {
    const seeded = await seedVariant('square')

    const first = expectOk(
      await applyEventImageBranding({
        eventId: EVENT_ID,
        variant: 'square',
        logo: cornerLogo('top_left'),
        qr: null,
        userId: USER_ID,
      })
    )
    const firstBytes = Buffer.from(db.liveBytes('square'))

    const second = expectOk(
      await applyEventImageBranding({
        eventId: EVENT_ID,
        variant: 'square',
        logo: cornerLogo('top_left'),
        qr: null,
        userId: USER_ID,
      })
    )
    const secondBytes = db.liveBytes('square')

    // If the second pass had read the first composite, it would carry two logos
    // and could not possibly match.
    expect(secondBytes.equals(firstBytes)).toBe(true)
    expect(second.originalStoragePath).toBe(first.originalStoragePath)

    // And the recorded original is still the untouched upload.
    const original = db.objects.get(second.originalStoragePath as string)
    expect(original).toBeDefined()
    expect((original as Buffer).equals(seeded.bytes)).toBe(true)
  })

  it('moving the logo re-composites from the original rather than stacking', async () => {
    await seedVariant('square')

    await applyEventImageBranding({
      eventId: EVENT_ID,
      variant: 'square',
      logo: cornerLogo('top_left'),
      qr: null,
      userId: USER_ID,
    })

    expectOk(
      await applyEventImageBranding({
        eventId: EVENT_ID,
        variant: 'square',
        logo: cornerLogo('bottom_right'),
        qr: null,
        userId: USER_ID,
      })
    )

    const size = VARIANT_SIZES.square
    const bounds = await changedBounds(db.liveBytes('square'))
    // Only the bottom right logo is present. A stacked composite would still
    // carry the top left one and widen the bounds to the whole canvas.
    expectWithin(bounds, logoRect(size.width, size.height, 'bottom_right', 0.22))
  })

  it('copies the upload to an original- path first, then reuses it', async () => {
    const seeded = await seedVariant('square')

    const first = expectOk(
      await applyEventImageBranding({
        eventId: EVENT_ID,
        variant: 'square',
        logo: cornerLogo(),
        qr: null,
        userId: USER_ID,
      })
    )

    const originalPath = first.originalStoragePath as string
    expect(originalPath.startsWith(`events/${EVENT_ID}/square/original-`)).toBe(true)
    expect(db.findRow(EVENT_ID, 'square')?.original_storage_path).toBe(originalPath)
    // The upload it was copied from is gone, replaced by the composite.
    expect(db.objects.has(seeded.path)).toBe(false)
    expect(db.removes).toContain(seeded.path)

    const originalUploadsAfterFirst = db.uploads.filter((path) => path.includes('/original-')).length
    expect(originalUploadsAfterFirst).toBe(1)

    await applyEventImageBranding({
      eventId: EVENT_ID,
      variant: 'square',
      logo: cornerLogo('top_right'),
      qr: null,
      userId: USER_ID,
    })

    // No second copy: the recorded original was reused.
    expect(db.uploads.filter((path) => path.includes('/original-')).length).toBe(1)
    expect(db.findRow(EVENT_ID, 'square')?.original_storage_path).toBe(originalPath)
  })

  it('refuses rather than compounding when the recorded original cannot be read', async () => {
    await seedVariant('square')
    const first = expectOk(
      await applyEventImageBranding({
        eventId: EVENT_ID,
        variant: 'square',
        logo: cornerLogo(),
        qr: null,
        userId: USER_ID,
      })
    )

    // Someone emptied the bucket folder by hand.
    db.objects.delete(first.originalStoragePath as string)
    const livePath = db.livePath('square')

    const result = await applyEventImageBranding({
      eventId: EVENT_ID,
      variant: 'square',
      logo: cornerLogo('bottom_left'),
      qr: null,
      userId: USER_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('original_unavailable')
    expect(result.status).toBe(409)
    // The branded image is still exactly where it was.
    expect(db.livePath('square')).toBe(livePath)
  })

  it('treats a fresh upload over branded artwork as the new original and clears the stale one', async () => {
    await seedVariant('square')
    const first = expectOk(
      await applyEventImageBranding({
        eventId: EVENT_ID,
        variant: 'square',
        logo: cornerLogo(),
        qr: null,
        userId: USER_ID,
      })
    )
    const staleOriginal = first.originalStoragePath as string

    // What `confirmEventImageUpload` does: swap storage_path, leave the branding
    // columns alone.
    const replacement = await createImage(400, 400)
    const replacementPath = `events/${EVENT_ID}/square/1700000009999_new.png`
    db.objects.set(replacementPath, replacement)
    const row = db.findRow(EVENT_ID, 'square')
    if (row) row.storage_path = replacementPath

    const second = expectOk(
      await applyEventImageBranding({
        eventId: EVENT_ID,
        variant: 'square',
        logo: cornerLogo(),
        qr: null,
        userId: USER_ID,
      })
    )

    expect(second.originalStoragePath).not.toBe(staleOriginal)
    const newOriginal = db.objects.get(second.originalStoragePath as string)
    expect((newOriginal as Buffer).equals(replacement)).toBe(true)
    // The original nobody can reach any more is deleted, not left behind.
    expect(db.objects.has(staleOriginal)).toBe(false)
  })
})

describe('placement', () => {
  it('places a cornered logo on every one of the five variants', async () => {
    for (const variant of Object.keys(VARIANT_SIZES) as EventImageVariant[]) {
      db = new FakeSupabase()
      db.events.set(EVENT_ID, { id: EVENT_ID })
      hoisted.client = db
      await seedVariant(variant)

      const result = expectOk(
        await applyEventImageBranding({
          eventId: EVENT_ID,
          variant,
          logo: cornerLogo('bottom_right', 'black'),
          qr: null,
          userId: USER_ID,
        })
      )

      const size = VARIANT_SIZES[variant]
      expect(result.width).toBe(size.width)
      expect(result.height).toBe(size.height)
      expectWithin(
        await changedBounds(db.liveBytes(variant)),
        logoRect(size.width, size.height, 'bottom_right', 0.22)
      )
    }
  })

  it('places a freely positioned logo where it was asked for', async () => {
    const size = VARIANT_SIZES.landscape
    await seedVariant('landscape')

    expectOk(
      await applyEventImageBranding({
        eventId: EVENT_ID,
        variant: 'landscape',
        logo: {
          placement: { mode: 'free', centreXFrac: 0.5, centreYFrac: 0.62, widthFrac: 0.3 },
          colour: 'white',
        },
        qr: null,
        userId: USER_ID,
      })
    )

    const expected = logoRectFree(size.width, size.height, 0.5, 0.62, 0.3)
    expectWithin(await changedBounds(db.liveBytes('landscape')), expected)
    // A centred logo really is centred, not parked in a corner.
    expect(expected.x).toBeGreaterThan(insetPx(size.width, size.height))

    const row = db.findRow(EVENT_ID, 'landscape')
    expect(row?.logo_corner).toBeNull()
    expect(row?.logo_centre_x_frac).toBe(0.5)
    expect(row?.logo_centre_y_frac).toBe(0.62)
    expect(row?.logo_width_frac).toBe(0.3)
    expect(row?.logo_colour).toBe('white')
  })

  it('takes geometry from the poster it was actually given, not the nominal A4 size', async () => {
    const size = VARIANT_SIZES.print_poster
    expect(size.width).toBe(1055)
    expect(size.height).toBe(1491)
    expect(EVENT_IMAGE_VARIANTS.print_poster.targetWidth).toBe(2480)

    await seedVariant('print_poster')

    const result = expectOk(
      await applyEventImageBranding({
        eventId: EVENT_ID,
        variant: 'print_poster',
        logo: cornerLogo('top_left'),
        qr: { centreXFrac: 0.5, centreYFrac: 0.8, widthFrac: 0.25 },
        userId: USER_ID,
      })
    )

    expect(result.width).toBe(1055)
    expect(result.height).toBe(1491)
    expect(await dimensionsOf(db.liveBytes('print_poster'))).toEqual({ width: 1055, height: 1491 })

    // Both marks landed at the rects the shared geometry computes for 1055x1491.
    // Against the nominal 2480x3508 they would be off the canvas entirely.
    const logo = logoRect(1055, 1491, 'top_left', 0.22)
    const qr = qrRect(1055, 1491, 0.5, 0.8, 0.25)
    const bounds = await changedBounds(db.liveBytes('print_poster'))
    expect(bounds.minX).toBeGreaterThanOrEqual(logo.x - 1)
    expect(bounds.minY).toBeGreaterThanOrEqual(logo.y - 1)
    expect(bounds.maxX).toBeLessThanOrEqual(Math.max(logo.x + logo.width, qr.x + qr.width))
    expect(bounds.maxY).toBeLessThanOrEqual(qr.y + qr.height)
    expect(qr.width).toBeGreaterThanOrEqual(Math.ceil((1055 * 40) / 210))

    expect(result.qr).toEqual({
      shortLinkId: POSTER_LINK.shortLinkId,
      shortCode: POSTER_LINK.shortCode,
      shortUrl: POSTER_LINK.shortUrl,
      destinationUrl: POSTER_LINK.destinationUrl,
      wasRepaired: false,
    })
    expect(db.findRow(EVENT_ID, 'print_poster')?.qr_short_link_id).toBe(POSTER_LINK.shortLinkId)
  })
})

describe('refusals', () => {
  it('refuses a QR on a screen variant', async () => {
    await seedVariant('story')

    const result = await applyEventImageBranding({
      eventId: EVENT_ID,
      variant: 'story',
      logo: cornerLogo(),
      qr: { centreXFrac: 0.5, centreYFrac: 0.5, widthFrac: 0.25 },
      userId: USER_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('qr_not_supported')
    expect(result.status).toBe(422)
    expect(db.rpcCalls).toHaveLength(0)
    expect(db.uploads).toHaveLength(0)
  })

  it('passes a blocked poster link straight through with its reason', async () => {
    await seedVariant('print_poster')
    hoisted.posterLink = {
      ok: false,
      reason: 'event_cancelled',
      detail: '"Quiz Night" is cancelled, so a poster must not be printed for it.',
    }

    const result = await applyEventImageBranding({
      eventId: EVENT_ID,
      variant: 'print_poster',
      logo: cornerLogo(),
      qr: { centreXFrac: 0.5, centreYFrac: 0.8, widthFrac: 0.25 },
      userId: USER_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(422)
    expect(result.code).toBe('poster_link_blocked')
    expect(result.reason).toBe('event_cancelled')
    expect(result.error).toBe('"Quiz Night" is cancelled, so a poster must not be printed for it.')
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('fails visibly on a missing logo asset and leaves the live image alone', async () => {
    const seeded = await seedVariant('square')

    const result = await applyEventImageBranding({
      eventId: EVENT_ID,
      variant: 'square',
      logo: cornerLogo(),
      qr: null,
      userId: USER_ID,
      logoSources: {
        white: 'public/guest/anchor-logo-white-does-not-exist.png',
        black: 'public/guest/anchor-logo-black-does-not-exist.png',
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('logo_asset_missing')
    expect(result.status).toBe(422)

    // Nothing was published, so the live file is still the untouched upload.
    expect(db.rpcCalls).toHaveLength(0)
    expect(db.livePath('square')).toBe(seeded.path)
    expect(db.liveBytes('square').equals(seeded.bytes)).toBe(true)
    expect(db.findRow(EVENT_ID, 'square')?.original_storage_path).toBeNull()
    // The original copy this attempt made was taken back out again.
    for (const path of db.uploads) {
      expect(db.objects.has(path)).toBe(false)
    }
  })

  it('rejects a composite that came back a different size', async () => {
    const seeded = await seedVariant('square')
    hoisted.compositeOverride = async () => ({
      ok: true,
      buffer: await createImage(320, 320),
    })

    const result = await applyEventImageBranding({
      eventId: EVENT_ID,
      variant: 'square',
      logo: cornerLogo(),
      qr: null,
      userId: USER_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('output_invalid')
    expect(result.status).toBe(422)
    expect(result.error).toContain('400x400')
    expect(result.error).toContain('320x320')
    expect(db.rpcCalls).toHaveLength(0)
    expect(db.livePath('square')).toBe(seeded.path)
  })

  it('refuses artwork inherited from the category', async () => {
    db.objects.set('categories/quiz/default.png', await createImage(400, 400))
    db.rows.push({
      id: 'row-inherited',
      event_id: EVENT_ID,
      image_type: 'square',
      storage_path: 'categories/quiz/default.png',
      file_name: 'default.png',
      mime_type: 'image/png',
      file_size_bytes: 10,
      original_storage_path: null,
      logo_corner: null,
      logo_centre_x_frac: null,
      logo_centre_y_frac: null,
      logo_colour: null,
      logo_width_frac: null,
      qr_centre_x_frac: null,
      qr_centre_y_frac: null,
      qr_width_frac: null,
      qr_short_link_id: null,
    })

    const result = await applyEventImageBranding({
      eventId: EVENT_ID,
      variant: 'square',
      logo: cornerLogo(),
      qr: null,
      userId: USER_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('image_not_owned')
    expect(db.uploads).toHaveLength(0)
  })

  it('reports an event that does not exist', async () => {
    const result = await applyEventImageBranding({
      eventId: OTHER_EVENT_ID,
      variant: 'square',
      logo: cornerLogo(),
      qr: null,
      userId: USER_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('image_missing')
    expect(result.status).toBe(409)
  })

  it('puts the original back when the branding columns cannot be saved', async () => {
    await seedVariant('square')
    db.failUpdate = true

    const result = await applyEventImageBranding({
      eventId: EVENT_ID,
      variant: 'square',
      logo: cornerLogo(),
      qr: null,
      userId: USER_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('save_failed')
    // Leaving a branded image with no recorded original is the one state that
    // would let a later edit compound, so it rolls back instead.
    expect(db.livePath('square').includes('/branded/')).toBe(false)
    expect(db.findRow(EVENT_ID, 'square')?.original_storage_path).toBeNull()
  })
})

describe('revert', () => {
  it('restores the original byte for byte and clears every branding column', async () => {
    const seeded = await seedVariant('square', { format: 'jpeg' })

    const applied = expectOk(
      await applyEventImageBranding({
        eventId: EVENT_ID,
        variant: 'square',
        logo: cornerLogo('top_right', 'black'),
        qr: null,
        userId: USER_ID,
      })
    )
    const compositePath = applied.storagePath
    expect(db.liveBytes('square').equals(seeded.bytes)).toBe(false)

    const reverted = expectOk(
      await revertEventImageBranding({ eventId: EVENT_ID, variant: 'square', userId: USER_ID })
    )

    expect(reverted.branded).toBe(false)
    expect(reverted.storagePath).toBe(applied.originalStoragePath)
    expect(reverted.originalStoragePath).toBeNull()
    expect(db.liveBytes('square').equals(seeded.bytes)).toBe(true)
    expect(reverted.imageUrl).toBe(`${PUBLIC_PREFIX}${applied.originalStoragePath}`)

    // The composite is gone and the row carries no branding at all.
    expect(db.objects.has(compositePath)).toBe(false)
    const row = db.findRow(EVENT_ID, 'square')
    for (const column of BRANDING_COLUMNS) {
      expect(row?.[column]).toBeNull()
    }
    // The JPEG is recorded as a JPEG again, not as the composite's PNG.
    expect(row?.mime_type).toBe('image/jpeg')
  })

  it('re-brands cleanly after a revert', async () => {
    const seeded = await seedVariant('square')
    await applyEventImageBranding({
      eventId: EVENT_ID,
      variant: 'square',
      logo: cornerLogo(),
      qr: null,
      userId: USER_ID,
    })
    const firstBytes = Buffer.from(db.liveBytes('square'))

    await revertEventImageBranding({ eventId: EVENT_ID, variant: 'square', userId: USER_ID })
    expect(db.liveBytes('square').equals(seeded.bytes)).toBe(true)

    expectOk(
      await applyEventImageBranding({
        eventId: EVENT_ID,
        variant: 'square',
        logo: cornerLogo(),
        qr: null,
        userId: USER_ID,
      })
    )

    expect(db.liveBytes('square').equals(firstBytes)).toBe(true)
  })

  it('refuses when there is no branding to remove', async () => {
    await seedVariant('square')

    const result = await revertEventImageBranding({
      eventId: EVENT_ID,
      variant: 'square',
      userId: USER_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('nothing_to_revert')
    expect(result.status).toBe(409)
    expect(db.rpcCalls).toHaveLength(0)
  })
})

describe('audit', () => {
  it('records the placement that was applied and the one that was removed', async () => {
    await seedVariant('square')
    await applyEventImageBranding({
      eventId: EVENT_ID,
      variant: 'square',
      logo: cornerLogo('bottom_left'),
      qr: null,
      userId: USER_ID,
    })
    await revertEventImageBranding({ eventId: EVENT_ID, variant: 'square', userId: USER_ID })

    expect(hoisted.audits).toHaveLength(2)
    const [applied, reverted] = hoisted.audits
    expect(applied.resource_id).toBe(EVENT_ID)
    expect(applied.user_id).toBe(USER_ID)
    expect((applied.additional_info as Record<string, unknown>).action).toBe(
      'artwork_branding_applied'
    )
    expect((reverted.additional_info as Record<string, unknown>).action).toBe(
      'artwork_branding_reverted'
    )
  })
})

// ---------------------------------------------------------------------------
// The HTTP edge. Only what the route itself owns: permission, parsing and the
// response shape the placement editor builds against.
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/events/[id]/artwork/composite/route'

function request(body: unknown, eventId = EVENT_ID): Request {
  return new Request(`http://localhost/api/events/${eventId}/artwork/composite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function context(eventId = EVENT_ID) {
  return { params: Promise.resolve({ id: eventId }) }
}

describe('POST /api/events/[id]/artwork/composite', () => {
  it('returns 403 without touching storage when permission is refused', async () => {
    await seedVariant('square')
    const { NextResponse } = await import('next/server')
    hoisted.permission = {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }

    const response = await POST(
      request({ variant: 'square', logo: cornerLogo(), qr: null }) as never,
      context()
    )

    expect(response.status).toBe(403)
    expect(db.uploads).toHaveLength(0)
    expect(db.downloads).toHaveLength(0)
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('brands and then reverts, returning the shape the editor reads', async () => {
    await seedVariant('square')

    const applied = await POST(
      request({
        variant: 'square',
        logo: { placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.22 }, colour: 'white' },
        qr: null,
      }) as never,
      context()
    )
    expect(applied.status).toBe(200)
    const appliedBody = await applied.json()
    expect(appliedBody.success).toBe(true)
    expect(appliedBody.branded).toBe(true)
    expect(appliedBody.variant).toBe('square')
    expect(appliedBody.width).toBe(400)
    expect(appliedBody.height).toBe(400)
    expect(appliedBody.qr).toBeNull()
    expect(appliedBody.placementSaved).toBe(true)
    // `url` is what the placement editor swaps its preview to.
    expect(appliedBody.url.includes('/branded/')).toBe(true)
    expect(appliedBody.publicUrl).toBe(appliedBody.url)
    expect(hoisted.revalidated).toContain(`/events/${EVENT_ID}`)

    const reverted = await POST(
      request({ variant: 'square', action: 'revert' }) as never,
      context()
    )
    expect(reverted.status).toBe(200)
    const revertedBody = await reverted.json()
    expect(revertedBody.branded).toBe(false)
    expect(revertedBody.originalStoragePath).toBeNull()
  })

  it('saves a poster QR at exactly 10% through the HTTP route', async () => {
    await seedVariant('print_poster')
    const response = await POST(
      request({
        variant: 'print_poster',
        logo: null,
        qr: { centreXFrac: 0.5, centreYFrac: 0.5, widthFrac: 0.1 },
      }) as never,
      context()
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.placementSaved).toBe(true)
  })

  it('rejects a malformed placement with a stable code', async () => {
    const tooWide = await POST(
      request({
        variant: 'square',
        logo: { placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.9 }, colour: 'white' },
        qr: null,
      }) as never,
      context()
    )
    expect(tooWide.status).toBe(400)
    expect((await tooWide.json()).code).toBe('invalid_request')

    const tinyQr = await POST(
      request({
        variant: 'print_poster',
        logo: null,
        qr: { centreXFrac: 0.5, centreYFrac: 0.5, widthFrac: 0.09 },
      }) as never,
      context()
    )
    expect(tinyQr.status).toBe(400)

    const badId = await POST(
      request({ variant: 'square', logo: null, qr: null }, 'not-a-uuid') as never,
      context('not-a-uuid')
    )
    expect(badId.status).toBe(400)
    expect((await badId.json()).code).toBe('invalid_event_id')
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('surfaces a service refusal with its code and status', async () => {
    await seedVariant('story')

    const response = await POST(
      request({
        variant: 'story',
        logo: cornerLogo(),
        qr: { centreXFrac: 0.5, centreYFrac: 0.5, widthFrac: 0.25 },
      }) as never,
      context()
    )

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.code).toBe('qr_not_supported')
    expect(typeof body.error).toBe('string')
    // The editor shows `detail` verbatim, so it must carry the sentence too.
    expect(body.detail).toBe(body.error)
  })
})
