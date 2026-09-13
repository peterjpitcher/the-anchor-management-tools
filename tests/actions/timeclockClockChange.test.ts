import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Manually entered timeclock sessions across the UK clock changes.
 *
 * A manager types a work date and HH:mm times. A clock-out that is not after the clock-in is an
 * overnight shift and belongs to the next London calendar date. It used to be reached by adding
 * 24 hours to the same time on the work date, which is an hour out on the two nights the clocks
 * change: 20:00 to 02:00 on Saturday 24 October 2026 was stored an hour short, and on Saturday
 * 27 March 2027 an hour long. These tests use the real date-fns-tz (tests/actions/timeclock.test.ts
 * mocks it), so they run the same arithmetic the server does.
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

vi.mock('@/lib/timeclock/pin', () => ({
  normalizeTimeclockPin: (pin: string) => pin ?? '',
  verifyTimeclockPin: () => true,
  phoneLastFourMatchesPin: () => true,
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createTimeclockSession, updateTimeclockSession } from '@/app/actions/timeclock'
import { called, createRecordingSupabase, firstArgsOf } from '../mocks/recordingSupabase'

type StoredTimes = { clock_in_at: string; clock_out_at: string | null }

/** An admin client that records the insert or update payload for timeclock_sessions. */
function buildDatabase(stored?: StoredTimes) {
  const db = createRecordingSupabase({
    tables: {
      timeclock_sessions: (query) => {
        if (called(query, 'insert')) {
          const payload = firstArgsOf(query, 'insert')?.[0] as Record<string, unknown>
          return {
            data: { id: 'session-new', ...payload, employees: { first_name: 'Alex', last_name: 'Jones', preferred_name: null } },
            error: null,
          }
        }
        if (called(query, 'update')) {
          const payload = firstArgsOf(query, 'update')?.[0] as Record<string, unknown>
          return { data: { id: 'session-1', ...payload }, error: null }
        }
        // The update action's read of the current row: its times and premium.
        return {
          data: {
            ...(stored ?? { clock_in_at: null, clock_out_at: null }),
            rate_multiplier: null,
            rate_override: null,
            premium_reason: null,
            premium_start_at: null,
            premium_end_at: null,
          },
          error: null,
        }
      },
      payroll_periods: () => ({ data: [], error: null }),
    },
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return db
}

function writtenTimes(db: ReturnType<typeof buildDatabase>): StoredTimes {
  const write = db.queries.find(
    (query) => query.table === 'timeclock_sessions' && (called(query, 'insert') || called(query, 'update'))
  )!
  const payload = (firstArgsOf(write, 'insert') ?? firstArgsOf(write, 'update'))![0] as StoredTimes
  return { clock_in_at: payload.clock_in_at, clock_out_at: payload.clock_out_at }
}

describe('manual timeclock sessions across the clock changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe.each([
    ['createTimeclockSession', (workDate: string, clockIn: string, clockOut: string) =>
      createTimeclockSession('emp-1', workDate, clockIn, clockOut)],
    ['updateTimeclockSession', (workDate: string, clockIn: string, clockOut: string) =>
      updateTimeclockSession('session-1', workDate, clockIn, clockOut)],
  ])('%s', (_name, save) => {
    it.each([
      // Work date, clock-in, clock-out, stored clock-in, stored clock-out, hours worked.
      // Saturday 12 September 2026, BST both sides of midnight: unchanged, 6 hours.
      ['2026-09-12', '20:00', '02:00', '2026-09-12T19:00:00.000Z', '2026-09-13T01:00:00.000Z', 6],
      // Saturday 24 October 2026: 20:00 BST to 02:00 GMT is 7 hours. It was stored ending at
      // 01:00 GMT, 6 hours.
      ['2026-10-24', '20:00', '02:00', '2026-10-24T19:00:00.000Z', '2026-10-25T02:00:00.000Z', 7],
      // Saturday 27 March 2027: 20:00 GMT to 02:00 BST is 5 hours. It was stored ending at
      // 03:00 BST, 6 hours.
      ['2027-03-27', '20:00', '02:00', '2027-03-27T20:00:00.000Z', '2027-03-28T01:00:00.000Z', 5],
      // 01:30 does not exist on 28 March 2027: read as 01:30 GMT, which the clock shows as 02:30 BST.
      ['2027-03-27', '20:00', '01:30', '2027-03-27T20:00:00.000Z', '2027-03-28T01:30:00.000Z', 5.5],
      // 01:30 happens twice on 25 October 2026: read as the second, GMT, one.
      ['2026-10-24', '20:00', '01:30', '2026-10-24T19:00:00.000Z', '2026-10-25T01:30:00.000Z', 6.5],
      // A same-day shift on an ordinary day is unchanged.
      ['2026-09-15', '09:00', '17:00', '2026-09-15T08:00:00.000Z', '2026-09-15T16:00:00.000Z', 8],
    ])('%s %s to %s is stored as %s to %s', async (workDate, clockIn, clockOut, storedIn, storedOut, hours) => {
      const db = buildDatabase()

      const result = await save(workDate, clockIn, clockOut)

      expect(result.success).toBe(true)
      const times = writtenTimes(db)
      expect(times).toEqual({ clock_in_at: storedIn, clock_out_at: storedOut })
      expect((Date.parse(storedOut) - Date.parse(storedIn)) / 3_600_000).toBe(hours)
    })

    it('refuses a date that does not exist rather than failing on write', async () => {
      const db = buildDatabase()

      const result = await save('2026-02-30', '20:00', '02:00')

      expect(result).toEqual({ success: false, error: 'Invalid work date' })
      expect(db.from).not.toHaveBeenCalled()
    })

    it('refuses a time that is not on the clock', async () => {
      const db = buildDatabase()

      const result = await save('2026-09-12', '20:00', '24:30')

      expect(result).toEqual({ success: false, error: 'Invalid clock-out time' })
      expect(db.from).not.toHaveBeenCalled()
    })
  })

  describe('an edit leaves a time the manager did not change exactly as stored', () => {
    it('keeps a kiosk clock-out in the first 01:12 on 25 October when only the notes change', async () => {
      // Clocked out at the kiosk at 01:12:09 BST, the first 01:12 of the night. The edit form
      // shows and sends back "01:12", which on its own reads as the second (GMT) one.
      const db = buildDatabase({
        clock_in_at: '2026-10-24T19:02:41.000Z',
        clock_out_at: '2026-10-25T00:12:09.000Z',
      })

      const result = await updateTimeclockSession('session-1', '2026-10-24', '20:02', '01:12', 'Closed up')

      expect(result.success).toBe(true)
      expect(writtenTimes(db)).toEqual({
        clock_in_at: '2026-10-24T19:02:41.000Z',
        clock_out_at: '2026-10-25T00:12:09.000Z',
      })
    })

    it('does not keep a stored clock-out that a newly typed clock-in has overtaken', async () => {
      // Stored 01:12 is the first one (00:12 GMT). The new clock-in, 01:05 in the repeated hour,
      // reads as the second 01:05 (01:05 GMT), after it, so the typed 01:12 (GMT) is used.
      const db = buildDatabase({
        clock_in_at: '2026-10-24T23:30:00.000Z',
        clock_out_at: '2026-10-25T00:12:09.000Z',
      })

      const result = await updateTimeclockSession('session-1', '2026-10-25', '01:05', '01:12', null)

      expect(result.success).toBe(true)
      expect(writtenTimes(db)).toEqual({
        clock_in_at: '2026-10-25T01:05:00.000Z',
        clock_out_at: '2026-10-25T01:12:00.000Z',
      })
    })

    it('applies a time the manager did change', async () => {
      const db = buildDatabase({
        clock_in_at: '2026-10-24T19:02:41.000Z',
        clock_out_at: '2026-10-25T00:12:09.000Z',
      })

      const result = await updateTimeclockSession('session-1', '2026-10-24', '20:02', '02:30', null)

      expect(result.success).toBe(true)
      expect(writtenTimes(db)).toEqual({
        clock_in_at: '2026-10-24T19:02:41.000Z',
        clock_out_at: '2026-10-25T02:30:00.000Z',
      })
    })
  })
})
