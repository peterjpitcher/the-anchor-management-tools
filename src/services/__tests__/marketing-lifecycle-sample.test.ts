import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SAMPLE_MERGE_FIELDS } from '@/lib/email/marketing/merge'
import type { MarketingCampaign } from '@/types/marketing'

/**
 * The preview and the test send fill a return-visit email with a sample guest. On 3 November
 * 2026 the touch 2 preview said "25% off" in the copy and "10% off your food" on the voucher,
 * because the sample percentage was fixed at 10 while a real send reads the voucher type.
 */

const state = vi.hoisted(() => ({
  row: null as { percent_off: number | null } | null,
  error: null as { message: string } | null,
  requestedId: null as string | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe('voucher_types')
      return {
        select: () => ({
          eq: (_column: string, value: string) => {
            state.requestedId = value
            return { maybeSingle: async () => ({ data: state.row, error: state.error }) }
          },
        }),
      }
    },
  }),
}))

import { sampleMergeFieldsFor } from '@/services/marketing-lifecycle'

function campaign(customerFilter: unknown): MarketingCampaign {
  return { audience: { includeTags: [], excludeTags: [], customerFilter } } as unknown as MarketingCampaign
}

const TOUCH_2_FILTER = {
  rule: 'table_return_visit',
  touch: 2,
  voucher_type_id: 'return-25',
  previous_campaign_id: '00000000-0000-4000-8000-000000000001',
  days_since_previous_touch_min: 45,
  voucher_valid_days: 30,
  include_no_shows: true,
}

describe('sampleMergeFieldsFor', () => {
  beforeEach(() => {
    state.row = null
    state.error = null
    state.requestedId = null
  })

  it('shows the percentage of the campaign\'s own voucher type', async () => {
    state.row = { percent_off: 25 }

    const fields = await sampleMergeFieldsFor(campaign(TOUCH_2_FILTER))

    expect(state.requestedId).toBe('return-25')
    expect(fields).toEqual({ ...SAMPLE_MERGE_FIELDS, voucher_percent: 25 })
  })

  it('keeps the generic sample for a campaign with no return-visit rule', async () => {
    const fields = await sampleMergeFieldsFor(campaign(undefined))

    expect(state.requestedId).toBeNull()
    expect(fields).toEqual(SAMPLE_MERGE_FIELDS)
  })

  it('refuses rather than showing a made-up percentage when the type has none', async () => {
    state.row = { percent_off: null }

    await expect(sampleMergeFieldsFor(campaign(TOUCH_2_FILTER))).rejects.toThrow(/no percentage/)
  })

  it('reports a failed lookup instead of falling back to 10%', async () => {
    state.error = { message: 'connection reset' }

    await expect(sampleMergeFieldsFor(campaign(TOUCH_2_FILTER))).rejects.toThrow(/connection reset/)
  })
})
