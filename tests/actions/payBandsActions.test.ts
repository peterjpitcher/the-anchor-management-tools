import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { updateEmployeeRateOverride, updatePayAgeBand, updatePayBandRate } from '@/app/actions/pay-bands'

const mockedPermission = checkUserPermission as unknown as ReturnType<typeof vi.fn>
const mockedCreateClient = createClient as unknown as ReturnType<typeof vi.fn>

describe('pay band actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
  })

  it('updates and deactivates an age band', async () => {
    const updatedBand = {
      id: '00000000-0000-4000-8000-000000000001',
      label: 'Under 18',
      min_age: 0,
      max_age: 17,
      sort_order: 1,
      is_active: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    }
    const maybeSingle = vi.fn().mockResolvedValue({ data: { ...updatedBand, is_active: true }, error: null })
    const selectEq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq: selectEq })
    const single = vi.fn().mockResolvedValue({ data: updatedBand, error: null })
    const updateSelect = vi.fn().mockReturnValue({ single })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn((table: string) => {
        if (table !== 'pay_age_bands') throw new Error(`Unexpected table: ${table}`)
        return { select, update }
      }),
    })

    const result = await updatePayAgeBand({
      id: updatedBand.id,
      label: updatedBand.label,
      minAge: updatedBand.min_age,
      maxAge: updatedBand.max_age,
      sortOrder: updatedBand.sort_order,
      isActive: false,
    })

    expect(result).toEqual({ success: true, data: updatedBand })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }))
  })

  it('blocks editing current or historical pay-band rates', async () => {
    const update = vi.fn()
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn((table: string) => {
        if (table !== 'pay_band_rates') throw new Error(`Unexpected table: ${table}`)
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: '00000000-0000-4000-8000-000000000002', effective_from: '2020-01-01' },
                error: null,
              }),
            }),
          }),
          update,
        }
      }),
    })

    const result = await updatePayBandRate({
      id: '00000000-0000-4000-8000-000000000002',
      hourlyRate: 12,
      effectiveFrom: '2026-07-01',
    })

    expect(result).toEqual({
      success: false,
      error: 'Historical or current rates cannot be edited. Add a new future rate instead.',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('blocks editing current or historical employee overrides', async () => {
    const update = vi.fn()
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn((table: string) => {
        if (table !== 'employee_rate_overrides') throw new Error(`Unexpected table: ${table}`)
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: '00000000-0000-4000-8000-000000000003', effective_from: '2020-01-01' },
                error: null,
              }),
            }),
          }),
          update,
        }
      }),
    })

    const result = await updateEmployeeRateOverride({
      id: '00000000-0000-4000-8000-000000000003',
      hourlyRate: 13,
      effectiveFrom: '2026-07-01',
    })

    expect(result).toEqual({
      success: false,
      error: 'Historical or current overrides cannot be edited. Add a new future override instead.',
    })
    expect(update).not.toHaveBeenCalled()
  })
})
