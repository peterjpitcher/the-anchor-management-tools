import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/analytics/engagement-scoring', () => ({
  recalculateEngagementScoresAndLabels: vi.fn(),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { recalculateEngagementScoresAndLabels } from '@/lib/analytics/engagement-scoring'
import { GET } from '@/app/api/cron/engagement-scoring/route'

describe('engagement scoring route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic 500 payload when scoring recalculation fails', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({})
    ;(recalculateEngagementScoresAndLabels as unknown as vi.Mock).mockRejectedValue(
      new Error('sensitive engagement scoring diagnostics')
    )

    const response = await GET(new Request('http://localhost/api/cron/engagement-scoring') as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ success: false, error: 'Failed to recalculate engagement scores' })
  })
})

