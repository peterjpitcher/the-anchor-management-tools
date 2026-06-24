import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/services/menu-settings', () => ({
  MenuSettingsService: {
    getMenuTargetGp: vi.fn(),
  },
}))

vi.mock('@/lib/rota/payroll-period-store', () => ({
  ensurePayrollPeriodsAheadRecords: vi.fn(),
  getOrCreatePayrollPeriodForDateRecord: vi.fn(),
  getOrCreatePayrollPeriodRecord: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { getBulkCustomerLabels } from '@/app/actions/customer-labels-bulk'
import { updateSiteSettings, updateSiteToggle } from '@/app/actions/site-settings'
import { getMissingCashupDatesAction } from '@/app/actions/missing-cashups'
import { getMenuTargetGp } from '@/app/actions/menu-settings'
import {
  ensurePayrollPeriodsAhead,
  getOrCreatePayrollPeriod,
  getOrCreatePayrollPeriodForDate,
} from '@/app/actions/payroll'
import { MenuSettingsService } from '@/services/menu-settings'
import {
  ensurePayrollPeriodsAheadRecords,
  getOrCreatePayrollPeriodForDateRecord,
  getOrCreatePayrollPeriodRecord,
} from '@/lib/rota/payroll-period-store'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedMenuSettings = MenuSettingsService.getMenuTargetGp as unknown as Mock
const mockedGetPeriod = getOrCreatePayrollPeriodRecord as unknown as Mock
const mockedGetPeriodForDate = getOrCreatePayrollPeriodForDateRecord as unknown as Mock
const mockedEnsurePeriods = ensurePayrollPeriodsAheadRecords as unknown as Mock

function mockSignedInClient() {
  const from = vi.fn()
  mockedCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'manager@example.com' } },
      }),
    },
    from,
  })
  return { from }
}

describe('A-053 exported action RBAC re-checks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(false)
  })

  it('blocks bulk customer labels before querying labels', async () => {
    const result = await getBulkCustomerLabels(['customer-1'])

    expect(result).toEqual({ error: 'Permission denied' })
    expect(mockedCreateClient).not.toHaveBeenCalled()
  })

  it('blocks site settings updates and toggles before writing', async () => {
    const { from } = mockSignedInClient()
    const formData = new FormData()
    formData.set('id', 'site-1')

    await expect(updateSiteSettings(formData)).resolves.toEqual({ error: 'Permission denied' })
    await expect(updateSiteToggle('site-1', 'online_bookings_enabled', true)).resolves.toEqual({ error: 'Permission denied' })
    expect(from).not.toHaveBeenCalled()
  })

  it('blocks missing cash-up dates before reading sessions', async () => {
    const { from } = mockSignedInClient()

    const result = await getMissingCashupDatesAction('site-1')

    expect(result).toEqual({ success: false, error: 'Permission denied' })
    expect(from).not.toHaveBeenCalled()
  })

  it('blocks menu GP target reads before calling the service', async () => {
    await expect(getMenuTargetGp()).rejects.toThrow('Permission denied')

    expect(mockedMenuSettings).not.toHaveBeenCalled()
  })

  it('blocks payroll period exported actions before using the admin store', async () => {
    await expect(getOrCreatePayrollPeriod(2026, 7)).rejects.toThrow('Permission denied')
    await expect(getOrCreatePayrollPeriodForDate('2026-07-24')).rejects.toThrow('Permission denied')
    await expect(ensurePayrollPeriodsAhead('2026-07-24', 1)).rejects.toThrow('Permission denied')

    expect(mockedGetPeriod).not.toHaveBeenCalled()
    expect(mockedGetPeriodForDate).not.toHaveBeenCalled()
    expect(mockedEnsurePeriods).not.toHaveBeenCalled()
  })
})
