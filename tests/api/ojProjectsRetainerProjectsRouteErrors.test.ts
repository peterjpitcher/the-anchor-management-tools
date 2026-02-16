import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { GET } from '@/app/api/cron/oj-projects-retainer-projects/route'

describe('oj retainer-project route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic error when retainer settings load fails', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const settingsLimit = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive retainer settings query diagnostics' },
    })
    const settingsGt = vi.fn().mockReturnValue({ limit: settingsLimit })
    const settingsSelect = vi.fn().mockReturnValue({ gt: settingsGt })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'oj_vendor_billing_settings') {
          return { select: settingsSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const request = new Request('http://localhost/api/cron/oj-projects-retainer-projects?force=true')
    const response = await GET(request)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to load retainer settings' })
  })
})
