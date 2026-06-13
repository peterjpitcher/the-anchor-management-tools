import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(async (handler: (req: Request, apiKey: unknown) => Promise<Response>, _permissions: string[], req?: Request) =>
    handler(req || new Request('http://localhost/api/events/test'), { id: 'key-1' })
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json({ success: true, data }, { status })),
  createErrorResponse: vi.fn((message: string, code: string, status = 400) =>
    Response.json({ success: false, error: { code, message } }, { status })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { GET } from '@/app/api/events/[id]/route'

function buildSupabaseMock(options: {
  eventFound?: boolean
  messageTemplatesError?: { code?: string; message: string } | null
  messageTemplatesRows?: Array<{ template_type: string; content: string | null }>
  shortLinksRows?: Array<{
    short_code: string
    destination_url?: string | null
    updated_at: string | null
    metadata: { channel?: string | null } | null
  }>
}) {
  const eventFound = options.eventFound ?? true
  const eventRow = eventFound
    ? {
        id: 'evt-1',
        slug: 'karaoke-2026-02-27',
        name: 'Karaoke',
        brief: 'Short event brief',
        category_id: null,
        date: '2026-02-27',
        time: '20:00',
        event_status: 'scheduled',
        booking_url: null,
        price: 0,
        price_per_seat: null,
        is_free: true,
        capacity: null,
        performer_name: null,
        performer_type: null,
        highlights: [],
        keywords: [],
        short_description: null,
        long_description: null,
        meta_title: null,
        meta_description: null,
        hero_image_url: null,
        image_url: null,
        thumbnail_image_url: null,
        poster_image_url: null,
        gallery_image_urls: [],
        promo_video_url: null,
        highlight_video_urls: [],
        last_entry_time: null,
        updated_at: '2026-02-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
      }
    : null

  const eventMaybeSingle = vi.fn(async () => ({
    data: eventRow,
    error: null,
  }))
  const eventEq = vi.fn((_column: string, _value: string) => ({
    maybeSingle: eventMaybeSingle,
  }))
  const eventSelect = vi.fn(() => ({
    eq: eventEq,
  }))

  const categoryMaybeSingle = vi.fn(async () => ({ data: null, error: null }))
  const categoryEq = vi.fn(() => ({ maybeSingle: categoryMaybeSingle }))
  const categorySelect = vi.fn(() => ({ eq: categoryEq }))

  const faqOrder = vi.fn(async () => ({ data: [], error: null }))
  const faqEq = vi.fn(() => ({ order: faqOrder }))
  const faqSelect = vi.fn(() => ({ eq: faqEq }))

  const messageTemplatesEq = vi.fn(async () => ({
    data: options.messageTemplatesRows ?? [],
    error: options.messageTemplatesError ?? null,
  }))
  const messageTemplatesSelect = vi.fn(() => ({ eq: messageTemplatesEq }))

  const shortLinksContains = vi.fn(async () => ({
    data: options.shortLinksRows ?? [],
    error: null,
  }))
  const shortLinksSelect = vi.fn(() => ({ contains: shortLinksContains }))

  const rpc = vi.fn(async () => ({ data: [], error: null }))

  return {
    from: vi.fn((table: string) => {
      if (table === 'events') return { select: eventSelect }
      if (table === 'event_categories') return { select: categorySelect }
      if (table === 'event_faqs') return { select: faqSelect }
      if (table === 'event_message_templates') return { select: messageTemplatesSelect }
      if (table === 'short_links') return { select: shortLinksSelect }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc,
  }
}

describe('events detail route resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 detail payload when event_message_templates query errors', async () => {
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(
      buildSupabaseMock({
        messageTemplatesError: { code: '42703', message: 'column event_message_templates.custom_content does not exist' },
      })
    )

    const response = await GET(new Request('http://localhost/api/events/evt-1') as any, {
      params: Promise.resolve({ id: 'evt-1' }),
    })

    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.id).toBe('evt-1')
    expect(payload.data.brief).toBe('Short event brief')
    expect(payload.data.custom_messages).toEqual({})
  })

  it('maps template content into custom_messages', async () => {
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(
      buildSupabaseMock({
        messageTemplatesRows: [
          { template_type: 'announcement', content: 'Doors open at 8pm' },
          { template_type: 'last_call', content: null },
        ],
      })
    )

    const response = await GET(new Request('http://localhost/api/events/evt-1') as any, {
      params: Promise.resolve({ id: 'evt-1' }),
    })

    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.data.custom_messages).toEqual({
      announcement: 'Doors open at 8pm',
      last_call: null,
    })
  })

  it('returns 404 when event is not found', async () => {
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(
      buildSupabaseMock({
        eventFound: false,
      })
    )

    const response = await GET(new Request('http://localhost/api/events/missing') as any, {
      params: Promise.resolve({ id: 'missing' }),
    })

    const payload = await response.json()
    expect(response.status).toBe(404)
    expect(payload).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Event not found',
      },
    })
  })

  it('returns facebook/link-in-bio shortlinks when available', async () => {
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(
      buildSupabaseMock({
        shortLinksRows: [
          {
            short_code: 'fbabc1',
            updated_at: '2026-02-10T10:00:00.000Z',
            metadata: { channel: 'facebook' },
          },
          {
            short_code: 'igabc1',
            updated_at: '2026-02-11T10:00:00.000Z',
            metadata: { channel: 'lnk_bio' },
          },
          {
            short_code: 'maabc1',
            updated_at: '2026-02-12T10:00:00.000Z',
            metadata: { channel: 'meta_ads' },
          },
          {
            short_code: 'gpabc1',
            destination_url: 'https://www.the-anchor.pub/events/karaoke?utm_source=google',
            updated_at: '2026-02-13T10:00:00.000Z',
            metadata: { channel: 'google_business_profile' },
          },
          {
            short_code: 'gcabc1',
            destination_url: 'https://www.the-anchor.pub/events/karaoke?utm_source=game_sheet',
            updated_at: '2026-02-14T10:00:00.000Z',
            metadata: { channel: 'game_sheet' },
          },
          {
            short_code: 'scabc1',
            destination_url: 'https://www.the-anchor.pub/events/karaoke?utm_source=in_game_screen',
            updated_at: '2026-02-15T10:00:00.000Z',
            metadata: { channel: 'in_game_screen' },
          },
        ],
      })
    )

    const response = await GET(new Request('http://localhost/api/events/evt-1') as any, {
      params: Promise.resolve({ id: 'evt-1' }),
    })
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.data.facebookShortLink).toBe('https://l.the-anchor.pub/fbabc1')
    expect(payload.data.facebook_short_link).toBe('https://l.the-anchor.pub/fbabc1')
    expect(payload.data.linkInBioShortLink).toBe('https://l.the-anchor.pub/igabc1')
    expect(payload.data.link_in_bio_short_link).toBe('https://l.the-anchor.pub/igabc1')
    expect(payload.data.googleBusinessProfileShortLink).toBe('https://l.the-anchor.pub/gpabc1')
    expect(payload.data.google_business_profile_short_link).toBe('https://l.the-anchor.pub/gpabc1')
    expect(payload.data.metaAdsShortLink).toBe('https://l.the-anchor.pub/maabc1')
    expect(payload.data.meta_ads_short_link).toBe('https://l.the-anchor.pub/maabc1')
    expect(payload.data.gameSheetShortLink).toBe('https://l.the-anchor.pub/gcabc1')
    expect(payload.data.game_sheet_short_link).toBe('https://l.the-anchor.pub/gcabc1')
    expect(payload.data.inGameScreenShortLink).toBe('https://l.the-anchor.pub/scabc1')
    expect(payload.data.in_game_screen_short_link).toBe('https://l.the-anchor.pub/scabc1')
    expect(payload.data.marketing_short_links).toMatchObject({
      facebook: 'https://l.the-anchor.pub/fbabc1',
      game_sheet: 'https://l.the-anchor.pub/gcabc1',
      in_game_screen: 'https://l.the-anchor.pub/scabc1',
    })
    expect(payload.data.qr_short_links).toMatchObject({
      game_sheet: 'https://l.the-anchor.pub/gcabc1',
      in_game_screen: 'https://l.the-anchor.pub/scabc1',
    })
    expect(payload.data.ctaLinks).toMatchObject({
      facebook: 'https://l.the-anchor.pub/fbabc1',
      instagram: 'https://l.the-anchor.pub/igabc1',
      google_business_profile: 'https://l.the-anchor.pub/gpabc1',
      gbp: 'https://l.the-anchor.pub/gpabc1',
      meta_ads: 'https://l.the-anchor.pub/maabc1',
      game_sheet: 'https://l.the-anchor.pub/gcabc1',
      in_game_screen: 'https://l.the-anchor.pub/scabc1',
    })
  })
})
