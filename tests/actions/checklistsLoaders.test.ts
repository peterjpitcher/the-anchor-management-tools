// The staff checklist loaders read checklist_settings once, derive the business date from it,
// and run their independent reads together (page load performance spec, 5.4 Checklists).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Resolved = { data: unknown; error: unknown }

const state = vi.hoisted(() => ({
  results: {} as Record<string, unknown>,
  started: [] as string[],
  gates: {} as Record<string, Promise<void>>,
  eqCalls: [] as Array<[string, string, unknown]>,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/audit-helpers', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/app/actions/timeclock', () => ({ getOpenSessions: vi.fn() }))
vi.mock('@/lib/checklists/settings', () => ({ getChecklistSettings: vi.fn() }))
vi.mock('@/lib/checklists/rota', () => ({ getPublishedShiftsForDate: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      state.started.push(table)
      const query: Record<string, unknown> = {}
      for (const method of ['select', 'in', 'is', 'not', 'lte', 'gte', 'order', 'limit']) {
        query[method] = () => query
      }
      query.eq = (column: string, value: unknown) => {
        state.eqCalls.push([table, column, value])
        return query
      }
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        (state.gates[table] ?? Promise.resolve())
          .then(() => (state.results[table] ?? { data: [], error: null }) as Resolved)
          .then(resolve, reject)
      return query
    },
  }),
}))

import { getAttributionCandidates, getDueChecklistPrompts, getTodayChecklist } from '@/app/actions/checklists'
import { getChecklistSettings } from '@/lib/checklists/settings'
import { getOpenSessions } from '@/app/actions/timeclock'
import { getPublishedShiftsForDate } from '@/lib/checklists/rota'

const SETTINGS = {
  autumnWinterStart: '10-01',
  autumnWinterEnd: '03-31',
  spotChecksPerDay: 2,
  defaultGraceMinutes: 30,
  businessDayStartHour: 5,
  openLeadMinutes: 60,
  closeLeadMinutes: 60,
  mismatchThresholdMinutes: 15,
  mismatchEarlyThresholdMinutes: 15,
  moduleEnabled: true,
  generationEnabled: true,
  promptsEnabled: true,
  emailsEnabled: false,
}

/** Holds a table's read open until the returned release function is called. */
function hold(table: string): () => void {
  let release: () => void = () => {}
  state.gates[table] = new Promise<void>((resolve) => {
    release = resolve
  })
  return release
}

function eqValue(table: string, column: string): unknown {
  return state.eqCalls.find(([t, c]) => t === table && c === column)?.[2]
}

beforeEach(() => {
  vi.clearAllMocks()
  state.results = {}
  state.started = []
  state.gates = {}
  state.eqCalls = []
  vi.mocked(getChecklistSettings).mockResolvedValue({ ...SETTINGS })
  vi.mocked(getOpenSessions).mockResolvedValue({ success: true, data: [] } as never)
  vi.mocked(getPublishedShiftsForDate).mockResolvedValue([])
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getTodayChecklist', () => {
  it('reads the settings once and keeps a late close on the night it belongs to', async () => {
    // 03:30 London on Wednesday 18 November 2026 (GMT), before the 05:00 boundary.
    vi.setSystemTime(new Date('2026-11-18T03:30:00.000Z'))

    const result = await getTodayChecklist()

    expect(getChecklistSettings).toHaveBeenCalledTimes(1)
    expect(result.data?.businessDate).toBe('2026-11-17')
    expect(eqValue('checklist_task_instances', 'business_date')).toBe('2026-11-17')
    expect(eqValue('checklist_generation_runs', 'business_date')).toBe('2026-11-17')
  })

  it('rolls over at the configured hour, in summer time too', async () => {
    // 05:30 London on Monday 20 July 2026 (BST) is 04:30 UTC.
    vi.setSystemTime(new Date('2026-07-20T04:30:00.000Z'))

    const result = await getTodayChecklist()

    expect(result.data?.businessDate).toBe('2026-07-20')
  })

  it('uses an explicit date as given', async () => {
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))

    const result = await getTodayChecklist('2026-11-10')

    expect(result.data?.businessDate).toBe('2026-11-10')
    expect(getChecklistSettings).toHaveBeenCalledTimes(1)
  })

  it('reads the generation run and the tasks together', async () => {
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
    const releaseRuns = hold('checklist_generation_runs')
    state.results.checklist_generation_runs = { data: [{ status: 'complete', attempt: 1 }], error: null }

    const pending = getTodayChecklist()
    await vi.waitFor(() => {
      expect(state.started).toContain('checklist_task_instances')
    })
    // The run read has not answered, so the task read was not waiting on it.
    releaseRuns()
    const result = await pending

    expect(result.data?.generationStatus).toBe('complete')
  })

  it('still reports a failed task read as an error', async () => {
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
    state.results.checklist_task_instances = { data: null, error: { message: 'instances down' } }

    const result = await getTodayChecklist()

    expect(result).toEqual({ error: 'instances down' })
  })

  it('reads nothing else when the module is switched off', async () => {
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
    vi.mocked(getChecklistSettings).mockResolvedValue({ ...SETTINGS, moduleEnabled: false })

    const result = await getTodayChecklist()

    expect(result.data?.moduleEnabled).toBe(false)
    expect(result.data?.businessDate).toBe('2026-11-18')
    expect(state.started).toEqual([])
  })
})

describe('getDueChecklistPrompts', () => {
  it('reads the settings once and derives the business date from them', async () => {
    vi.setSystemTime(new Date('2026-11-18T03:30:00.000Z'))

    const result = await getDueChecklistPrompts()

    expect(result).toEqual({ data: [] })
    expect(getChecklistSettings).toHaveBeenCalledTimes(1)
    expect(eqValue('checklist_task_instances', 'business_date')).toBe('2026-11-17')
  })

  it('stays silent without a task read when prompts are off', async () => {
    vi.mocked(getChecklistSettings).mockResolvedValue({ ...SETTINGS, promptsEnabled: false })

    const result = await getDueChecklistPrompts()

    expect(result).toEqual({ data: [] })
    expect(state.started).toEqual([])
  })
})

describe('getAttributionCandidates', () => {
  it('starts the staff, clock-in and rota reads together', async () => {
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
    const releaseEmployees = hold('employees')
    state.results.employees = {
      data: [{ employee_id: 'ada', first_name: 'Ada', last_name: 'Active', preferred_name: null, status: 'Active', employment_end_date: null }],
      error: null,
    }
    vi.mocked(getOpenSessions).mockResolvedValue({
      success: true,
      data: [{ employee_id: 'ada', clock_in_at: '2026-11-18T11:00:00.000Z' }],
    } as never)

    const pending = getAttributionCandidates({ date: '2026-11-18', department: 'bar' })
    await vi.waitFor(() => {
      expect(getOpenSessions).toHaveBeenCalled()
      expect(getPublishedShiftsForDate).toHaveBeenCalledWith('2026-11-18')
    })
    // The staff read is still open, so neither of the others waited for it.
    releaseEmployees()
    const result = await pending

    expect(result.data).toEqual([
      { employeeId: 'ada', name: 'Ada', clockedIn: true, clockedInAt: '2026-11-18T11:00:00.000Z', rostered: false },
    ])
  })

  it('still returns the staff read error', async () => {
    state.results.employees = { data: null, error: { message: 'employees down' } }

    const result = await getAttributionCandidates({ date: '2026-11-18', department: 'bar' })

    expect(result).toEqual({ error: 'employees down' })
  })
})
