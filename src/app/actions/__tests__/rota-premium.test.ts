import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))

import { createShift, updateShift } from '../rota'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { initialPremiumMode } from '@/app/(authenticated)/rota/CreateShiftModal'

const mockPerm = vi.mocked(checkUserPermission)
const mockCreateClient = vi.mocked(createClient)
const mockCreateAdminClient = vi.mocked(createAdminClient)

const WEEK = { week_start: '2026-03-16' } // Monday

// Capture the row passed to rota_shifts.insert so assertions can inspect the
// premium columns that createShift persists.
function makeSupabase(captured: { row?: Record<string, unknown> }) {
  const insertReturn = {
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { id: 'shift-1', week_id: 'week-1', ...(captured.row ?? {}) },
        error: null,
      }),
    }),
  }
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'rota_weeks') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: WEEK, error: null }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
      }
    }
    if (table === 'rota_shifts') {
      return {
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          captured.row = row
          return insertReturn
        }),
      }
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from,
  }
}

const BASE = {
  weekId: '11111111-1111-1111-1111-111111111111',
  employeeId: '22222222-2222-2222-2222-222222222222',
  isOpenShift: false,
  shiftDate: '2026-03-16',
  startTime: '17:00',
  endTime: '23:00',
  unpaidBreakMinutes: 0,
  department: 'bar',
  isOvernight: false,
}

describe('createShift premium handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPerm.mockResolvedValue(true)
  })

  it('persists a whole-shift multiplier premium', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeSupabase(captured) as never)

    const result = await createShift({ ...BASE, rateMultiplier: 1.5 } as never)
    expect(result.success).toBe(true)
    expect(captured.row?.rate_multiplier).toBe(1.5)
    expect(captured.row?.rate_override).toBeNull()
    expect(captured.row?.premium_start_time).toBeNull()
    expect(captured.row?.premium_end_time).toBeNull()
  })

  it('persists a custom rate override and clears the multiplier', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeSupabase(captured) as never)

    const result = await createShift({ ...BASE, rateOverride: 18.5 } as never)
    expect(result.success).toBe(true)
    expect(captured.row?.rate_override).toBe(18.5)
    expect(captured.row?.rate_multiplier).toBeNull()
  })

  it('persists a valid partial window within the shift', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeSupabase(captured) as never)

    const result = await createShift({
      ...BASE,
      rateMultiplier: 2,
      premiumStartTime: '20:00',
      premiumEndTime: '23:00',
    } as never)
    expect(result.success).toBe(true)
    expect(captured.row?.premium_start_time).toBe('20:00')
    expect(captured.row?.premium_end_time).toBe('23:00')
  })

  it('rejects a window that starts before the shift', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeSupabase(captured) as never)

    const result = await createShift({
      ...BASE,
      rateMultiplier: 2,
      premiumStartTime: '16:00', // before 17:00 start
      premiumEndTime: '22:00',
    } as never)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/within the shift/i)
    expect(captured.row).toBeUndefined()
  })

  it('rejects a window where end is not after start', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeSupabase(captured) as never)

    const result = await createShift({
      ...BASE,
      rateMultiplier: 2,
      premiumStartTime: '21:00',
      premiumEndTime: '21:00',
    } as never)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/after the premium start/i)
  })

  it('rejects a window with no rate set', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeSupabase(captured) as never)

    const result = await createShift({
      ...BASE,
      premiumStartTime: '20:00',
      premiumEndTime: '22:00',
    } as never)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/premium rate/i)
  })

  it('accepts an after-midnight window on an overnight shift', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeSupabase(captured) as never)

    // 20:00 -> 04:00 overnight; double-time from 00:00 to 04:00 (after midnight).
    const result = await createShift({
      ...BASE,
      startTime: '20:00',
      endTime: '04:00',
      isOvernight: true,
      rateMultiplier: 2,
      premiumStartTime: '00:00',
      premiumEndTime: '04:00',
    } as never)
    expect(result.success).toBe(true)
    expect(captured.row?.premium_start_time).toBe('00:00')
    expect(captured.row?.premium_end_time).toBe('04:00')
  })

  it('accepts an overnight window that starts exactly at the shift start', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeSupabase(captured) as never)

    // Regression: 18:00 -> 02:00 overnight shift, premium window 18:00 -> 20:00.
    // The window start equals the shift start, so it must NOT wrap to day+1
    // (the off-by-one that used `<=` wrongly blocked this valid save).
    const result = await createShift({
      ...BASE,
      startTime: '18:00',
      endTime: '02:00',
      isOvernight: true,
      rateMultiplier: 1.5,
      premiumStartTime: '18:00',
      premiumEndTime: '20:00',
    } as never)
    expect(result.success).toBe(true)
    expect(captured.row?.premium_start_time).toBe('18:00')
    expect(captured.row?.premium_end_time).toBe('20:00')
  })

  it('rejects a custom rate above the £100/hr cap', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeSupabase(captured) as never)

    const result = await createShift({ ...BASE, rateOverride: 150 } as never)
    expect(result.success).toBe(false)
    expect(captured.row).toBeUndefined()
  })

  it('accepts a custom rate at exactly the £100/hr cap', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeSupabase(captured) as never)

    const result = await createShift({ ...BASE, rateOverride: 100 } as never)
    expect(result.success).toBe(true)
    expect(captured.row?.rate_override).toBe(100)
  })

  it('stores no premium when the rate is standard', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeSupabase(captured) as never)

    const result = await createShift({ ...BASE } as never)
    expect(result.success).toBe(true)
    expect(captured.row?.rate_multiplier).toBeNull()
    expect(captured.row?.rate_override).toBeNull()
    expect(captured.row?.premium_reason).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// updateShift premium edits
// ---------------------------------------------------------------------------

type CurrentShift = {
  id: string
  week_id: string
  employee_id: string | null
  is_open_shift: boolean
  status: string
  shift_date: string
  start_time: string
  end_time: string
  unpaid_break_minutes: number
  department: string
  notes: string | null
  is_overnight: boolean
  acceptance_status: string | null
  acceptance_decided_at: string | null
  acceptance_decided_by: string | null
  acceptance_note: string | null
  auto_accept_reason: string | null
  auto_accept_warning_sent_at: string | null
  rate_multiplier: number | null
  rate_override: number | null
  premium_reason: string | null
  premium_start_time: string | null
  premium_end_time: string | null
}

const CURRENT: CurrentShift = {
  id: 'shift-1',
  week_id: 'week-1',
  employee_id: 'emp-1',
  is_open_shift: false,
  status: 'scheduled',
  shift_date: '2026-03-16',
  start_time: '17:00',
  end_time: '23:00',
  unpaid_break_minutes: 0,
  department: 'bar',
  notes: null,
  is_overnight: false,
  acceptance_status: 'accepted',
  acceptance_decided_at: null,
  acceptance_decided_by: null,
  acceptance_note: null,
  auto_accept_reason: null,
  auto_accept_warning_sent_at: null,
  rate_multiplier: null,
  rate_override: null,
  premium_reason: null,
  premium_start_time: null,
  premium_end_time: null,
}

function makeUpdateSupabase(current: CurrentShift, captured: { payload?: Record<string, unknown> }) {
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'rota_shifts') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: current, error: null }) }),
        }),
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          captured.payload = payload
          return {
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { ...current, ...payload }, error: null }),
              }),
            }),
          }
        }),
      }
    }
    if (table === 'rota_weeks') {
      return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }) }
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from,
  }
}

// Admin client used for payroll-approval invalidation. Sessions are NO LONGER
// written by the rota write path (they resolve premium live), so we track any
// timeclock_sessions.update to prove none happens, and track payroll approval
// deletes to prove a genuine premium change invalidates the frozen snapshot.
function makeAdmin(options: { periods?: Array<{ year: number; month: number }> } = {}) {
  const periods = options.periods ?? [{ year: 2026, month: 3 }]
  const sessionUpdates: Array<Record<string, unknown>> = []
  const approvalDeletes: Array<{ year: number; month: number }> = []

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'timeclock_sessions') {
      return {
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          sessionUpdates.push(payload)
          return { eq: vi.fn().mockResolvedValue({ error: null }) }
        }),
      }
    }
    if (table === 'payroll_periods') {
      return { select: vi.fn().mockReturnValue({ lte: vi.fn().mockReturnValue({ gte: vi.fn().mockResolvedValue({ data: periods, error: null }) }) }) }
    }
    if (table === 'payroll_month_approvals') {
      return {
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((_yearCol: string, year: number) => ({
            eq: vi.fn().mockImplementation((_monthCol: string, month: number) => {
              approvalDeletes.push({ year, month })
              return Promise.resolve({ error: null })
            }),
          })),
        }),
      }
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })
  return { client: { from }, sessionUpdates, approvalDeletes }
}

describe('updateShift premium handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPerm.mockResolvedValue(true)
  })

  it('sets a premium on edit, invalidates payroll approvals, and never writes to sessions', async () => {
    const captured: { payload?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeUpdateSupabase(CURRENT, captured) as never)
    const admin = makeAdmin({ periods: [{ year: 2026, month: 3 }] })
    mockCreateAdminClient.mockReturnValue(admin.client as never)

    const result = await updateShift('shift-1', {
      rate_multiplier: 1.5,
      rate_override: null,
      premium_reason: 'Bank holiday',
      premium_start_time: null,
      premium_end_time: null,
    })
    expect(result.success).toBe(true)
    expect(captured.payload?.rate_multiplier).toBe(1.5)
    expect(captured.payload?.premium_reason).toBe('Bank holiday')
    // Sessions inherit live now — the rota write path must never touch them.
    expect(admin.sessionUpdates).toHaveLength(0)
    // A genuine premium change drops the frozen payroll approval for the date.
    expect(admin.approvalDeletes).toEqual([{ year: 2026, month: 3 }])
  })

  it('does NOT invalidate payroll approvals when the premium is unchanged', async () => {
    // Current shift already has ×1.5; re-saving the same premium is a no-op.
    const current: CurrentShift = { ...CURRENT, rate_multiplier: 1.5 }
    const captured: { payload?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeUpdateSupabase(current, captured) as never)
    const admin = makeAdmin({ periods: [{ year: 2026, month: 3 }] })
    mockCreateAdminClient.mockReturnValue(admin.client as never)

    const result = await updateShift('shift-1', {
      rate_multiplier: 1.5, rate_override: null, premium_reason: null, premium_start_time: null, premium_end_time: null,
    })
    expect(result.success).toBe(true)
    expect(admin.approvalDeletes).toHaveLength(0)
    expect(admin.sessionUpdates).toHaveLength(0)
  })

  it('treats a string-typed current multiplier as unchanged (no needless invalidation)', async () => {
    // `numeric` reads come back as STRINGS; "1.50" must equal 1.5 so an unchanged
    // re-save does not churn payroll approvals.
    const current = { ...CURRENT, rate_multiplier: '1.50' as unknown as number }
    const captured: { payload?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeUpdateSupabase(current, captured) as never)
    const admin = makeAdmin({ periods: [{ year: 2026, month: 3 }] })
    mockCreateAdminClient.mockReturnValue(admin.client as never)

    const result = await updateShift('shift-1', {
      rate_multiplier: 1.5, rate_override: null, premium_reason: null, premium_start_time: null, premium_end_time: null,
    })
    expect(result.success).toBe(true)
    expect(admin.approvalDeletes).toHaveLength(0)
  })

  it('clears the old override when switching from a custom rate to a multiplier preset', async () => {
    // Regression: merging premium fields must let an explicit null CLEAR the other
    // rate column, otherwise the stale override survives and (override-wins) is paid.
    const current: CurrentShift = { ...CURRENT, rate_override: 20 as unknown as number, rate_multiplier: null }
    const captured: { payload?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeUpdateSupabase(current, captured) as never)
    mockCreateAdminClient.mockReturnValue(makeAdmin().client as never)

    const result = await updateShift('shift-1', {
      rate_multiplier: 1.5, rate_override: null, premium_reason: null, premium_start_time: null, premium_end_time: null,
    })
    expect(result.success).toBe(true)
    expect(captured.payload?.rate_multiplier).toBe(1.5)
    expect(captured.payload?.rate_override).toBeNull()
  })

  it('does not invalidate approvals when a windowed premium is re-saved unchanged (HH:mm vs HH:mm:ss)', async () => {
    // DB `time` columns return "HH:mm:ss"; the modal supplies "HH:mm". A no-op
    // re-save must not falsely flag a change and drop the frozen payroll approval.
    const current: CurrentShift = {
      ...CURRENT, rate_multiplier: 2, premium_start_time: '20:00:00', premium_end_time: '23:00:00',
    }
    const captured: { payload?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeUpdateSupabase(current, captured) as never)
    const admin = makeAdmin({ periods: [{ year: 2026, month: 3 }] })
    mockCreateAdminClient.mockReturnValue(admin.client as never)

    const result = await updateShift('shift-1', {
      rate_multiplier: 2, rate_override: null, premium_reason: null, premium_start_time: '20:00', premium_end_time: '23:00',
    })
    expect(result.success).toBe(true)
    expect(admin.approvalDeletes).toHaveLength(0)
  })

  it('rejects a premium window that falls outside the edited shift times', async () => {
    const captured: { payload?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeUpdateSupabase(CURRENT, captured) as never)
    mockCreateAdminClient.mockReturnValue(makeAdmin().client as never)

    const result = await updateShift('shift-1', {
      rate_multiplier: 2,
      rate_override: null,
      premium_reason: null,
      premium_start_time: '16:00', // before the 17:00 shift start
      premium_end_time: '20:00',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/within the shift/i)
    expect(captured.payload).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// initialPremiumMode seeding (modal opens with the correct preset)
// ---------------------------------------------------------------------------

describe('initialPremiumMode', () => {
  it('seeds no premium when both rate fields are null', () => {
    expect(initialPremiumMode(null, null)).toBe('none')
  })

  it('seeds the ×1.5 preset from a numeric multiplier', () => {
    expect(initialPremiumMode(1.5, null)).toBe('1.5')
  })

  it('seeds the ×2 preset from a numeric multiplier', () => {
    expect(initialPremiumMode(2, null)).toBe('2')
  })

  it('seeds the ×1.5 preset from a STRING multiplier (numeric-as-string)', () => {
    // The DB returns `numeric` as a string; "1.50" must still open as ×1.5,
    // not mis-open as Custom with a blank rate.
    expect(initialPremiumMode('1.50' as unknown as number, null)).toBe('1.5')
  })

  it('seeds the ×2 preset from a STRING multiplier', () => {
    expect(initialPremiumMode('2' as unknown as number, null)).toBe('2')
  })

  it('seeds custom for a non-standard multiplier', () => {
    expect(initialPremiumMode(1.75, null)).toBe('custom')
  })

  it('seeds custom whenever an override is present', () => {
    expect(initialPremiumMode(null, '18.50' as unknown as number)).toBe('custom')
  })
})
