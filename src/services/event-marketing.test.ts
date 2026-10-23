import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock admin client
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

// Mock qrcode
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mock') },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { EventMarketingService } from './event-marketing'
import { EVENT_MARKETING_CHANNELS, isEventMarketingQrChannel, shouldAutoGenerateEventMarketingChannel } from '@/lib/event-marketing-links'

const mockEvent = {
  id: 'evt-123456',
  slug: 'test-event',
  name: 'Test Event',
  date: '2026-04-01',
}

function makeSupabaseMock(overrides: Record<string, unknown> = {}) {
  const chainable = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: mockEvent, error: null }),
    contains: vi.fn().mockResolvedValue({ data: [], error: null }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn().mockReturnThis(),
    ...overrides,
  }
  chainable.from = vi.fn().mockReturnValue(chainable)
  return chainable
}

describe('EventMarketingService.generateLinks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('meta_ads channel has correct UTM config', () => {
    const metaAds = EVENT_MARKETING_CHANNELS.find(c => c.key === 'meta_ads')
    expect(metaAds).toBeDefined()
    expect(metaAds!.utmSource).toBe('facebook')
    expect(metaAds!.utmMedium).toBe('paid_social')
    expect(metaAds!.utmContent).toBe('meta_ads_main')
    expect(metaAds!.shortCodePrefix).toBe('ma')
    expect(metaAds!.tier).toBe('always_on')
  })

  it('upserts always-on and QR placement channels, but not optional digital channels', async () => {
    const insertedChannels: string[] = []

    const insertMock = vi.fn().mockImplementation((row: any) => {
      if (row?.metadata?.channel) insertedChannels.push(row.metadata.channel)
      return {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'sl-x',
            short_code: 'xx123456',
            destination_url: 'https://x',
            metadata: { channel: row?.metadata?.channel, utm: {} },
            updated_at: null,
          },
          error: null,
        }),
      }
    })

    const supabaseMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockEvent, error: null }),
      contains: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: insertMock,
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    await EventMarketingService.generateLinks(mockEvent.id)

    const generatedKeys = EVENT_MARKETING_CHANNELS.filter(shouldAutoGenerateEventMarketingChannel).map(c => c.key)
    const optionalDigitalKeys = EVENT_MARKETING_CHANNELS
      .filter(c => c.tier === 'on_demand' && !isEventMarketingQrChannel(c))
      .map(c => c.key)

    expect(insertMock).toHaveBeenCalledTimes(generatedKeys.length)
    generatedKeys.forEach(key => {
      expect(insertedChannels).toContain(key)
    })
    optionalDigitalKeys.forEach(key => {
      expect(insertMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ channel: key }) })
      )
    })
  })

  it('never repoints a per-ad variant as if it were the event link', async () => {
    const variant = {
      id: 'sl-variant',
      short_code: 'mv0001',
      destination_url: 'https://www.the-anchor.pub/events/test-event?utm_source=facebook&utm_content=ad_one',
      metadata: { event_id: mockEvent.id, channel: 'meta_ads', utm_variant: true, utm_content: 'ad_one' },
      updated_at: null,
    }
    const insertMock = vi.fn().mockImplementation((row: any) => ({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'sl-new', short_code: 'xx123456', destination_url: 'https://x', metadata: { channel: row?.metadata?.channel, utm: {} }, updated_at: null },
        error: null,
      }),
    }))
    const updateMock = vi.fn().mockReturnThis()
    const supabaseMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockEvent, error: null }),
      contains: vi.fn().mockResolvedValue({ data: [variant], error: null }),
      insert: insertMock,
      update: updateMock,
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    await EventMarketingService.generateLinks(mockEvent.id)

    expect(updateMock).not.toHaveBeenCalled()
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ channel: 'meta_ads' }) })
    )
  })
})

describe('EventMarketingService.generateSingleLink', () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the event's own link, never a per-post variant of it", async () => {
    const variant = { id: 'sl-v', short_code: 'fp0001', destination_url: 'https://www.the-anchor.pub/events/test-event?utm_content=cheers_post_1', metadata: { event_id: mockEvent.id, channel: 'facebook', utm_variant: true }, updated_at: null }
    const own = { id: 'sl-1', short_code: 'fb123456', destination_url: 'https://www.the-anchor.pub/events/test-event?utm_source=facebook', metadata: { event_id: mockEvent.id, channel: 'facebook', utm: {} }, updated_at: null }
    const insert = vi.fn()
    const supabaseMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({ data: mockEvent, error: null }),
      contains: vi.fn().mockResolvedValue({ data: [variant, own], error: null }),
      insert,
    }
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    const result = await EventMarketingService.generateSingleLink(mockEvent.id, 'facebook')

    expect(result.shortCode).toBe('fb123456')
    expect(insert).not.toHaveBeenCalled()
  })

  it("makes the event's own link when only variants exist", async () => {
    const variant = { id: 'sl-v', short_code: 'mv0001', destination_url: 'https://www.the-anchor.pub/events/test-event?utm_content=ad_one', metadata: { event_id: mockEvent.id, channel: 'meta_ads', utm_variant: true }, updated_at: null }
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'sl-2', short_code: 'ma654321', destination_url: 'https://www.the-anchor.pub/events/test-event?utm_source=facebook&utm_medium=paid_social', metadata: { event_id: mockEvent.id, channel: 'meta_ads', utm: {} }, updated_at: null },
        error: null,
      }),
    })
    const supabaseMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({ data: mockEvent, error: null }),
      contains: vi.fn().mockResolvedValue({ data: [variant], error: null }),
      insert,
    }
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    const result = await EventMarketingService.generateSingleLink(mockEvent.id, 'meta_ads')

    expect(insert).toHaveBeenCalledOnce()
    expect(result.shortCode).toBe('ma654321')
  })

  it('returns a link for a valid on_demand channel', async () => {
    const supabaseMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn()
        .mockResolvedValueOnce({ data: mockEvent, error: null })
        .mockResolvedValueOnce({
          data: {
            id: 'sl-1',
            short_code: 'nl123456',
            destination_url: 'https://www.the-anchor.pub/events/test-event?utm_source=newsletter',
            metadata: { event_id: mockEvent.id, channel: 'newsletter', utm: {} },
            updated_at: null,
          },
          error: null,
        }),
      contains: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    const result = await EventMarketingService.generateSingleLink(mockEvent.id, 'newsletter')

    expect(result.channel).toBe('newsletter')
    expect(result.shortCode).toMatch(/^nl/)
    expect(result.type).toBe('digital')
    expect(result.qrCode).toBeUndefined()
  })

  it('includes qrCode for print channels', async () => {
    const supabaseMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn()
        .mockResolvedValueOnce({ data: mockEvent, error: null })
        .mockResolvedValueOnce({
          data: {
            id: 'sl-2',
            short_code: 'po123456',
            destination_url: 'https://www.the-anchor.pub/events/test-event?utm_source=poster',
            metadata: { event_id: mockEvent.id, channel: 'poster', utm: {} },
            updated_at: null,
          },
          error: null,
        }),
      contains: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    const result = await EventMarketingService.generateSingleLink(mockEvent.id, 'poster')

    expect(result.channel).toBe('poster')
    expect(result.type).toBe('print')
    expect(result.qrCode).toBe('data:image/png;base64,mock')
  })

  it('includes qrCode for screen channels', async () => {
    const supabaseMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn()
        .mockResolvedValueOnce({ data: mockEvent, error: null })
        .mockResolvedValueOnce({
          data: {
            id: 'sl-3',
            short_code: 'sc123456',
            destination_url: 'https://www.the-anchor.pub/events/test-event?utm_source=in_game_screen',
            metadata: { event_id: mockEvent.id, channel: 'in_game_screen', utm: {} },
            updated_at: null,
          },
          error: null,
        }),
      contains: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    const result = await EventMarketingService.generateSingleLink(mockEvent.id, 'in_game_screen')

    expect(result.channel).toBe('in_game_screen')
    expect(result.type).toBe('screen')
    expect(result.qrCode).toBe('data:image/png;base64,mock')
  })

  it('throws if channel key does not exist in config', async () => {
    const supabaseMock = makeSupabaseMock()
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    await expect(
      EventMarketingService.generateSingleLink(mockEvent.id, 'unknown_channel' as any)
    ).rejects.toThrow()
  })

  it('throws if event is not found', async () => {
    const supabaseMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'not found' } }),
      contains: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    await expect(
      EventMarketingService.generateSingleLink(mockEvent.id, 'newsletter')
    ).rejects.toThrow('Event not found')
  })
})
