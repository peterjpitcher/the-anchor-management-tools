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

describe('oj retainer-project route per-vendor error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns generic per-vendor failure error text when existing-project lookup fails', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const settingsLimit = vi.fn().mockResolvedValue({
      data: [{ vendor_id: 'vendor-1', retainer_included_hours_per_month: 12 }],
      error: null,
    })
    const settingsGt = vi.fn().mockReturnValue({ limit: settingsLimit })
    const settingsSelect = vi.fn().mockReturnValue({ gt: settingsGt })

    const vendorsLimit = vi.fn().mockResolvedValue({
      data: [{ id: 'vendor-1', name: 'Vendor One' }],
      error: null,
    })
    const vendorsIn = vi.fn().mockReturnValue({ limit: vendorsLimit })
    const vendorsSelect = vi.fn().mockReturnValue({ in: vendorsIn })

    const existingMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive existing project diagnostics' },
    })
    const existingEqPeriod = vi.fn().mockReturnValue({ maybeSingle: existingMaybeSingle })
    const existingEqRetainer = vi.fn().mockReturnValue({ eq: existingEqPeriod })
    const existingEqVendor = vi.fn().mockReturnValue({ eq: existingEqRetainer })
    const existingSelect = vi.fn().mockReturnValue({ eq: existingEqVendor })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'oj_vendor_billing_settings') {
          return { select: settingsSelect }
        }
        if (table === 'invoice_vendors') {
          return { select: vendorsSelect }
        }
        if (table === 'oj_projects') {
          return { select: existingSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/oj-projects-retainer-projects?force=true'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.created).toBe(0)
    expect(payload.skipped).toBe(0)
    expect(payload.vendors).toEqual([
      {
        vendor_id: 'vendor-1',
        vendor_name: 'Vendor One',
        status: 'failed',
        error: 'Failed to create retainer project',
      },
    ])
  })
})

