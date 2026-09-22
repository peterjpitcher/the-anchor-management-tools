// Editing pay band rates and employee rate overrides around midnight, in both test zones.
//
// updatePayBandRate and updateEmployeeRateOverride refuse edits to a rate that is "historical or
// current", meaning effective on or before today. "Today" was the UTC date, so from 00:00 to 00:59
// British Summer Time a rate effective today still counted as future and could be edited, while the
// Pay tab (already on London dates) showed it as locked. "Today" is now the London date.
//
// Instants are written in UTC so the file reads the same in both test zones: 23:30 UTC on
// 17 September 2026 is 00:30 BST on Friday 18 September in London, but still Thursday in UTC.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { updateEmployeeRateOverride, updatePayBandRate } from '@/app/actions/pay-bands'

const mockedPermission = checkUserPermission as unknown as ReturnType<typeof vi.fn>
const mockedCreateClient = createClient as unknown as ReturnType<typeof vi.fn>

// 00:30 BST on Friday 18 September 2026 in London; Thursday 17 September in UTC.
const JUST_AFTER_MIDNIGHT_BST = '2026-09-17T23:30:00Z'
// 23:30 BST on Thursday 17 September 2026: the same day in London and in UTC.
const JUST_BEFORE_MIDNIGHT_BST = '2026-09-17T22:30:00Z'
// Winter control: 00:30 GMT on Thursday 15 January 2026, the same day in both zones.
const JUST_AFTER_MIDNIGHT_GMT = '2026-01-15T00:30:00Z'

const RATE_ID = '00000000-0000-4000-8000-000000000002'
const BAND_ID = '00000000-0000-4000-8000-000000000008'
const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000009'

const RATE_REFUSED = 'Historical or current rates cannot be edited. Add a new future rate instead.'
const OVERRIDE_REFUSED = 'Historical or current overrides cannot be edited. Add a new future override instead.'

/**
 * A session client for one table: the lookup returns a row effective on the given date, and an
 * update (if the action gets that far) echoes back the new values.
 */
function clientFor(table: 'pay_band_rates' | 'employee_rate_overrides', effectiveFrom: string) {
  const existing = {
    id: RATE_ID,
    ...(table === 'pay_band_rates' ? { band_id: BAND_ID } : { employee_id: EMPLOYEE_ID }),
    hourly_rate: 12,
    effective_from: effectiveFrom,
    created_at: '2026-01-01T00:00:00.000Z',
  }
  const update = vi.fn((values: Record<string, unknown>) => ({
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { ...existing, ...values }, error: null }),
      }),
    }),
  }))
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn((name: string) => {
      if (name !== table) throw new Error(`Unexpected table: ${name}`)
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
          }),
        }),
        update,
      }
    }),
  })
  return { update }
}

async function editRateAt(isoInstant: string, effectiveFrom: string) {
  vi.setSystemTime(new Date(isoInstant))
  const { update } = clientFor('pay_band_rates', effectiveFrom)
  const result = await updatePayBandRate({ id: RATE_ID, hourlyRate: 13, effectiveFrom })
  return { result, update }
}

async function editOverrideAt(isoInstant: string, effectiveFrom: string) {
  vi.setSystemTime(new Date(isoInstant))
  const { update } = clientFor('employee_rate_overrides', effectiveFrom)
  const result = await updateEmployeeRateOverride({ id: RATE_ID, hourlyRate: 13, effectiveFrom })
  return { result, update }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPermission.mockResolvedValue(true)
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('updatePayBandRate uses the London date for today', () => {
  it('refuses an edit to a rate effective today in the first hour of the London day', async () => {
    const { result, update } = await editRateAt(JUST_AFTER_MIDNIGHT_BST, '2026-09-18')

    expect(result).toEqual({ success: false, error: RATE_REFUSED })
    expect(update).not.toHaveBeenCalled()
  })

  it('allows an edit to a rate effective tomorrow before midnight', async () => {
    const { result, update } = await editRateAt(JUST_BEFORE_MIDNIGHT_BST, '2026-09-18')

    expect(result).toMatchObject({ success: true, data: { effective_from: '2026-09-18', hourly_rate: 13 } })
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('in winter, refuses a rate effective today and allows one effective tomorrow', async () => {
    const today = await editRateAt(JUST_AFTER_MIDNIGHT_GMT, '2026-01-15')
    expect(today.result).toEqual({ success: false, error: RATE_REFUSED })
    expect(today.update).not.toHaveBeenCalled()

    const tomorrow = await editRateAt(JUST_AFTER_MIDNIGHT_GMT, '2026-01-16')
    expect(tomorrow.result).toMatchObject({ success: true })
    expect(tomorrow.update).toHaveBeenCalledTimes(1)
  })
})

describe('updateEmployeeRateOverride uses the London date for today', () => {
  it('refuses an edit to an override effective today in the first hour of the London day', async () => {
    const { result, update } = await editOverrideAt(JUST_AFTER_MIDNIGHT_BST, '2026-09-18')

    expect(result).toEqual({ success: false, error: OVERRIDE_REFUSED })
    expect(update).not.toHaveBeenCalled()
  })

  it('allows an edit to an override effective tomorrow before midnight', async () => {
    const { result, update } = await editOverrideAt(JUST_BEFORE_MIDNIGHT_BST, '2026-09-18')

    expect(result).toMatchObject({ success: true, data: { effective_from: '2026-09-18', hourly_rate: 13 } })
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('in winter, refuses an override effective today and allows one effective tomorrow', async () => {
    const today = await editOverrideAt(JUST_AFTER_MIDNIGHT_GMT, '2026-01-15')
    expect(today.result).toEqual({ success: false, error: OVERRIDE_REFUSED })
    expect(today.update).not.toHaveBeenCalled()

    const tomorrow = await editOverrideAt(JUST_AFTER_MIDNIGHT_GMT, '2026-01-16')
    expect(tomorrow.result).toMatchObject({ success: true })
    expect(tomorrow.update).toHaveBeenCalledTimes(1)
  })
})
