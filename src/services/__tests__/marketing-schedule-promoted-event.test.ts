import { beforeEach, describe, expect, it, vi } from 'vitest'

import october from '@/lib/email/marketing/campaigns/october-2026-whats-on-guests.json'

/**
 * Scheduling records which event a campaign promotes, because the send in SQL
 * (`claim_marketing_recipients`) uses it to leave out guests who have already booked. If this
 * stopped being written, every event email would quietly go back to reaching booked guests.
 */

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  promotedEventId: null as string | null,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        update: (payload: Record<string, unknown>) => {
          state.updates.push(payload)
          state.row = { ...state.row, ...payload }
          return chain
        },
        maybeSingle: async () => ({ data: state.row, error: null }),
      }
      return chain
    },
  }),
}))

vi.mock('@/services/marketing-contacts', () => ({
  previewAudience: vi.fn().mockResolvedValue({ eligibleCount: 12 }),
}))
vi.mock('@/lib/email/marketing/links', () => ({
  provisionCampaignLinks: vi.fn().mockResolvedValue({ linkMap: {}, failures: [] }),
}))
vi.mock('@/lib/email/marketing/venueClosureClaims', () => ({
  findVenueClosureClaims: vi.fn().mockReturnValue([]),
}))
vi.mock('@/lib/business-hours/effective', () => ({
  getBusinessHoursForDates: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('@/lib/email/marketing/promoted-event', () => ({
  resolvePromotedEventId: vi.fn(async () => state.promotedEventId),
}))

import { resolvePromotedEventId } from '@/lib/email/marketing/promoted-event'
import { scheduleCampaign } from '@/services/marketing-campaigns'

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111'
const NEXT_MONTH = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

function draftRow(): Record<string, unknown> {
  return {
    id: CAMPAIGN_ID,
    name: 'Welcome to October - guests - 2026',
    subject: 'Welcome to October at The Anchor',
    preheader: 'Three nights out this month',
    content: october,
    content_schema_version: 1,
    renderer_version: '1',
    content_hash: null,
    audience_type: 'customer',
    audience: {},
    audience_version: 1,
    approved_recipient_count: null,
    link_map: {},
    utm_campaign: 'october-2026-roundup-guests',
    // Exempt from the cap so the schedule-time collision check, which is not under test, is skipped.
    ignores_frequency_cap: true,
    status: 'draft',
    scheduled_for: null,
    locked_at: null,
    created_at: '2026-09-09T08:00:00Z',
    updated_at: '2026-09-09T08:00:00Z',
  }
}

describe('scheduling records the event a campaign promotes', () => {
  beforeEach(() => {
    state.row = draftRow()
    state.updates = []
    state.promotedEventId = null
  })

  it('stores the event when the email promotes exactly one', async () => {
    state.promotedEventId = 'event-1'

    const result = await scheduleCampaign(CAMPAIGN_ID, NEXT_MONTH, 'user-1')

    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]).toMatchObject({ status: 'scheduled', event_id: 'event-1' })
    expect(result.campaign.eventId).toBe('event-1')
  })

  it('stores no event for a round-up, and works it out from the links in the copy', async () => {
    const result = await scheduleCampaign(CAMPAIGN_ID, NEXT_MONTH, 'user-1')

    expect(state.updates[0]).toMatchObject({ status: 'scheduled', event_id: null })
    expect(result.campaign.eventId).toBeNull()
    const urls = vi.mocked(resolvePromotedEventId).mock.calls.at(-1)?.[1] ?? []
    expect(urls.some((url) => /\/events\//.test(url))).toBe(true)
  })
})
