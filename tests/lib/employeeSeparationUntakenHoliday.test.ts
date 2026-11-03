// Marking a leaver as Former records their untaken holiday for their final pay.
//
// Payroll does not read leave and the Holidays tab showed the whole yearly allowance, so a leaver's
// final pay had no figure for holiday earned but not taken. The record now says what they earned in
// the holiday year to their last working day (pro-rated), what they took, and what is left.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/rota-settings', () => ({
  getRotaSettings: vi.fn().mockResolvedValue({ holidayYearStartMonth: 1, holidayYearStartDay: 1, defaultHolidayDays: 25 }),
}))

import { logAuditEvent } from '@/app/actions/audit'
import { finalizeEmployeeSeparation } from '@/lib/employees/separation'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>
type QueryCall = { table: string; method: string; args: unknown[] }
type DayRow = { leave_date: string; leave_requests: { leave_type: string } }

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'
const MANAGER_ID = '00000000-0000-4000-8000-0000000000bb'
const LAST_WORKING_DAY = '2026-10-28'

const mockedAudit = logAuditEvent as unknown as ReturnType<typeof vi.fn>

function daysOf(leaveType: string, dates: string[]): DayRow[] {
  return dates.map((leave_date) => ({ leave_date, leave_requests: { leave_type: leaveType } }))
}

function julyDays(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `2026-07-${String(index + 1).padStart(2, '0')}`)
}

/**
 * An admin client whose query chains record their calls and resolve on await. The employee started
 * on 1 May 2025, is on notice with a last working day of 28 October 2026, has no login, and has a
 * yearly allowance of 25 days.
 */
function adminClientFor(options: { days?: DayRow[]; daysError?: { message: string; code: string } } = {}) {
  const calls: QueryCall[] = []

  function query(table: string) {
    const methods: string[] = []
    const chain: object = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') {
          let result: unknown = { data: [], error: null }
          if (table === 'employees' && methods.includes('maybeSingle')) {
            result = {
              data: {
                auth_user_id: null,
                email_address: 'alex@example.com',
                status: 'Started Separation',
                employment_start_date: '2025-05-01',
                employment_end_date: LAST_WORKING_DAY,
              },
              error: null,
            }
          } else if (table === 'employees' && methods.includes('update') && methods.includes('select')) {
            result = { data: [{ employee_id: EMPLOYEE_ID }], error: null }
          } else if (table === 'employee_pay_settings') {
            result = { data: { holiday_allowance_days: 25 }, error: null }
          } else if (table === 'leave_types') {
            result = {
              data: [
                { code: 'holiday', label: 'Holiday', consumes_allowance: true, paid: true, shown_on_rota: true, counts_in_reliability: true, allowed_at_onboarding: true, sort_order: 1, is_active: true },
                { code: 'unavailable', label: 'Not available to work', consumes_allowance: false, paid: false, shown_on_rota: true, counts_in_reliability: false, allowed_at_onboarding: true, sort_order: 2, is_active: true },
              ],
              error: null,
            }
          } else if (table === 'leave_days' && methods.includes('select')) {
            result = options.daysError
              ? { data: null, error: options.daysError }
              : { data: options.days ?? [], error: null }
          } else if (methods.includes('update') || methods.includes('delete') || methods.includes('insert')) {
            result = { data: null, error: null }
          }
          return (resolve: (value: unknown) => unknown) => resolve(result)
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(property), args })
          methods.push(String(property))
          return chain
        }
      },
    })
    return chain
  }

  const client = {
    from: vi.fn((table: string) => query(table)),
    auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ error: null }) } },
  }
  return { client: client as unknown as AdminClient, calls }
}

function notesWritten(calls: QueryCall[]): Array<{ note_text: string; created_by_user_id: string | null }> {
  return calls
    .filter((call) => call.table === 'employee_notes' && call.method === 'insert')
    .map((call) => call.args[0] as { note_text: string; created_by_user_id: string | null })
}

describe('finalizeEmployeeSeparation records untaken holiday', () => {
  let consoleError: MockInstance

  beforeEach(() => {
    vi.clearAllMocks()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('notes what they earned to their last day, what they took and what is left', async () => {
    const { client, calls } = adminClientFor({ days: daysOf('holiday', julyDays(12)) })

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: '2026-11-03', source: 'automatic' })

    expect(result).toEqual(expect.objectContaining({ success: true }))
    // 1 January to 28 October is 301 of 365 days: 25 x 301 / 365 = 20.6, less 12 taken.
    expect(notesWritten(calls).map((note) => note.note_text)).toContain(
      'Holiday at their last working day (28 October 2026): earned 20.6 days in the 2026/27 holiday year and took 12 days, leaving 8.6 days untaken to include in their final pay.',
    )
    // Only the year to the last working day, and only approved leave.
    const dayFilters = calls.filter((call) => call.table === 'leave_days' && call.method !== 'select').map((call) => [call.method, ...call.args])
    expect(dayFilters).toContainEqual(['gte', 'leave_date', '2026-01-01'])
    expect(dayFilters).toContainEqual(['lte', 'leave_date', LAST_WORKING_DAY])
    expect(dayFilters).toContainEqual(['eq', 'leave_requests.status', 'approved'])
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'access_revoked',
      additional_info: expect.objectContaining({
        untaken_holiday: { holiday_year: 2026, earned_days: 20.6, taken_days: 12, untaken_days: 8.6 },
      }),
    }))
  })

  it('does not count days they could not work as holiday taken', async () => {
    const { client, calls } = adminClientFor({
      days: [...daysOf('holiday', julyDays(2)), ...daysOf('unavailable', ['2026-08-01', '2026-08-02', '2026-08-03'])],
    })

    await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: '2026-11-03', source: 'automatic' })

    expect(notesWritten(calls).map((note) => note.note_text)).toContain(
      'Holiday at their last working day (28 October 2026): earned 20.6 days in the 2026/27 holiday year and took 2 days, leaving 18.6 days untaken to include in their final pay.',
    )
  })

  it('says when they took more than they had earned', async () => {
    const { client, calls } = adminClientFor({ days: daysOf('holiday', [...julyDays(31), '2026-08-01']).slice(0, 22) })

    await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: '2026-11-03', source: 'automatic' })

    expect(notesWritten(calls).map((note) => note.note_text)).toContain(
      'Holiday at their last working day (28 October 2026): earned 20.6 days in the 2026/27 holiday year and took 22 days: 1.4 days more than they had earned. Check their final pay.',
    )
  })

  it('still marks them as Former, and says to check by hand, when the holiday cannot be read', async () => {
    const { client, calls } = adminClientFor({ daysError: { message: 'timeout', code: '57014' } })

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: '2026-11-03', source: 'automatic' })

    expect(result).toEqual(expect.objectContaining({ success: true }))
    expect(notesWritten(calls).map((note) => note.note_text)).toContain(
      'Their untaken holiday at their last working day (28 October 2026) could not be worked out. Check their Holidays tab before their final pay.',
    )
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'access_revoked',
      additional_info: expect.objectContaining({ untaken_holiday: null }),
    }))
  })

  it('writes the note as the manager who marked them as Former', async () => {
    const { client, calls } = adminClientFor({ days: [] })

    await finalizeEmployeeSeparation(EMPLOYEE_ID, {
      adminClient: client,
      todayIso: '2026-11-03',
      source: 'manual',
      actorUser: { user_id: MANAGER_ID, user_email: 'manager@example.com' },
    })

    const holidayNote = notesWritten(calls).find((note) => note.note_text.startsWith('Holiday at their last working day'))
    expect(holidayNote).toEqual(expect.objectContaining({ created_by_user_id: MANAGER_ID }))
    expect(holidayNote?.note_text).toContain('leaving 20.6 days untaken')
  })
})
