import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { GET } from '@/app/api/cron/oj-projects-retainer-projects/route'

describe('oj retainer-project route and inactive clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates no retainer project for a client marked inactive, even with retainer hours set', async () => {
    ;(authorizeCronRequest as unknown as Mock).mockReturnValue({ authorized: true })

    const settingsLimit = vi.fn().mockResolvedValue({
      data: [{ vendor_id: 'vendor-gone', retainer_included_hours_per_month: 40 }],
      error: null,
    })
    const settingsGt = vi.fn().mockReturnValue({ limit: settingsLimit })
    const settingsSelect = vi.fn().mockReturnValue({ gt: settingsGt })

    const vendorsLimit = vi.fn().mockResolvedValue({
      data: [{ id: 'vendor-gone', name: 'Former Client', is_active: false }],
      error: null,
    })
    const vendorsIn = vi.fn().mockReturnValue({ limit: vendorsLimit })
    const vendorsSelect = vi.fn().mockReturnValue({ in: vendorsIn })

    const projectsTouched = vi.fn()

    ;(createAdminClient as unknown as Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'oj_vendor_billing_settings') return { select: settingsSelect }
        if (table === 'invoice_vendors') return { select: vendorsSelect }
        projectsTouched(table)
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/oj-projects-retainer-projects?force=true'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(vendorsSelect).toHaveBeenCalledWith('id, name, is_active')
    expect(projectsTouched).not.toHaveBeenCalled()
    expect(payload.created).toBe(0)
    expect(payload.skipped).toBe(1)
    expect(payload.vendors).toEqual([
      { vendor_id: 'vendor-gone', vendor_name: 'Former Client', status: 'skipped', reason: 'inactive_client' },
    ])
  })
})
