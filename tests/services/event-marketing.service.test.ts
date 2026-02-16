import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { EVENT_MARKETING_CHANNELS, buildEventMarketingLinkPayload } from '@/lib/event-marketing-links'
import { EventMarketingService } from '@/services/event-marketing'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('EventMarketingService mutation guards', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('recreates a short link when an update affects no rows after prefetch', async () => {
    const event = {
      id: 'event-1',
      slug: 'spring-party',
      name: 'Spring Party',
      date: '2026-04-19',
    }

    const existingLinks = EVENT_MARKETING_CHANNELS.map((channel) => {
      const payload = buildEventMarketingLinkPayload(event, channel)
      return {
        id: `link-${channel.key}`,
        short_code: payload.shortCode,
        destination_url: payload.destinationUrl,
        metadata: {
          event_id: event.id,
          channel: payload.channel,
          utm: payload.utm,
        },
        updated_at: null,
      }
    })

    // Force one channel to require an update.
    existingLinks[0].destination_url = 'https://stale.example.com'
    const staleChannelKey = EVENT_MARKETING_CHANNELS[0].key

    const eventSingle = vi.fn().mockResolvedValue({ data: event, error: null })
    const eventEq = vi.fn().mockReturnValue({ single: eventSingle })

    const linksContains = vi.fn().mockResolvedValue({ data: existingLinks, error: null })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const insertedLink = {
      id: `new-${staleChannelKey}`,
      short_code: 'new-short-code',
      destination_url: 'https://www.the-anchor.pub/events/spring-party',
      metadata: {
        event_id: event.id,
        channel: staleChannelKey,
        utm: {},
      },
      updated_at: null,
    }
    const insertSingle = vi.fn().mockResolvedValue({ data: insertedLink, error: null })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return {
            select: vi.fn().mockReturnValue({ eq: eventEq }),
          }
        }

        if (table === 'short_links') {
          return {
            select: vi.fn().mockReturnValue({ contains: linksContains }),
            update,
            insert,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    mockedCreateAdminClient.mockReturnValue(client)
    vi.spyOn(EventMarketingService, 'getLinks').mockResolvedValue([])

    await EventMarketingService.generateLinks(event.id)

    expect(update).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          event_id: event.id,
          channel: staleChannelKey,
        }),
      })
    )
  })
})
