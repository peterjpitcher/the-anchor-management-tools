import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Editing a timeclock session's times must not wipe its notes.
 *
 * The payroll screen edits a row's times through updatePayrollRowTimes, which calls
 * updateTimeclockSession without notes. The update used to write `notes ?? null`, so every time
 * edit made from payroll cleared the note left on the session, and with it the note shown on the
 * payroll row. Leaving notes out now leaves them alone. An explicit null, which the rota
 * timeclock form sends when its notes field is emptied, still clears them.
 *
 * These run the real payroll and timeclock actions against a one-row timeclock_sessions that
 * applies each update it receives, so they check what ends up stored.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { updatePayrollRowTimes } from '@/app/actions/payroll'
import { updateTimeclockSession } from '@/app/actions/timeclock'
import { called, createRecordingSupabase, firstArgsOf } from '../mocks/recordingSupabase'

const STORED_NOTE = 'Stayed on to help cash up, agreed with the manager'

/** A database holding one session, worked 18:00 to 23:00 BST on Saturday 5 September 2026. */
function buildDatabase(notes: string | null) {
  const row: Record<string, unknown> = {
    id: 'session-1',
    employee_id: 'emp-1',
    work_date: '2026-09-05',
    clock_in_at: '2026-09-05T17:00:00.000Z',
    clock_out_at: '2026-09-05T22:00:00.000Z',
    notes,
    rate_multiplier: null,
    rate_override: null,
    premium_reason: null,
    premium_start_at: null,
    premium_end_at: null,
  }

  const db = createRecordingSupabase({
    tables: {
      timeclock_sessions: (query) => {
        if (called(query, 'update')) {
          Object.assign(row, firstArgsOf(query, 'update')?.[0])
        }
        return { data: { ...row }, error: null }
      },
      payroll_periods: () => ({ data: [], error: null }),
    },
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return { db, row }
}

function updatePayload(db: ReturnType<typeof buildDatabase>['db']): Record<string, unknown> {
  const write = db.queries.find((query) => query.table === 'timeclock_sessions' && called(query, 'update'))
  return firstArgsOf(write!, 'update')![0] as Record<string, unknown>
}

describe('editing a timeclock session keeps its notes unless the edit changes them', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('a payroll time edit keeps the notes already on the session', async () => {
    const { db, row } = buildDatabase(STORED_NOTE)

    // Payroll moves the clock-out from 23:00 to 23:45.
    const result = await updatePayrollRowTimes('session-1', 'emp-1', '2026-09-05', '18:00', '23:45', 2026, 9)

    expect(result).toEqual({ success: true })
    expect(row.clock_out_at).toBe('2026-09-05T22:45:00.000Z')
    expect(row.notes).toBe(STORED_NOTE)
    expect(updatePayload(db)).not.toHaveProperty('notes')
  })

  it('an update that leaves notes out keeps them', async () => {
    const { row } = buildDatabase(STORED_NOTE)

    const result = await updateTimeclockSession('session-1', '2026-09-05', '18:00', '23:45')

    expect(result.success).toBe(true)
    expect(row.notes).toBe(STORED_NOTE)
  })

  it('an explicit null still clears the notes', async () => {
    const { row } = buildDatabase(STORED_NOTE)

    const result = await updateTimeclockSession('session-1', '2026-09-05', '18:00', '23:45', null)

    expect(result.success).toBe(true)
    expect(row.notes).toBeNull()
  })

  it('new notes replace the stored ones', async () => {
    const { row } = buildDatabase(STORED_NOTE)

    const result = await updateTimeclockSession('session-1', '2026-09-05', '18:00', '23:45', 'Left at 23:45')

    expect(result.success).toBe(true)
    expect(row.notes).toBe('Left at 23:45')
  })
})
