import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the service-role admin client with a chainable query builder that mirrors
// the Supabase shape. Every chain method returns the same chain; the chain is
// thenable (so `await db.from(...).select(...).eq(...)` resolves) and also exposes
// `.range()` (so the fetchAllRows paginator works). Data is routed per table via
// `tableData`; a per-table `rangeQueue` lets us drive multi-page pagination.
// ---------------------------------------------------------------------------

type Resolved = { data: unknown; error: unknown }

let tableData: Record<string, Resolved> = {}
let rangeQueue: Record<string, Resolved[]> = {}
const eqCalls: Array<[string, unknown]> = []
const rangeCalls: Array<[number, number]> = []

function resolvedFor(table: string): Resolved {
  return tableData[table] ?? { data: [], error: null }
}

function makeChain(table: string): Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'gte', 'lte', 'in', 'order']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value])
    return chain
  })
  chain.range = vi.fn((from: number, to: number) => {
    rangeCalls.push([from, to])
    const queue = rangeQueue[table]
    if (queue && queue.length > 0) return Promise.resolve(queue.shift() as Resolved)
    return Promise.resolve(resolvedFor(table))
  })
  chain.then = (resolve: (value: Resolved) => void) => resolve(resolvedFor(table))
  return chain
}

const mockFrom = vi.fn((table: string) => makeChain(table))
const mockRpc = vi.fn().mockResolvedValue({ data: [{ role_name: 'super_admin' }], error: null })

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'test-user-id', user_email: 'test@example.com' }),
}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { getWeeklyReview } from '../checklists-review'
import { checkUserPermission } from '@/app/actions/rbac'

// A full ReviewInstanceInput row with all columns; overrides pick what a case cares about.
function instance(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'i-default',
    template_id: 't-default',
    slot: 'open',
    business_date: '2026-07-20',
    department: 'bar',
    title_snapshot: 'A task',
    state: 'pending',
    completed_by_employee_id: null,
    completed_at: null,
    was_late: null,
    value_recorded: null,
    value_unit: null,
    value_breach: null,
    skip_reason: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  mockRpc.mockResolvedValue({ data: [{ role_name: 'super_admin' }], error: null })
  tableData = {}
  rangeQueue = {}
  eqCalls.length = 0
  rangeCalls.length = 0
})

describe('getWeeklyReview permission gate', () => {
  it('returns Insufficient permissions and reads no data when not manage-capable', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)

    const result = await getWeeklyReview('2026-07-22')

    expect(result.error).toBe('Insufficient permissions')
    expect(result.data).toBeUndefined()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('returns Insufficient permissions when the user is not a super admin', async () => {
    mockRpc.mockResolvedValue({ data: [{ role_name: 'manager' }], error: null })

    const result = await getWeeklyReview('2026-07-22')

    expect(result.error).toBe('Insufficient permissions')
    expect(result.data).toBeUndefined()
    // The role RPC ran (gate), but no table reads happened.
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('getWeeklyReview happy path', () => {
  beforeEach(() => {
    tableData['checklist_task_instances'] = {
      data: [
        instance({
          id: 'iA',
          template_id: 't1',
          slot: 'open',
          business_date: '2026-07-20',
          title_snapshot: 'Open fridge check',
          state: 'done',
          completed_by_employee_id: 'e1',
          completed_at: '2026-07-20T06:15:00Z',
        }),
        instance({
          id: 'iB',
          template_id: 't1',
          slot: 'open',
          business_date: '2026-07-21',
          title_snapshot: 'Open fridge check',
          state: 'missed',
        }),
        instance({
          id: 'iC',
          template_id: 't2',
          slot: 'close',
          business_date: '2026-07-20',
          title_snapshot: 'Close temperature',
          state: 'done',
          completed_by_employee_id: 'e2',
          completed_at: '2026-07-20T23:40:00Z',
          value_recorded: 9,
          value_unit: 'C',
          value_breach: true,
        }),
      ],
      error: null,
    }
    tableData['checklist_generation_runs'] = {
      data: [
        { business_date: '2026-07-20', status: 'complete', started_at: '2026-07-20T05:00:00Z', finished_at: '2026-07-20T05:02:00Z' },
        { business_date: '2026-07-21', status: 'complete', started_at: '2026-07-21T05:00:00Z', finished_at: '2026-07-21T05:02:00Z' },
      ],
      error: null,
    }
    tableData['checklist_spot_checks'] = { data: [{ instance_id: 'iC' }], error: null }
    tableData['employees'] = {
      data: [
        { employee_id: 'e1', first_name: 'Jacob', last_name: 'Hambridge' },
        { employee_id: 'e2', first_name: 'Sam', last_name: 'Barwood' },
      ],
      error: null,
    }
  })

  it('returns the week frame, departments, dateHealth and assembled rows', async () => {
    const result = await getWeeklyReview('2026-07-22')

    expect(result.error).toBeUndefined()
    const data = result.data
    expect(data).toBeDefined()
    if (!data) return

    expect(data.weekStart).toBe('2026-07-20')
    expect(data.weekDates).toEqual([
      '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26',
    ])
    expect(data.departments).toEqual(['bar'])
    expect(data.warnings).toEqual([])
    expect(typeof data.updatedAt).toBe('string')

    // dateHealth: complete where a run finished, 'none' elsewhere.
    expect(data.dateHealth['2026-07-20']).toBe('complete')
    expect(data.dateHealth['2026-07-21']).toBe('complete')
    expect(data.dateHealth['2026-07-22']).toBe('none')
    expect(Object.keys(data.dateHealth)).toHaveLength(7)

    // One row per (template_id, slot); sorted opening (t1) before closing (t2).
    expect(data.rows).toHaveLength(2)
    const [opening, closing] = data.rows
    expect(opening.templateId).toBe('t1')
    expect(opening.slot).toBe('open')
    expect(opening.dayPart).toBe('opening')
    expect(opening.title).toBe('Open fridge check')
    expect(opening.cells).toHaveLength(7)

    // Cell states along the opening row.
    expect(opening.cells[0].state).toBe('done')
    expect(opening.cells[0].completedByName).toBe('Jacob Hambridge')
    expect(opening.cells[0].completedAt).toBe('2026-07-20T06:15:00Z')
    expect(opening.cells[1].state).toBe('missed')
    // No instance on a 'none' health day -> no_data (not a clean blank).
    expect(opening.cells[2].state).toBe('no_data')

    // Closing row surfaces value breach and the failed spot check.
    expect(closing.templateId).toBe('t2')
    expect(closing.dayPart).toBe('closing')
    expect(closing.cells[0].state).toBe('done')
    expect(closing.cells[0].valueRecorded).toBe(9)
    expect(closing.cells[0].valueBreach).toBe(true)
    expect(closing.cells[0].spotCheckFailed).toBe(true)
    expect(closing.cells[0].completedByName).toBe('Sam Barwood')
  })
})

describe('getWeeklyReview department filter', () => {
  it('applies an equality filter on department to the instance query', async () => {
    tableData['checklist_task_instances'] = {
      data: [instance({ id: 'iA', template_id: 't1', slot: 'open', state: 'done', department: 'bar' })],
      error: null,
    }

    const result = await getWeeklyReview('2026-07-22', { department: 'bar' })

    expect(result.error).toBeUndefined()
    expect(result.data?.departments).toEqual(['bar'])
    // The instance read carried the department equality filter.
    expect(eqCalls).toContainEqual(['department', 'bar'])
  })

  it('does not filter on department when none is supplied', async () => {
    tableData['checklist_task_instances'] = {
      data: [instance({ id: 'iA', template_id: 't1', slot: 'open', state: 'done' })],
      error: null,
    }

    await getWeeklyReview('2026-07-22')

    expect(eqCalls.some(([column]) => column === 'department')).toBe(false)
  })
})

describe('getWeeklyReview pagination', () => {
  it('fetches a second page when the first returns a full 1000 rows', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) =>
      instance({ id: `p1-${index}`, template_id: `tp-${index}`, slot: 'open', state: 'pending' }),
    )
    const secondPage = [instance({ id: 'p2-0', template_id: 'tp-last', slot: 'open', state: 'pending' })]
    rangeQueue['checklist_task_instances'] = [
      { data: firstPage, error: null },
      { data: secondPage, error: null },
    ]

    const result = await getWeeklyReview('2026-07-22')

    expect(result.error).toBeUndefined()
    // A full first page forced a second range() call at the next 1000-row offset.
    expect(rangeCalls).toEqual([[0, 999], [1000, 1999]])
    // 1000 + 1 distinct templates assembled into rows.
    expect(result.data?.rows).toHaveLength(1001)
  })
})

describe('getWeeklyReview degradation', () => {
  it('records a warning but still returns data when the instance read succeeds and enrichment fails', async () => {
    tableData['checklist_task_instances'] = {
      data: [instance({ id: 'iA', template_id: 't1', slot: 'open', state: 'done', completed_by_employee_id: 'e1' })],
      error: null,
    }
    tableData['employees'] = { data: null, error: { message: 'employees unavailable' } }

    const result = await getWeeklyReview('2026-07-22')

    expect(result.error).toBeUndefined()
    expect(result.data?.rows).toHaveLength(1)
    expect(result.data?.warnings.some((w) => w.includes('Employee names'))).toBe(true)
    // Unresolved completer falls back to Unknown.
    expect(result.data?.rows[0].cells[0].completedByName).toBe('Unknown')
  })

  it('returns a hard error when the instance read itself fails', async () => {
    tableData['checklist_task_instances'] = { data: null, error: new Error('instances read failed') }

    const result = await getWeeklyReview('2026-07-22')

    expect(result.data).toBeUndefined()
    expect(result.error).toBe('instances read failed')
  })
})
