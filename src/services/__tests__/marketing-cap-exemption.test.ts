import { describe, expect, it } from 'vitest'

import { mapMarketingCampaign } from '@/types/marketing'

/**
 * The monthly round-up is exempt from the frequency cap, and the enforcement that matters
 * lives in SQL rather than here. `claim_marketing_recipients` decides who is reached and
 * `finalise_marketing_send` decides whether a send counts against the next one; the
 * TypeScript only carries the flag to them and stops `scheduleCampaign` refusing a collision
 * the database is going to allow.
 *
 * So these tests pin the two things TypeScript is actually responsible for: reading the flag
 * safely off a row, and never inventing it.
 */

const baseRow = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Welcome to October - guests - 2026',
  subject: 'Welcome to October at The Anchor',
  preheader: 'Three nights out this month',
  content: { blocks: [] },
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
}

describe('reading the cap exemption off a campaign row', () => {
  it('is true only when the column says so', () => {
    expect(mapMarketingCampaign({ ...baseRow, ignores_frequency_cap: true }).ignoresFrequencyCap).toBe(true)
  })

  it('is false when the column says so', () => {
    expect(mapMarketingCampaign({ ...baseRow, ignores_frequency_cap: false }).ignoresFrequencyCap).toBe(false)
  })

  it('is false when the column is absent, so a row read before the migration is capped', () => {
    // This is the case that matters. If the code deploys ahead of the migration, or an older
    // select omits the column, the safe answer is "still capped" rather than "exempt".
    expect(mapMarketingCampaign(baseRow).ignoresFrequencyCap).toBe(false)
  })

  it.each([null, undefined, 0, '', 'false', 'true'])(
    'is false for %p, so nothing truthy-but-not-true can exempt a campaign by accident',
    (value) => {
      expect(mapMarketingCampaign({ ...baseRow, ignores_frequency_cap: value }).ignoresFrequencyCap).toBe(false)
    },
  )
})
