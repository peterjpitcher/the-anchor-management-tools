import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildChecklistsSection } from '@/lib/insights/sections/checklists'
import { FakeDb } from '../lib/insights/helpers/fake-db'
import { makeContext } from '../lib/insights/helpers/context'

// An out-of-range reading used to be emailed at the moment it was recorded, so undoing the
// tick could not hide it. With that email gone, the instance row is the manager's only
// record (the insights report and the Problems page read value_breach from it). These tests
// prove the undo path can no longer clear it, and that the report still lists the reading.

type Row = Record<string, unknown>

const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1', user_email: 'staff@example.test' }),
}))
vi.mock('@/app/actions/timeclock', () => ({ getOpenSessions: vi.fn() }))
vi.mock('@/lib/checklists/settings', () => ({ currentBusinessDate: vi.fn(), getChecklistSettings: vi.fn() }))
vi.mock('@/lib/checklists/rota', () => ({ getPublishedShiftsForDate: vi.fn() }))

// A writable stand-in for checklist_task_instances, honouring the filters the actions use.
vi.mock('@/lib/supabase/admin', () => {
  class Query implements PromiseLike<{ data: unknown; error: null }> {
    private patch: Record<string, unknown> | null = null
    private filters: ((row: Record<string, unknown>) => boolean)[] = []
    private single = false
    select(): this { return this }
    update(patch: Record<string, unknown>): this { this.patch = patch; return this }
    eq(column: string, value: unknown): this { this.filters.push((row) => row[column] === value); return this }
    is(column: string, value: null): this { this.filters.push((row) => (row[column] ?? null) === value); return this }
    gte(column: string, value: string): this { this.filters.push((row) => String(row[column]) >= value); return this }
    maybeSingle(): this { this.single = true; return this }
    then<A = { data: unknown; error: null }, B = never>(
      onfulfilled?: ((value: { data: unknown; error: null }) => A | PromiseLike<A>) | null,
      onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      const matched = store.rows.filter((row) => this.filters.every((filter) => filter(row)))
      if (this.patch) for (const row of matched) Object.assign(row, this.patch)
      const data = this.single ? (matched[0] ? { ...matched[0] } : null) : matched.map((row) => ({ ...row }))
      return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected)
    }
  }
  return {
    createAdminClient: () => ({
      from: (table: string) => {
        if (table !== 'checklist_task_instances') throw new Error(`Unexpected table ${table}`)
        return new Query()
      },
    }),
  }
})

import { completeChecklistInstance, undoChecklistInstance } from '@/app/actions/checklists'

const INSTANCE_ID = 'inst-fridge'
const BUSINESS_DATE = '2026-09-22' // Tuesday of the week the Friday 25 September report covers

function fridgeCheck(): Row {
  return {
    id: INSTANCE_ID,
    business_date: BUSINESS_DATE,
    slot: '14:00',
    department: 'kitchen',
    title_snapshot: 'Fridge 2 temperature',
    state: 'pending',
    locked_at: null,
    grace_until: '2026-09-22T14:30:00.000Z',
    requires_value: true,
    value_min: 0,
    value_max: 5,
    value_unit: 'degC',
    value_recorded: null,
    value_breach: false,
    was_late: false,
    completed_by_employee_id: null,
    completed_at: null,
    accountable_employee_id: 'emp-a',
    notes: null,
  }
}

const row = (): Row => store.rows[0]

beforeEach(() => {
  store.rows = [fridgeCheck()]
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T13:05:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('undoing a checklist tick', () => {
  it('refuses to undo an out-of-range reading, so re-recording an in-range value cannot erase it', async () => {
    expect(await completeChecklistInstance({ instanceId: INSTANCE_ID, employeeId: 'emp-a', value: 9 }))
      .toEqual({ success: true, breach: true })

    vi.setSystemTime(new Date('2026-09-22T13:08:00.000Z')) // three minutes later, inside the undo window
    const undo = await undoChecklistInstance({ instanceId: INSTANCE_ID, employeeId: 'emp-a' })
    expect(undo.success).toBeUndefined()
    expect(undo.error).toMatch(/out-of-range reading cannot be undone/i)
    expect(row()).toMatchObject({ state: 'done', value_breach: true, value_recorded: 9, completed_by_employee_id: 'emp-a' })

    const again = await completeChecklistInstance({ instanceId: INSTANCE_ID, employeeId: 'emp-a', value: 4 })
    expect(again).toMatchObject({ alreadyDone: true })
    expect(row()).toMatchObject({ state: 'done', value_breach: true, value_recorded: 9 })

    // The overnight sweep locks the day; the Friday report then lists the reading.
    row().locked_at = '2026-09-23T04:01:00Z'
    vi.setSystemTime(new Date('2026-09-25T05:00:00.000Z')) // Friday 06:00 London, as makeContext
    const db = new FakeDb({
      checklist_task_instances: [{ ...row() }],
      checklist_spot_checks: [],
      checklist_spot_check_expectations: [],
      employees: [],
      special_hours: [],
    })
    db.rpcHandlers.business_hours_for_date = () => [{ opens: '12:00:00', closes: '23:00:00', is_closed: false }]
    const section = await buildChecklistsSection(makeContext(db))
    const readings = section.lists.find((list) => list.title.startsWith('Readings out of range this week'))
    expect(readings?.items).toHaveLength(1)
    expect(readings?.items[0].text).toContain('Fridge 2 temperature read 9')
    expect(section.signals.some((signal) => signal.entity === `checklist_instance:${INSTANCE_ID}`)).toBe(true)
  })

  it('still lets the same person undo an in-range tick within 15 minutes', async () => {
    expect(await completeChecklistInstance({ instanceId: INSTANCE_ID, employeeId: 'emp-a', value: 3 }))
      .toEqual({ success: true, breach: false })
    vi.setSystemTime(new Date('2026-09-22T13:08:00.000Z'))
    expect(await undoChecklistInstance({ instanceId: INSTANCE_ID, employeeId: 'emp-a' })).toEqual({ success: true })
    expect(row()).toMatchObject({ state: 'pending', value_recorded: null, value_breach: false, completed_by_employee_id: null })
  })

  it('keeps the usual message when an in-range tick is past the undo window', async () => {
    await completeChecklistInstance({ instanceId: INSTANCE_ID, employeeId: 'emp-a', value: 3 })
    vi.setSystemTime(new Date('2026-09-22T13:21:00.000Z'))
    expect(await undoChecklistInstance({ instanceId: INSTANCE_ID, employeeId: 'emp-a' }))
      .toEqual({ error: 'Too late to undo, or this was not your tick' })
    expect(row()).toMatchObject({ state: 'done', value_recorded: 3 })
  })
})
