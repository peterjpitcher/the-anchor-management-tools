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

describe('EventMarketingService.getSentMessages', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('loads sent marketing SMS rows from promo context with message bodies and recipients', async () => {
    const promoRows = [
      {
        id: 'promo-1',
        customer_id: 'customer-1',
        phone_number: '+447700900001',
        event_id: 'event-1',
        template_key: 'event_cross_promo_14d',
        message_id: 'message-1',
        created_at: '2026-04-10T10:00:00.000Z',
      },
    ]
    const messageRows = [
      {
        id: 'message-1',
        customer_id: 'customer-1',
        body: 'The Anchor: Sarah! Music Bingo is coming up.',
        status: 'sent',
        twilio_status: 'queued',
        sent_at: '2026-04-10T10:00:05.000Z',
        created_at: '2026-04-10T10:00:05.000Z',
        to_number: '+447700900001',
        template_key: 'event_cross_promo_14d',
        message_sid: 'SM123',
      },
    ]
    const customerRows = [
      {
        id: 'customer-1',
        first_name: 'Sarah',
        last_name: 'Jones',
        mobile_number: '07700 900001',
        mobile_e164: '+447700900001',
      },
    ]

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'sms_promo_context') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: promoRows, error: null }),
                }),
              }),
            }),
          }
        }

        if (table === 'messages') {
          return {
            select: vi.fn((columns: string) => {
              if (columns.includes('metadata')) {
                return {
                  eq: vi.fn().mockReturnValue({
                    contains: vi.fn().mockReturnValue({
                      order: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                      }),
                    }),
                  }),
                }
              }

              return {
                in: vi.fn().mockResolvedValue({ data: messageRows, error: null }),
              }
            }),
          }
        }

        if (table === 'customers') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: customerRows, error: null }),
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    mockedCreateAdminClient.mockReturnValue(client)

    const result = await EventMarketingService.getSentMessages('event-1')

    expect(result).toEqual([
      expect.objectContaining({
        id: 'promo-1',
        messageId: 'message-1',
        customerName: 'Sarah Jones',
        recipientPhone: '+447700900001',
        templateKey: 'event_cross_promo_14d',
        body: 'The Anchor: Sarah! Music Bingo is coming up.',
        status: 'queued',
        sentAt: '2026-04-10T10:00:05.000Z',
      }),
    ])
  })

  it('includes metadata-tagged bulk campaigns when the messages metadata column is available', async () => {
    const metadataMessageRows = [
      {
        id: 'message-2',
        customer_id: 'customer-2',
        body: 'The Anchor: New event this Friday.',
        status: 'sent',
        twilio_status: 'sent',
        sent_at: '2026-04-11T10:00:00.000Z',
        created_at: '2026-04-11T10:00:00.000Z',
        to_number: '+447700900002',
        template_key: 'bulk_sms_campaign',
        message_sid: 'SM456',
        metadata: {
          event_id: 'event-1',
          bulk_sms: true,
          template_key: 'bulk_sms_campaign',
        },
      },
    ]

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'sms_promo_context') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }
        }

        if (table === 'messages') {
          return {
            select: vi.fn((columns: string) => {
              if (!columns.includes('metadata')) {
                return {
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }
              }

              return {
                eq: vi.fn().mockReturnValue({
                  contains: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({ data: metadataMessageRows, error: null }),
                    }),
                  }),
                }),
              }
            }),
          }
        }

        if (table === 'customers') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    mockedCreateAdminClient.mockReturnValue(client)

    const result = await EventMarketingService.getSentMessages('event-1')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'message-2',
      messageId: 'message-2',
      templateKey: 'bulk_sms_campaign',
      body: 'The Anchor: New event this Friday.',
      recipientPhone: '+447700900002',
    })
  })
})
