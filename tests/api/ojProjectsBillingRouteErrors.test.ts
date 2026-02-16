import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { GET } from '@/app/api/cron/oj-projects-billing/route'

describe('oj-projects billing route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic error when vendor candidate load fails', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const limit = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive query diagnostics' },
    })
    const lte = vi.fn().mockReturnValue({ limit })
    const eqBillable = vi.fn().mockReturnValue({ lte })
    const eqStatus = vi.fn().mockReturnValue({ eq: eqBillable })
    const select = vi.fn().mockReturnValue({ eq: eqStatus })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'oj_entries') {
          return { select }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const request = new Request('http://localhost/api/cron/oj-projects-billing?force=true')
    const response = await GET(request)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to load billing vendor candidates' })
  })
})
