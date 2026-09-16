import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { ShortLinkService } from '@/services/short-links'

// get_all_links_analytics_v2 returns one row per short link clicked in the window and
// applies no limit of its own, but Supabase still caps the response at 1,000 rows and
// says nothing when it truncates. Live on 16 September 2026: 363 links over 90 days,
// 702 over the 366-day maximum, 773 all time, and the Insights screen sums every row
// for its totals, unique visitors and daily chart.
const ROW_COUNT = 1200

type RangeCall = [number, number]
type AnalyticsRow = {
  id: string
  short_code: string
  total_clicks: number
  unique_visitors: number
  click_dates: string[]
  click_counts: number[]
}

const INPUT = {
  start_at: '2026-06-18T00:00:00.000Z',
  end_at: '2026-09-16T00:00:00.000Z',
  granularity: 'day' as const,
  include_bots: false,
  timezone: 'Europe/London',
}

const EXPECTED_RPC_ARGS = {
  p_start_at: INPUT.start_at,
  p_end_at: INPUT.end_at,
  p_granularity: INPUT.granularity,
  p_include_bots: false,
  p_timezone: 'Europe/London',
}

function buildRows(): AnalyticsRow[] {
  return Array.from({ length: ROW_COUNT }, (_, index) => ({
    id: `link-${index}`,
    short_code: `code${index}`,
    total_clicks: ROW_COUNT - index,
    unique_visitors: Math.max(1, ROW_COUNT - index - 1),
    click_dates: ['2026-09-15'],
    click_counts: [ROW_COUNT - index],
  }))
}

function createAnalyticsClient(options: {
  rows: AnalyticsRow[]
  rangeCalls: RangeCall[]
  rpcCalls: unknown[]
  pageError?: { message: string }
}): SupabaseClient {
  const rpc = vi.fn((_fn: string, args: Record<string, unknown>) => {
    options.rpcCalls.push(args)
    return {
      range: (from: number, to: number) => {
        options.rangeCalls.push([from, to])
        if (options.pageError) {
          return Promise.resolve({ data: null, error: options.pageError })
        }
        return Promise.resolve({ data: options.rows.slice(from, to + 1), error: null })
      },
    }
  })

  return { rpc } as unknown as SupabaseClient
}

describe('ShortLinkService.getShortLinkVolumeAdvanced paging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns every analytics row past the 1,000-row cap', async () => {
    const rows = buildRows()
    const rangeCalls: RangeCall[] = []
    const rpcCalls: unknown[] = []
    vi.mocked(createClient).mockResolvedValue(
      createAnalyticsClient({ rows, rangeCalls, rpcCalls })
    )

    const result = await ShortLinkService.getShortLinkVolumeAdvanced(INPUT)

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    expect(result).toHaveLength(ROW_COUNT)
    expect(result).toEqual(rows)
    // The window is unchanged on every page, so the same rows are being sliced.
    expect(rpcCalls).toEqual([EXPECTED_RPC_ARGS, EXPECTED_RPC_ARGS])
  })

  it('still throws the existing error when a page fails', async () => {
    const rangeCalls: RangeCall[] = []
    const rpcCalls: unknown[] = []
    vi.mocked(createClient).mockResolvedValue(
      createAnalyticsClient({
        rows: buildRows(),
        rangeCalls,
        rpcCalls,
        pageError: { message: 'statement timeout' },
      })
    )

    await expect(ShortLinkService.getShortLinkVolumeAdvanced(INPUT)).rejects.toThrow(
      'Failed to load analytics'
    )
  })
})
