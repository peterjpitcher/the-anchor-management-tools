// Adding and changing an employee's rate override (FF-44, FF-45).
//
// Adding an override wrote no audit row at all, and neither write showed on the employee's own
// audit trail (it only reads rows filed against the employee). An override could start in the
// past, which silently changed pay already worked. A former employee's pay could still be
// changed. And raw Zod or Postgres text, including the constraint name for a second override on
// the same date, reached the toast.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'
import {
  addEmployeeRateOverride,
  getEmployeePaySettings,
  getEmployeeRateOverrides,
  updateEmployeeRateOverride,
  upsertEmployeePaySettings,
} from '@/app/actions/pay-bands'

const mockedPermission = checkUserPermission as unknown as ReturnType<typeof vi.fn>
const mockedCreateClient = createClient as unknown as ReturnType<typeof vi.fn>
const mockedAudit = logAuditEvent as unknown as ReturnType<typeof vi.fn>

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000009'
const OVERRIDE_ID = '00000000-0000-4000-8000-000000000002'
// 10:00 GMT on Monday 2 November 2026: the same day in London and in UTC.
const NOW = '2026-11-02T10:00:00Z'

type WriteResult = { data: Record<string, unknown> | null; error: { code: string; message: string } | null }

function clientFor(options: {
  employeeStatus?: string
  insertResult?: WriteResult
  existing?: Record<string, unknown> | null
  updateResult?: WriteResult
}) {
  const insert = vi.fn(() => ({
    select: () => ({ single: vi.fn().mockResolvedValue(options.insertResult ?? { data: null, error: null }) }),
  }))
  const update = vi.fn(() => ({
    eq: () => ({ select: () => ({ single: vi.fn().mockResolvedValue(options.updateResult ?? { data: null, error: null }) }) }),
  }))
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn((table: string) => {
      if (table === 'employees') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: { status: options.employeeStatus ?? 'Active' }, error: null }),
            }),
          }),
        }
      }
      if (table === 'employee_rate_overrides') {
        return {
          insert,
          update,
          select: () => ({
            eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: options.existing ?? null, error: null }) }),
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })
  return { insert, update }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPermission.mockResolvedValue(true)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('addEmployeeRateOverride', () => {
  it('audits the new override, and files it on the employee so their trail shows it', async () => {
    const row = { id: OVERRIDE_ID, employee_id: EMPLOYEE_ID, hourly_rate: 13.5, effective_from: '2026-11-09' }
    clientFor({ insertResult: { data: row, error: null } })

    const result = await addEmployeeRateOverride({ employeeId: EMPLOYEE_ID, hourlyRate: 13.5, effectiveFrom: '2026-11-09' })

    expect(result).toEqual({ success: true, data: row })
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'create',
      resource_type: 'employee_rate_override',
      resource_id: OVERRIDE_ID,
    }))
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'employee',
      resource_id: EMPLOYEE_ID,
      additional_info: expect.objectContaining({ action: 'add_rate_override', hourly_rate: 13.5, effective_from: '2026-11-09' }),
    }))
  })

  it('allows an override starting today', async () => {
    const row = { id: OVERRIDE_ID, employee_id: EMPLOYEE_ID, hourly_rate: 13.5, effective_from: '2026-11-02' }
    const { insert } = clientFor({ insertResult: { data: row, error: null } })

    const result = await addEmployeeRateOverride({ employeeId: EMPLOYEE_ID, hourlyRate: 13.5, effectiveFrom: '2026-11-02' })

    expect(result.success).toBe(true)
    expect(insert).toHaveBeenCalledOnce()
  })

  it('refuses an override starting in the past', async () => {
    const { insert } = clientFor({})

    const result = await addEmployeeRateOverride({ employeeId: EMPLOYEE_ID, hourlyRate: 13.5, effectiveFrom: '2026-11-01' })

    expect(result).toEqual({ success: false, error: 'A rate override cannot start in the past. Choose today or a later date.' })
    expect(insert).not.toHaveBeenCalled()
  })

  it('refuses a former employee', async () => {
    const { insert } = clientFor({ employeeStatus: 'Former' })

    const result = await addEmployeeRateOverride({ employeeId: EMPLOYEE_ID, hourlyRate: 13.5, effectiveFrom: '2026-11-09' })

    expect(result).toEqual({ success: false, error: 'This person has left, so their pay can no longer be changed.' })
    expect(insert).not.toHaveBeenCalled()
  })

  it('explains a second override on the same date in plain words', async () => {
    clientFor({
      insertResult: {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "employee_rate_overrides_unique"' },
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await addEmployeeRateOverride({ employeeId: EMPLOYEE_ID, hourlyRate: 13.5, effectiveFrom: '2026-11-09' })

    expect(result).toEqual({
      success: false,
      error: 'There is already a rate override starting on that date. Edit that one, or choose another date.',
    })
  })

  it('gives a plain message for an invalid rate, not the Zod issue list', async () => {
    clientFor({})

    const result = await addEmployeeRateOverride({ employeeId: EMPLOYEE_ID, hourlyRate: -1, effectiveFrom: '2026-11-09' })

    expect(result).toEqual({ success: false, error: 'Enter an hourly rate above zero, in pounds and pence.' })
  })
})

describe('updateEmployeeRateOverride', () => {
  const existing = { id: OVERRIDE_ID, employee_id: EMPLOYEE_ID, hourly_rate: 13, effective_from: '2026-11-20' }

  it('refuses moving a future override into the past', async () => {
    const { update } = clientFor({ existing })

    const result = await updateEmployeeRateOverride({ id: OVERRIDE_ID, hourlyRate: 13.5, effectiveFrom: '2026-10-01' })

    expect(result).toEqual({ success: false, error: 'A rate override cannot start in the past. Choose today or a later date.' })
    expect(update).not.toHaveBeenCalled()
  })

  it('files the change on the employee with the old and new rate', async () => {
    const updated = { ...existing, hourly_rate: 13.5, effective_from: '2026-11-23' }
    clientFor({ existing, updateResult: { data: updated, error: null } })

    const result = await updateEmployeeRateOverride({ id: OVERRIDE_ID, hourlyRate: 13.5, effectiveFrom: '2026-11-23' })

    expect(result).toEqual({ success: true, data: updated })
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'employee',
      resource_id: EMPLOYEE_ID,
      old_values: { hourly_rate: 13, effective_from: '2026-11-20' },
      new_values: { hourly_rate: 13.5, effective_from: '2026-11-23' },
      additional_info: expect.objectContaining({ action: 'update_rate_override', previous_hourly_rate: 13 }),
    }))
  })
})

describe('getEmployeeRateOverrides', () => {
  it('shows a plain message, not Postgres text, when the overrides cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedCreateClient.mockResolvedValue({
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '42501', message: 'permission denied for table employee_rate_overrides' },
            }),
          }),
        }),
      })),
    })

    const result = await getEmployeeRateOverrides(EMPLOYEE_ID)

    expect(result).toEqual({ success: false, error: 'The rate overrides could not be loaded. Refresh the page to try again.' })
  })
})

// siblings#5: the pay settings read is shown on the Pay and Holidays tabs, and its error wins
// over the plain rate overrides one, so its Postgres text still reached both tabs.
describe('getEmployeePaySettings', () => {
  function settingsReadFails(error: { code: string; message: string }) {
    mockedCreateClient.mockResolvedValue({
      from: vi.fn(() => ({
        select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error }) }) }),
      })),
    })
  }

  it('shows a plain message, not Postgres text, when the pay settings cannot be read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    settingsReadFails({ code: '57014', message: 'canceling statement due to statement timeout' })

    const result = await getEmployeePaySettings(EMPLOYEE_ID)

    expect(result).toEqual({
      success: false,
      error: 'The pay and holiday allowance settings could not be loaded. Refresh the page to try again.',
    })
    expect(consoleError).toHaveBeenCalledWith('[pay settings] Failed to load pay settings:', {
      code: '57014',
      message: 'canceling statement due to statement timeout',
    })
    consoleError.mockRestore()
  })

  it('still treats no settings row as no settings', async () => {
    settingsReadFails({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })

    expect(await getEmployeePaySettings(EMPLOYEE_ID)).toEqual({ success: true, data: null })
  })
})

describe('upsertEmployeePaySettings', () => {
  it('refuses to change the pay settings of someone who has left', async () => {
    const upsert = vi.fn()
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn((table: string) => {
        if (table === 'employees') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { status: 'Former' }, error: null }) }),
            }),
          }
        }
        return { upsert }
      }),
    })

    const result = await upsertEmployeePaySettings({ employeeId: EMPLOYEE_ID, payType: 'hourly', maxWeeklyHours: null })

    expect(result).toEqual({ success: false, error: 'This person has left, so their pay can no longer be changed.' })
    expect(upsert).not.toHaveBeenCalled()
  })
})
