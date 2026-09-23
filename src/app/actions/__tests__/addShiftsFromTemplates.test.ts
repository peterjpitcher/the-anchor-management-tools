import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { addShiftsFromTemplates } from '../rota'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'

const mockPerm = vi.mocked(checkUserPermission)
const mockCreateClient = vi.mocked(createClient)
const mockCreateAdminClient = vi.mocked(createAdminClient)

// The bulk insert goes through two RPCs: check_rota_leave_conflicts (the dry run that
// decides which rows lose their name) and then write_rota_shifts_with_leave_guard. The
// admin double supplies both, plus the read-back of the rows it created.
function makeAdmin({
  rpcResult = null as unknown,
  rpcError = null as unknown,
  inserted = [] as unknown[],
  readError = null as unknown,
  conflicts = [] as Array<{ ref: string; employee_id: string; conflict_date: string }>,
  conflictsError = null as unknown,
} = {}) {
  const rpc = vi.fn().mockImplementation((name: string, args: { p_shifts?: Array<{ ref: string }> }) => {
    if (name === 'check_rota_leave_conflicts') {
      return Promise.resolve({ data: conflicts, error: conflictsError })
    }
    return Promise.resolve({
      data: rpcResult ?? {
        status: 'written',
        shifts: (args?.p_shifts ?? []).map(entry => ({ ref: entry.ref, shift_id: `shift-${entry.ref}` })),
        conflicts: [],
        reason: null,
      },
      error: rpcError,
    })
  })

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'rota_shifts') {
      return { select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: inserted, error: readError }) }) }
    }
    if (table === 'employees') {
      return { select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })

  return { from, rpc }
}

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
    mockCreateAdminClient.mockReturnValue(makeAdmin() as never)
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

  function mockCookieClientForWrite(templates: unknown[] = [
    { id: 'tmpl-bar', name: 'Bar', start_time: '10:00:00', end_time: '18:00:00', unpaid_break_minutes: 0, department: 'bar', employee_id: null },
  ]) {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'rota_weeks') return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { week_start: '2026-03-16' }, error: null }),
        }
        if (table === 'rota_shift_templates') return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: templates, error: null }),
        }
        if (table === 'rota_shifts') return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
      }),
    } as never)
  }

  it('returns error when the guarded write fails', async () => {
    mockCookieClientForWrite()
    mockCreateAdminClient.mockReturnValue(makeAdmin({ rpcError: { message: 'DB error' } }) as never)

    const result = await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-bar', date: '2026-03-16' }])
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain('DB error')
  })

  it('refuses the whole batch when the guard reports approved leave', async () => {
    mockCookieClientForWrite()
    mockCreateAdminClient.mockReturnValue(makeAdmin({
      rpcResult: {
        status: 'leave_conflict',
        shifts: [],
        conflicts: [{ ref: '0', employee_id: 'emp-1', conflict_date: '2026-03-16' }],
        reason: 'employee_on_leave',
      },
    }) as never)

    const result = await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-bar', date: '2026-03-16' }])
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('No shifts were added')
      expect(result.error).toContain('approved leave')
    }
  })

  it('writes the batch through the leave guard', async () => {
    mockCookieClientForWrite()
    const admin = makeAdmin({
      inserted: [{ id: 'shift-0', week_id: 'week-1', shift_date: '2026-03-16', department: 'bar' }],
    })
    mockCreateAdminClient.mockReturnValue(admin as never)

    const result = await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-bar', date: '2026-03-16' }])
    expect(result.success).toBe(true)
    expect(admin.rpc).toHaveBeenCalledWith(
      'write_rota_shifts_with_leave_guard',
      expect.objectContaining({ p_shifts: expect.any(Array) }),
    )
  })

  // -------------------------------------------------------------------------
  // Approved leave turns a templated shift open rather than blocking the batch
  // -------------------------------------------------------------------------

  const assignedTemplate = [{
    id: 'tmpl-kit', name: 'Kitchen', start_time: '09:00:00', end_time: '15:00:00',
    unpaid_break_minutes: 30, department: 'kitchen', employee_id: 'emp-1',
  }]

  function writeCall(admin: { rpc: ReturnType<typeof vi.fn> }) {
    const call = admin.rpc.mock.calls.find(c => c[0] === 'write_rota_shifts_with_leave_guard')
    return (call?.[1] as { p_shifts: Array<{ values: Record<string, unknown> }> }).p_shifts
  }

  it('drops the name and opens the shift when the template employee is on approved leave', async () => {
    mockCookieClientForWrite(assignedTemplate)
    const admin = makeAdmin({
      conflicts: [{ ref: '0', employee_id: 'emp-1', conflict_date: '2026-03-16' }],
      inserted: [{ id: 'shift-0', week_id: 'week-1', shift_date: '2026-03-16', department: 'kitchen' }],
    })
    mockCreateAdminClient.mockReturnValue(admin as never)

    const result = await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-kit', date: '2026-03-16' }])

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.created).toBe(1)
      expect(result.opened).toBe(1)
    }

    const written = writeCall(admin)
    expect(written).toHaveLength(1)
    expect(written[0].values.employee_id).toBeNull()
    expect(written[0].values.is_open_shift).toBe(true)
    // Nobody is on the shift, so there is nothing left to accept.
    expect(written[0].values.acceptance_status).toBeNull()
  })

  it('opens only the clashing row and leaves the rest of the batch assigned', async () => {
    mockCookieClientForWrite([
      ...assignedTemplate,
      { id: 'tmpl-bar', name: 'Bar', start_time: '10:00:00', end_time: '18:00:00', unpaid_break_minutes: 0, department: 'bar', employee_id: 'emp-2' },
    ])
    const admin = makeAdmin({
      conflicts: [{ ref: '0', employee_id: 'emp-1', conflict_date: '2026-03-16' }],
      inserted: [
        { id: 'shift-0', week_id: 'week-1', shift_date: '2026-03-16', department: 'kitchen' },
        { id: 'shift-1', week_id: 'week-1', shift_date: '2026-03-16', department: 'bar' },
      ],
    })
    mockCreateAdminClient.mockReturnValue(admin as never)

    const result = await addShiftsFromTemplates('week-1', [
      { templateId: 'tmpl-kit', date: '2026-03-16' },
      { templateId: 'tmpl-bar', date: '2026-03-16' },
    ])

    expect(result.success).toBe(true)
    if (result.success) expect(result.opened).toBe(1)

    const written = writeCall(admin)
    expect(written[0].values.employee_id).toBeNull()
    expect(written[1].values.employee_id).toBe('emp-2')
    expect(written[1].values.is_open_shift).toBe(false)
  })

  it('keeps the employee when the dry run finds no leave', async () => {
    mockCookieClientForWrite(assignedTemplate)
    const admin = makeAdmin({
      inserted: [{ id: 'shift-0', week_id: 'week-1', shift_date: '2026-03-16', department: 'kitchen' }],
    })
    mockCreateAdminClient.mockReturnValue(admin as never)

    const result = await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-kit', date: '2026-03-16' }])

    expect(result.success).toBe(true)
    if (result.success) expect(result.opened).toBe(0)
    expect(writeCall(admin)[0].values.employee_id).toBe('emp-1')
  })

  it('does not run the dry run when every templated row is already an open shift', async () => {
    mockCookieClientForWrite()
    const admin = makeAdmin({
      inserted: [{ id: 'shift-0', week_id: 'week-1', shift_date: '2026-03-16', department: 'bar' }],
    })
    mockCreateAdminClient.mockReturnValue(admin as never)

    await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-bar', date: '2026-03-16' }])

    expect(admin.rpc).not.toHaveBeenCalledWith('check_rota_leave_conflicts', expect.anything())
  })

  it('reports the error and writes nothing when the dry run itself fails', async () => {
    mockCookieClientForWrite(assignedTemplate)
    const admin = makeAdmin({ conflictsError: { message: 'leave lookup failed' } })
    mockCreateAdminClient.mockReturnValue(admin as never)

    const result = await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-kit', date: '2026-03-16' }])

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain('leave lookup failed')
    expect(admin.rpc).not.toHaveBeenCalledWith('write_rota_shifts_with_leave_guard', expect.anything())
  })
})
