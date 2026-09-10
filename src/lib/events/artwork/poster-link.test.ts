import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EVENT_MARKETING_CHANNEL_MAP,
  buildEventMarketingLinkPayload,
  type EventMarketingChannelKey,
} from '@/lib/event-marketing-links'

const EVENT_ID = '11111111-2222-3333-4444-555555555555'

/**
 * Written out in full rather than derived, so this test fails loudly if the
 * module ever resolves a different channel. `partner_poster` would give
 * utm_source=partner_poster and utm_content=partner_poster_qr, `toilet_poster`
 * the toilet equivalents. All three are print posters; only one is ours.
 */
const CORRECT_DESTINATION =
  'https://www.the-anchor.pub/events/quiz-night' +
  '?utm_source=poster&utm_medium=print&utm_campaign=event-quiz-night' +
  '&utm_content=poster_qr&utm_term=poster'

/** prefix `po` plus the first six hex characters of the event id. */
const CORRECT_SHORT_CODE = 'po111111'

const STALE_DESTINATION =
  'https://www.the-anchor.pub/events/old-quiz-name' +
  '?utm_source=poster&utm_medium=print&utm_campaign=event-old-quiz-name' +
  '&utm_content=poster_qr&utm_term=poster'

interface FakeLink {
  id: string
  channel: string
  label: string
  type: string
  shortCode: string
  shortUrl: string
  destinationUrl: string
  utm: Record<string, string>
  clickCount: number
}

const defaultEvent = () => ({
  id: EVENT_ID,
  slug: 'quiz-night',
  name: 'Quiz Night',
  date: '2026-10-01',
  event_status: 'scheduled',
})

const state = {
  event: defaultEvent() as Record<string, unknown> | null,
  eventError: null as unknown,
  updateResult: {
    data: {
      id: 'link-1',
      short_code: CORRECT_SHORT_CODE,
      destination_url: CORRECT_DESTINATION,
    } as Record<string, unknown> | null,
    error: null as unknown,
  },
  updates: [] as Array<{ table: string; id: string; payload: Record<string, unknown> }>,
}

const marketing = {
  generateSingleLink: vi.fn(),
}

const audit = {
  logAuditEvent: vi.fn(),
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.event, error: state.eventError }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: (_column: string, id: string) => ({
          select: () => ({
            maybeSingle: async () => {
              state.updates.push({ table, id, payload })
              return state.updateResult
            },
          }),
        }),
      }),
    }),
  })),
}))

vi.mock('@/services/event-marketing', () => ({
  EventMarketingService: {
    generateSingleLink: (eventId: string, channel: string) =>
      marketing.generateSingleLink(eventId, channel),
  },
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: (params: unknown) => audit.logAuditEvent(params),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { POSTER_LINK_CHANNEL, resolvePosterLink, resolvePrintLink } from './poster-link'

/**
 * Builds the link `generateSingleLink` would return for whichever channel it
 * was actually asked for. Deriving the fake from the argument is what makes the
 * wrong-channel tests real: ask for `partner_poster` and you get a `pp` code
 * pointing at a partner_poster campaign, exactly as production would.
 */
function fakeLinkFor(channelKey: string, overrides: Partial<FakeLink> = {}): FakeLink {
  const config = EVENT_MARKETING_CHANNEL_MAP.get(channelKey as EventMarketingChannelKey)
  if (!config) {
    throw new Error(`Test asked for an unknown channel: ${channelKey}`)
  }
  const payload = buildEventMarketingLinkPayload(
    { id: EVENT_ID, slug: 'quiz-night', name: 'Quiz Night', date: '2026-10-01' },
    config
  )
  return {
    id: 'link-1',
    channel: config.key,
    label: config.label,
    type: config.type,
    shortCode: payload.shortCode,
    shortUrl: `https://l.the-anchor.pub/${payload.shortCode}`,
    destinationUrl: payload.destinationUrl,
    utm: payload.utm,
    clickCount: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  state.event = defaultEvent()
  state.eventError = null
  state.updates = []
  state.updateResult = {
    data: {
      id: 'link-1',
      short_code: CORRECT_SHORT_CODE,
      destination_url: CORRECT_DESTINATION,
    },
    error: null,
  }
  marketing.generateSingleLink.mockImplementation(async (_eventId: string, channel: string) =>
    fakeLinkFor(channel)
  )
  audit.logAuditEvent.mockResolvedValue(undefined)
})

describe('resolvePosterLink, channel', () => {
  it('uses the poster channel and no other print poster surface', async () => {
    await resolvePosterLink(EVENT_ID)

    expect(POSTER_LINK_CHANNEL).toBe('poster')
    expect(marketing.generateSingleLink).toHaveBeenCalledTimes(1)
    expect(marketing.generateSingleLink).toHaveBeenCalledWith(EVENT_ID, 'poster')
    expect(marketing.generateSingleLink).not.toHaveBeenCalledWith(EVENT_ID, 'partner_poster')
    expect(marketing.generateSingleLink).not.toHaveBeenCalledWith(EVENT_ID, 'toilet_poster')
  })

  it('resolves a po short code and a poster destination, not pp or tp', async () => {
    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.shortCode).toBe(CORRECT_SHORT_CODE)
    expect(result.shortCode.startsWith('po')).toBe(true)
    expect(result.shortCode.startsWith('pp')).toBe(false)
    expect(result.shortCode.startsWith('tp')).toBe(false)
    expect(result.destinationUrl).toBe(CORRECT_DESTINATION)
    expect(result.shortUrl).toBe(`https://l.the-anchor.pub/${CORRECT_SHORT_CODE}`)
  })

  it('refuses a link that comes back on the wrong channel', async () => {
    marketing.generateSingleLink.mockResolvedValue(fakeLinkFor('partner_poster'))

    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('link_unavailable')
    expect(state.updates).toHaveLength(0)
  })
})

describe('resolvePosterLink, a healthy link', () => {
  it('returns the existing link untouched when the destination is correct', async () => {
    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.wasRepaired).toBe(false)
    expect(result.shortLinkId).toBe('link-1')
    expect(result.destinationUrl).toBe(CORRECT_DESTINATION)
    expect(state.updates).toHaveLength(0)
    expect(audit.logAuditEvent).not.toHaveBeenCalled()
  })
})

describe('resolvePosterLink, repair', () => {
  it('repairs a stale destination while keeping the printed short code', async () => {
    marketing.generateSingleLink.mockResolvedValue(
      fakeLinkFor('poster', {
        destinationUrl: STALE_DESTINATION,
        utm: {
          utm_source: 'poster',
          utm_medium: 'print',
          utm_campaign: 'event-old-quiz-name',
          utm_content: 'poster_qr',
          utm_term: 'poster',
        },
      })
    )

    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.wasRepaired).toBe(true)
    expect(result.destinationUrl).toBe(CORRECT_DESTINATION)

    // The whole approach rests on this: the code is derived from the event id,
    // so repairing the destination keeps every already-printed poster working.
    expect(result.shortCode).toBe(CORRECT_SHORT_CODE)
    expect(result.shortUrl).toBe(`https://l.the-anchor.pub/${CORRECT_SHORT_CODE}`)

    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].table).toBe('short_links')
    expect(state.updates[0].id).toBe('link-1')
    expect(state.updates[0].payload.destination_url).toBe(CORRECT_DESTINATION)
    expect(state.updates[0].payload).not.toHaveProperty('short_code')
    expect(state.updates[0].payload.metadata).toMatchObject({
      event_id: EVENT_ID,
      channel: 'poster',
      event_slug: 'quiz-night',
      utm: expect.objectContaining({ utm_campaign: 'event-quiz-night' }),
    })
  })

  it('writes the repair with the admin client', async () => {
    marketing.generateSingleLink.mockResolvedValue(
      fakeLinkFor('poster', { destinationUrl: STALE_DESTINATION })
    )

    await resolvePosterLink(EVENT_ID)

    // short_links is service-role-write-only in production, so the write must
    // come from the admin client and nowhere else.
    expect(vi.mocked(createAdminClient)).toHaveBeenCalled()
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].table).toBe('short_links')
  })

  it('audits the repair, because it moves an already-printed code', async () => {
    marketing.generateSingleLink.mockResolvedValue(
      fakeLinkFor('poster', { destinationUrl: STALE_DESTINATION })
    )

    await resolvePosterLink(EVENT_ID)

    expect(audit.logAuditEvent).toHaveBeenCalledTimes(1)
    expect(audit.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'update',
        resource_type: 'short_link',
        resource_id: 'link-1',
        operation_status: 'success',
        old_values: expect.objectContaining({ destination_url: STALE_DESTINATION }),
        new_values: expect.objectContaining({ destination_url: CORRECT_DESTINATION }),
        additional_info: expect.objectContaining({
          event_id: EVENT_ID,
          channel: 'poster',
          short_code: CORRECT_SHORT_CODE,
        }),
      })
    )
  })

  it('repairs a link whose UTM campaign is stale even when the path matches', async () => {
    marketing.generateSingleLink.mockResolvedValue(
      fakeLinkFor('poster', {
        utm: {
          utm_source: 'poster',
          utm_medium: 'print',
          utm_campaign: 'event-old-quiz-name',
          utm_content: 'poster_qr',
          utm_term: 'poster',
        },
      })
    )

    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.wasRepaired).toBe(true)
    expect(state.updates).toHaveLength(1)
  })
})

describe('resolvePosterLink, blocked', () => {
  it('blocks an event with no slug', async () => {
    state.event = { ...defaultEvent(), slug: null }

    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('no_slug')
    expect(result.detail).toContain('slug')
    expect(marketing.generateSingleLink).not.toHaveBeenCalled()
    expect(state.updates).toHaveLength(0)
  })

  it('blocks a cancelled event', async () => {
    state.event = { ...defaultEvent(), event_status: 'cancelled' }

    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('event_cancelled')
    expect(marketing.generateSingleLink).not.toHaveBeenCalled()
  })

  it('blocks a draft event', async () => {
    state.event = { ...defaultEvent(), event_status: 'draft' }

    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('event_unpublished')
    expect(marketing.generateSingleLink).not.toHaveBeenCalled()
  })

  it('blocks, rather than throws, when the link cannot be got or created', async () => {
    marketing.generateSingleLink.mockRejectedValue(new Error('short code collision'))

    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('link_unavailable')
  })

  it('blocks when the event cannot be loaded', async () => {
    state.event = null

    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('link_unavailable')
  })
})

describe('resolvePosterLink, a failed repair', () => {
  it('never returns a stale link as ok when the write errors', async () => {
    marketing.generateSingleLink.mockResolvedValue(
      fakeLinkFor('poster', { destinationUrl: STALE_DESTINATION })
    )
    state.updateResult = { data: null, error: { message: 'permission denied' } }

    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('repair_failed')
  })

  it('blocks when the update matches no row', async () => {
    marketing.generateSingleLink.mockResolvedValue(
      fakeLinkFor('poster', { destinationUrl: STALE_DESTINATION })
    )
    state.updateResult = { data: null, error: null }

    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('repair_failed')
    expect(audit.logAuditEvent).not.toHaveBeenCalled()
  })

  it('blocks if the short code changed under the repair', async () => {
    marketing.generateSingleLink.mockResolvedValue(
      fakeLinkFor('poster', { destinationUrl: STALE_DESTINATION })
    )
    state.updateResult = {
      data: { id: 'link-1', short_code: 'po999999', destination_url: CORRECT_DESTINATION },
      error: null,
    }

    const result = await resolvePosterLink(EVENT_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('repair_failed')
  })
})

describe('resolvePrintLink, the table talker', () => {
  /** prefix `tt` plus the first six hex characters of the event id. */
  const TABLE_TALKER_CODE = 'tt111111'

  it('asks for the table_talker channel and never the poster one', async () => {
    const result = await resolvePrintLink(EVENT_ID, 'table_talker')

    expect(marketing.generateSingleLink).toHaveBeenCalledTimes(1)
    expect(marketing.generateSingleLink).toHaveBeenCalledWith(EVENT_ID, 'table_talker')
    expect(marketing.generateSingleLink).not.toHaveBeenCalledWith(EVENT_ID, 'poster')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.shortCode).toBe(TABLE_TALKER_CODE)
    expect(result.destinationUrl).toContain('utm_source=table_talker')
    expect(result.destinationUrl).not.toContain('utm_source=poster')
  })

  it('refuses a poster code handed back for a table talker', async () => {
    // Scans from a table must not be counted as poster scans.
    marketing.generateSingleLink.mockResolvedValue(fakeLinkFor('poster'))

    const result = await resolvePrintLink(EVENT_ID, 'table_talker')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('link_unavailable')
    expect(result.detail).toBe(
      'The short link returned for "Quiz Night" is not a table talker link, so it must not go on printed artwork.'
    )
    expect(state.updates).toHaveLength(0)
  })

  it('names the table talker, not the poster, when it blocks', async () => {
    state.event = { ...defaultEvent(), event_status: 'cancelled' }

    const result = await resolvePrintLink(EVENT_ID, 'table_talker')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.detail).toBe('"Quiz Night" is cancelled, so a table talker must not be printed for it.')
  })

  it('repairs a stale table talker link in place and audits it under its own channel', async () => {
    marketing.generateSingleLink.mockResolvedValue(
      fakeLinkFor('table_talker', { destinationUrl: 'https://www.the-anchor.pub/events/old-quiz-name' })
    )
    state.updateResult = {
      data: {
        id: 'link-1',
        short_code: TABLE_TALKER_CODE,
        destination_url: fakeLinkFor('table_talker').destinationUrl,
      },
      error: null,
    }

    const result = await resolvePrintLink(EVENT_ID, 'table_talker')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.wasRepaired).toBe(true)
    expect(result.shortCode).toBe(TABLE_TALKER_CODE)
    expect(state.updates[0]?.payload).not.toHaveProperty('short_code')
    expect(audit.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        additional_info: expect.objectContaining({
          reason: 'table_talker_artwork_link_repair',
          channel: 'table_talker',
          short_code: TABLE_TALKER_CODE,
        }),
      })
    )
  })
})

describe('resolvePosterLink, wording is unchanged by the table talker', () => {
  // The poster's sentences are read by managers and were settled before print
  // surfaces were generalised. Pinned word for word so the generalisation
  // cannot quietly reword them.
  it('keeps the cancelled sentence', async () => {
    state.event = { ...defaultEvent(), event_status: 'cancelled' }
    const result = await resolvePosterLink(EVENT_ID)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.detail).toBe('"Quiz Night" is cancelled, so a poster must not be printed for it.')
  })

  it('keeps the draft sentence', async () => {
    state.event = { ...defaultEvent(), event_status: 'draft' }
    const result = await resolvePosterLink(EVENT_ID)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.detail).toBe(
      '"Quiz Night" is still a draft, so its web page does not exist yet. Publish the event, then generate the poster again.'
    )
  })

  it('keeps the audit reason', async () => {
    marketing.generateSingleLink.mockResolvedValue(
      fakeLinkFor('poster', { destinationUrl: STALE_DESTINATION })
    )
    await resolvePosterLink(EVENT_ID)
    expect(audit.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        additional_info: expect.objectContaining({ reason: 'poster_artwork_link_repair' }),
      })
    )
  })
})
