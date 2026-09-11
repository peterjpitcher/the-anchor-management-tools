import { beforeEach, describe, expect, it, vi } from 'vitest'

import october from '@/lib/email/marketing/campaigns/october-2026-whats-on-guests.json'

/**
 * Scheduling freezes a campaign's copy, so it is the last point a banned claim can be stopped.
 * Until 11 September 2026 that check sat inside the frequency-cap exemption by mistake, so the
 * monthly round-ups, which are exempt from the cap, were scheduled without it. These pin the
 * check to every campaign, exempt or not.
 */

const row = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: row.current, error: null }),
      }
      return chain
    },
  }),
}))

vi.mock('@/services/marketing-contacts', () => ({
  previewAudience: vi.fn().mockResolvedValue({ eligibleCount: 12 }),
}))

import { scheduleCampaign } from '@/services/marketing-campaigns'

function campaignRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: '11111111-1111-1111-1111-111111111111',
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
    status: 'draft',
    scheduled_for: null,
    locked_at: null,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancelled_by: null,
    paused_at: null,
    paused_by: null,
    created_by: null,
    scheduled_by: null,
    created_at: '2026-09-09T08:00:00Z',
    updated_at: '2026-09-09T08:00:00Z',
    ...overrides,
  }
}

/** The October round-up with one banned claim added to its first paragraph. */
function withBannedClaim(): unknown {
  const content = structuredClone(october) as { blocks: Array<{ type: string; data: { body?: string[] } }> }
  const first = content.blocks.find((block) => block.type === 'text_block')
  if (!first?.data.body) throw new Error('fixture has no text block')
  first.data.body[0] = `${first.data.body[0]} We've poured pints here since 1866.`
  return content
}

const NEXT_MONTH = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

describe('scheduling refuses a banned claim', () => {
  beforeEach(() => {
    row.current = null
  })

  it('in a monthly round-up that is exempt from the frequency cap', async () => {
    row.current = campaignRow({ ignores_frequency_cap: true, content: withBannedClaim() })
    await expect(scheduleCampaign('11111111-1111-1111-1111-111111111111', NEXT_MONTH, 'user-1')).rejects.toThrow(
      /claim the brand rules ban.*1866/,
    )
  })

  it('in an ordinary campaign', async () => {
    row.current = campaignRow({ ignores_frequency_cap: false, content: withBannedClaim() })
    await expect(scheduleCampaign('11111111-1111-1111-1111-111111111111', NEXT_MONTH, 'user-1')).rejects.toThrow(
      /claim the brand rules ban.*1866/,
    )
  })
})
