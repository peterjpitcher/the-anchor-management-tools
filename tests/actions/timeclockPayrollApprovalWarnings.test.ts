import { beforeEach, describe, expect, it, vi } from 'vitest'

// A clock event or a manager session edit changes pay, so it clears the frozen payroll approval
// covering its work date. When that clear (or the pay period lookup that names it) fails, or a
// kiosk clock-in cannot be linked to its shift, the change still stands:
//  - manager actions return success with a warning the review screen shows;
//  - kiosk clock in and out never show the employee a payroll warning; the owner is emailed
//    through the cron alert inbox instead.

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
// The PIN check is not what these tests exercise: treat any supplied PIN as valid.
vi.mock('@/lib/timeclock/pin', () => ({
  normalizeTimeclockPin: (pin: string) => pin ?? '',
  verifyTimeclockPin: () => true,
  phoneLastFourMatchesPin: () => true,
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { reportCronFailure } from '@/lib/cron/alerting'
import {
  clockIn,
  clockOut,
  createTimeclockSession,
  deleteTimeclockSession,
  updateTimeclockSession,
} from '@/app/actions/timeclock'

const DB_REFUSAL = { message: 'permission denied for table', code: '42501' }
const WORK_DATE = '2026-07-07'

type Result = { data?: unknown; error: unknown }

type MockOptions = {
  /** The payroll_periods lookup fails, so nobody knows which approvals to clear. */
  periodsError?: boolean
  /** Every payroll_month_approvals delete is refused. */
  approvalDeleteError?: boolean
  /** The kiosk clock-in's rota_shifts lookup fails. */
  shiftsError?: boolean
  /** The write that links a kiosk clock-in to its shift is refused. */
  linkError?: boolean
  /** The shift the kiosk clock-in should link to; null for none. */
  shift?: Record<string, unknown> | null
  /** The open session clockOut finds. */
  openSession?: { id: string; work_date: string } | null
}

/** "Now" in London as a scheduled shift that a clock-in made now would link to. */
function shiftStartingNow(): Record<string, unknown> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const part = (type: string) => parts.find(p => p.type === type)!.value
  return {
    id: 'shift-1',
    start_time: `${part('hour')}:${part('minute')}:00`,
    end_time: '23:59:00',
    shift_date: `${part('year')}-${part('month')}-${part('day')}`,
    is_overnight: false,
  }
}

/**
 * A table-aware admin client. Each from() call gets a fresh chain that remembers whether it is an
 * insert, update, delete or plain read, and resolves to what that operation should return.
 */
function makeAdmin(options: MockOptions = {}) {
  const sessionUpdates: Array<Record<string, unknown>> = []
  const approvalDeletes: Array<{ year: number; month: number }> = []

  function chainFor(resolveFor: (mode: string, payload: Record<string, unknown> | undefined) => {
    then: Result
    single?: Result
    maybeSingle?: Result
  }) {
    let mode = 'select'
    let payload: Record<string, unknown> | undefined
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'limit', 'lte', 'gte', 'order']) {
      chain[method] = vi.fn(() => chain)
    }
    chain.insert = vi.fn((value: Record<string, unknown>) => { mode = 'insert'; payload = value; return chain })
    chain.update = vi.fn((value: Record<string, unknown>) => { mode = 'update'; payload = value; return chain })
    chain.delete = vi.fn(() => { mode = 'delete'; return chain })
    chain.single = vi.fn(async () => resolveFor(mode, payload).single ?? { data: null, error: null })
    chain.maybeSingle = vi.fn(async () => resolveFor(mode, payload).maybeSingle ?? { data: null, error: null })
    chain.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resolveFor(mode, payload).then).then(resolve, reject)
    return chain
  }

  const from = vi.fn((table: string) => {
    if (table === 'employees') {
      return chainFor(() => ({
        then: { data: null, error: null },
        single: {
          data: { employee_id: 'emp-1', status: 'Active', mobile_number: null, phone_number: null, timeclock_pin_hash: 'hash' },
          error: null,
        },
      }))
    }

    if (table === 'timeclock_sessions') {
      return chainFor((mode, payload) => {
        if (mode === 'update' && payload) sessionUpdates.push(payload)
        if (mode === 'insert') {
          return {
            then: { data: null, error: null },
            single: {
              data: {
                id: 'sess-new',
                employee_id: 'emp-1',
                work_date: WORK_DATE,
                clock_in_at: `${WORK_DATE}T17:00:00.000Z`,
                clock_out_at: null,
                employees: { first_name: 'Sam', last_name: 'Smith', preferred_name: null },
              },
              error: null,
            },
          }
        }
        if (mode === 'update') {
          const isLink = payload !== undefined && 'linked_shift_id' in payload
          return {
            then: { data: null, error: isLink && options.linkError ? DB_REFUSAL : null },
            single: { data: { id: 'sess-1', work_date: WORK_DATE }, error: null },
            maybeSingle: { data: { id: 'sess-1', employee_id: 'emp-1', clock_in_at: `${WORK_DATE}T17:00:00.000Z` }, error: null },
          }
        }
        if (mode === 'delete') return { then: { data: null, error: null } }
        return {
          then: { data: null, error: null },
          // The manager edit and delete read the stored row first.
          single: {
            data: {
              work_date: WORK_DATE,
              clock_in_at: `${WORK_DATE}T17:00:00.000Z`,
              clock_out_at: `${WORK_DATE}T22:00:00.000Z`,
              rate_multiplier: null,
              rate_override: null,
              premium_reason: null,
              premium_start_at: null,
              premium_end_at: null,
            },
            error: null,
          },
          // clockIn's open-session check finds none; clockOut finds the one given.
          maybeSingle: { data: options.openSession ?? null, error: null },
        }
      })
    }

    if (table === 'rota_shifts') {
      return chainFor(() => ({
        then: options.shiftsError
          ? { data: null, error: DB_REFUSAL }
          : { data: options.shift ? [options.shift] : [], error: null },
      }))
    }

    if (table === 'payroll_periods') {
      return chainFor(() => ({
        then: options.periodsError
          ? { data: null, error: DB_REFUSAL }
          : { data: [{ year: 2026, month: 7 }], error: null },
      }))
    }

    if (table === 'payroll_month_approvals') {
      const chain = chainFor(() => ({ then: { error: options.approvalDeleteError ? DB_REFUSAL : null } }))
      const eqs: Array<[string, number]> = []
      chain.eq = vi.fn((column: string, value: number) => {
        eqs.push([column, value])
        if (eqs.length === 2) approvalDeletes.push({ year: eqs[0][1], month: eqs[1][1] })
        return chain
      })
      return chain
    }

    throw new Error(`Unexpected table: ${table}`)
  })

  vi.mocked(createAdminClient).mockReturnValue({ from } as never)
  return { sessionUpdates, approvalDeletes }
}

const SAVED_WARNING =
  'The clock times were saved, but the payroll approval covering 7 July 2026 could not be cleared, so the approved payroll figures are now out of date. Please re-approve payroll for that month, or tell the developer if this keeps happening.'
const DELETED_WARNING =
  'The session was deleted, but the payroll approval covering 7 July 2026 could not be cleared, so the approved payroll figures are now out of date. Please re-approve payroll for that month, or tell the developer if this keeps happening.'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('manager session edits warn when the payroll approval was not cleared', () => {
  it('updateTimeclockSession saves and warns when the approval delete is refused', async () => {
    const admin = makeAdmin({ approvalDeleteError: true })

    const result = await updateTimeclockSession('sess-1', WORK_DATE, '18:00', '23:00', null)

    expect(result.success).toBe(true)
    expect(admin.approvalDeletes).toEqual([{ year: 2026, month: 7 }])
    expect(result.success && result.warning).toBe(SAVED_WARNING)
  })

  it('updateTimeclockSession saves and warns when the pay period lookup fails', async () => {
    const admin = makeAdmin({ periodsError: true })

    const result = await updateTimeclockSession('sess-1', WORK_DATE, '18:00', '23:00', null)

    expect(result.success).toBe(true)
    expect(admin.approvalDeletes).toHaveLength(0)
    expect(result.success && result.warning).toBe(SAVED_WARNING)
  })

  it('updateTimeclockSession carries no warning when the approval is cleared', async () => {
    const admin = makeAdmin()

    const result = await updateTimeclockSession('sess-1', WORK_DATE, '18:00', '23:00', null)

    expect(result.success).toBe(true)
    expect(admin.approvalDeletes).toEqual([{ year: 2026, month: 7 }])
    expect(result).not.toHaveProperty('warning')
  })

  it('createTimeclockSession adds the entry and warns when the approval delete is refused', async () => {
    makeAdmin({ approvalDeleteError: true })

    const result = await createTimeclockSession('emp-1', WORK_DATE, '18:00', '23:00')

    expect(result.success).toBe(true)
    expect(result.success && result.warning).toBe(SAVED_WARNING)
  })

  it('createTimeclockSession carries no warning when the approval is cleared', async () => {
    makeAdmin()

    const result = await createTimeclockSession('emp-1', WORK_DATE, '18:00', '23:00')

    expect(result.success).toBe(true)
    expect(result).not.toHaveProperty('warning')
  })

  it('deleteTimeclockSession deletes and warns when the pay period lookup fails', async () => {
    makeAdmin({ periodsError: true })

    const result = await deleteTimeclockSession('sess-1')

    expect(result).toEqual({ success: true, warning: DELETED_WARNING })
  })

  it('deleteTimeclockSession carries no warning when the approval is cleared', async () => {
    makeAdmin()

    const result = await deleteTimeclockSession('sess-1')

    expect(result).toEqual({ success: true })
  })
})

describe('kiosk clock in and out alert the owner, never the employee', () => {
  it('clockIn succeeds without a warning and alerts the owner when the approval delete is refused', async () => {
    makeAdmin({ approvalDeleteError: true, shift: null })

    const result = await clockIn('emp-1', '0123')

    expect(result.success).toBe(true)
    expect(result).not.toHaveProperty('warning')
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportCronFailure).mock.calls[0][0]).toBe('timeclock: a clock-in could not clear the payroll approval')
  })

  it('clockIn succeeds without a warning and alerts the owner when the link to its shift is refused', async () => {
    const admin = makeAdmin({ linkError: true, shift: shiftStartingNow() })

    const result = await clockIn('emp-1', '0123')

    expect(result.success).toBe(true)
    expect(result).not.toHaveProperty('warning')
    expect(admin.sessionUpdates).toContainEqual({ linked_shift_id: 'shift-1' })
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportCronFailure).mock.calls[0][0]).toBe('timeclock: a clock-in could not be linked to its shift')
  })

  it('clockIn alerts the owner and does not mark the session unscheduled when the shift lookup fails', async () => {
    const admin = makeAdmin({ shiftsError: true })

    const result = await clockIn('emp-1', '0123')

    expect(result.success).toBe(true)
    expect(admin.sessionUpdates).toHaveLength(0)
    expect(vi.mocked(reportCronFailure).mock.calls.map(call => call[0])).toEqual([
      'timeclock: a clock-in could not be linked to its shift',
    ])
  })

  it('clockIn sends no alert when the link and the approval clear both work', async () => {
    const admin = makeAdmin({ shift: shiftStartingNow() })

    const result = await clockIn('emp-1', '0123')

    expect(result.success).toBe(true)
    expect(admin.sessionUpdates).toContainEqual({ linked_shift_id: 'shift-1' })
    expect(admin.approvalDeletes).toHaveLength(1)
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('clockOut succeeds without a warning and alerts the owner when the pay period lookup fails', async () => {
    makeAdmin({ periodsError: true, openSession: { id: 'sess-1', work_date: WORK_DATE } })

    const result = await clockOut('emp-1', '0123')

    expect(result.success).toBe(true)
    expect(result).not.toHaveProperty('warning')
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportCronFailure).mock.calls[0][0]).toBe('timeclock: a clock-out could not clear the payroll approval')
  })

  it('clockOut sends no alert when the approval is cleared', async () => {
    makeAdmin({ openSession: { id: 'sess-1', work_date: WORK_DATE } })

    const result = await clockOut('emp-1', '0123')

    expect(result.success).toBe(true)
    expect(reportCronFailure).not.toHaveBeenCalled()
  })
})
