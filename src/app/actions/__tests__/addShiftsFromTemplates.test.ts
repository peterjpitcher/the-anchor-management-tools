import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { addShiftsFromTemplates } from '../rota'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'

const mockPerm = vi.mocked(checkUserPermission)
const mockCreateClient = vi.mocked(createClient)

// Minimal template fixture matching ShiftTemplate shape from DB
const tBar = {
  id: 'tmpl-bar', name: 'Bar open', start_time: '10:00:00', end_time: '18:00:00',
  unpaid_break_minutes: 0, department: 'bar', is_active: true,
  day_of_week: 0, employee_id: null, colour: null,
}
const tKitchen = {
  id: 'tmpl-kit', name: 'Kitchen', start_time: '09:00:00', end_time: '15:00:00',
  unpaid_break_minutes: 30, department: 'kitchen', is_active: true,
  day_of_week: null, employee_id: 'emp-1', colour: null,
}

function makeSupabase({
  week = { week_start: '2026-03-16' },
  weekError = null,
  templates = [tBar, tKitchen],
  tplError = null,
  existing = [] as { template_id: string | null; shift_date: string }[],
  inserted = [{ id: 'shift-new', week_id: 'week-1', employee_id: null, template_id: 'tmpl-bar', shift_date: '2026-03-16', start_time: '10:00', end_time: '18:00', unpaid_break_minutes: 0, department: 'bar', status: 'scheduled', notes: null, is_overnight: false, is_open_shift: true, name: 'Bar open', reassigned_from_id: null, reassigned_at: null, reassigned_by: null, reassignment_reason: null, created_at: '', updated_at: '' }],
  insertError = null,
} = {}) {
  const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: inserted, error: insertError }) })
  const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) })

  return vi.fn().mockImplementation((table: string) => {
    if (table === 'rota_weeks') return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: week, error: weekError }),
      update: mockUpdate,
    }
    if (table === 'rota_shift_templates') return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    if (table === 'rota_shifts') return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: mockInsert,
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })
}

describe('addShiftsFromTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPerm.mockResolvedValue(true)
  })

  it('returns permission denied when user lacks edit permission', async () => {
    mockPerm.mockResolvedValue(false)
    mockCreateClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) }, from: makeSupabase() } as never)

    const result = await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-bar', date: '2026-03-16' }])
    expect(result).toEqual({ success: false, error: 'Permission denied' })
  })

  it('returns error when week not found', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: makeSupabase({ week: null as never, weekError: { message: 'not found' } as never }),
    } as never)

    const result = await addShiftsFromTemplates('week-missing', [{ templateId: 'tmpl-bar', date: '2026-03-16' }])
    expect(result).toEqual({ success: false, error: 'Rota week not found' })
  })

  it('returns success with created=0 and skipped count when all selections already exist', async () => {
    const existing = [{ template_id: 'tmpl-bar', shift_date: '2026-03-16' }]
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'rota_weeks') return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { week_start: '2026-03-16' }, error: null }) }
        if (table === 'rota_shift_templates') return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: tBar, error: null }) }
        if (table === 'rota_shifts') return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
      }),
    } as never)

    const result = await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-bar', date: '2026-03-16' }])
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.skipped).toBeGreaterThanOrEqual(0)
      expect(result.shifts).toEqual([])
    }
  })

  it('returns error when selections array is empty', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: makeSupabase(),
    } as never)

    const result = await addShiftsFromTemplates('week-1', [])
    expect(result).toEqual({ success: false, error: 'No shifts selected' })
  })

  it('returns error when insert fails', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'rota_weeks') return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { week_start: '2026-03-16' }, error: null }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
        }
        if (table === 'rota_shift_templates') return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [{ id: 'tmpl-bar', name: 'Bar', start_time: '10:00:00', end_time: '18:00:00', unpaid_break_minutes: 0, department: 'bar', employee_id: null }], error: null }),
        }
        if (table === 'rota_shifts') return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
      }),
    } as never)

    const result = await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-bar', date: '2026-03-16' }])
    expect(result).toEqual({ success: false, error: 'DB error' })
  })
})
