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
import { EVENT_MARKETING_CHANNELS } from '@/lib/event-marketing-links'

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

  it('only upserts always_on channels — does not touch on_demand channels', async () => {
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

    const alwaysOnKeys = EVENT_MARKETING_CHANNELS.filter(c => c.tier === 'always_on').map(c => c.key)
    const onDemandKeys = EVENT_MARKETING_CHANNELS.filter(c => c.tier === 'on_demand').map(c => c.key)

    expect(insertMock).toHaveBeenCalledTimes(alwaysOnKeys.length)
    onDemandKeys.forEach(key => {
      expect(insertMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ channel: key }) })
      )
    })
  })
})

describe('EventMarketingService.generateSingleLink', () => {
  beforeEach(() => vi.clearAllMocks())

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
