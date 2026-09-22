// Changing a booking's time on a night that closes after midnight.
//
// New Year's Eve 2026 is 12:00 to 01:00. The route built the new start on the old start's
// calendar date, so moving a 22:00 booking to 00:15 wrote 00:15 on 31 December, nearly a day
// early, and moving a 00:15 booking back to 23:30 wrote 23:30 on 1 January, a day late. The
// booking date is the service date and never moves; the time is placed inside its hours.
//
// Instants are written in UTC so the file reads the same in both test zones: London is on GMT
// from 25 October 2026 to 28 March 2027 and on BST (UTC+1) either side.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/foh/api-auth', async () => {
  const { toLocalIsoDate } = await vi.importActual<typeof import('@/lib/dateUtils')>('@/lib/dateUtils')
  return { requireFohPermission: vi.fn(), getLondonDateIso: (now: Date = new Date()) => toLocalIsoDate(now) }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/table-bookings/move-table', () => ({
  isAssignmentConflictError: vi.fn(() => false),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingRescheduledNotificationIfAllowed: vi.fn().mockResolvedValue(undefined),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { PATCH as patchTime } from '@/app/api/foh/bookings/[id]/time/route'

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

type Hours = { opens: string | null; closes: string | null; is_closed: boolean }

const WEEKLY: Hours = { opens: '12:00:00', closes: '22:00:00', is_closed: false }
const TO_1AM: Hours = { opens: '12:00:00', closes: '01:00:00', is_closed: false }

function buildSupabase(input: {
  bookingDate: string
  bookingTime: string
  start: string
  end: string
  special?: (Hours & { date: string }) | null
  hoursError?: boolean
}) {
  const booking = {
    id: BOOKING_ID,
    status: 'confirmed',
    booking_time: input.bookingTime,
    booking_date: input.bookingDate,
    start_datetime: input.start,
    end_datetime: input.end,
    duration_minutes: 90,
    seated_at: null,
    left_at: null,
    event_id: null,
    high_chair_count: 0,
  }

  // The assignment holds the table 15 minutes longer: a turnaround gap the move must keep.
  const assignmentEnd = new Date(Date.parse(input.end) + 15 * 60 * 1000).toISOString()

  const rpc = vi.fn((fn: string, _args?: Record<string, unknown>) => {
    if (fn === 'business_hours_for_date') {
      return Promise.resolve(input.hoursError ? { data: null, error: { message: 'hours down' } } : { data: [WEEKLY], error: null })
    }
    return Promise.resolve({
      data: { state: 'updated', assignment_count: 1, high_chairs_requested: 0, high_chairs_granted: 0 },
      error: null,
    })
  })

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'special_hours') {
        return {
          select: () => ({
            in: (_column: string, dates: string[]) =>
              Promise.resolve({ data: input.special && dates.includes(input.special.date) ? [input.special] : [], error: null }),
          }),
        }
      }
      if (table === 'table_bookings') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: booking, error: null }) }),
          }),
        }
      }
      if (table === 'booking_table_assignments') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ start_datetime: input.start, end_datetime: assignmentEnd }], error: null }),
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc,
  }
  return { supabase, rpc }
}

async function moveTo(time: string, input: Parameters<typeof buildSupabase>[0]) {
  const { supabase, rpc } = buildSupabase(input)
  vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-1', supabase } as never)
  const response = await patchTime(
    new Request(`http://localhost/api/foh/bookings/${BOOKING_ID}/time`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ time }),
    }) as never,
    { params: Promise.resolve({ id: BOOKING_ID }) },
  )
  const move = rpc.mock.calls.find(([fn]) => fn === 'move_table_booking_time_v06')?.[1] as Record<string, string> | undefined
  return { status: response.status, body: await response.json(), move }
}

const NEW_YEARS_EVE = { date: '2026-12-31', ...TO_1AM }

describe('moving a booking on New Year\'s Eve', () => {
  beforeEach(() => vi.clearAllMocks())

  const at22 = {
    bookingDate: '2026-12-31',
    bookingTime: '22:00:00',
    start: '2026-12-31T22:00:00.000Z',
    end: '2026-12-31T23:30:00.000Z',
    special: NEW_YEARS_EVE,
  }

  it('moves 22:00 to 00:15 on 1 January, not 00:15 on 31 December', async () => {
    const { status, move } = await moveTo('00:15', at22)
    expect(status).toBe(200)
    expect(move).toEqual({
      p_table_booking_id: BOOKING_ID,
      p_booking_time: '00:15:00',
      p_start_datetime: '2027-01-01T00:15:00.000Z',
      p_booking_end_datetime: '2027-01-01T01:45:00.000Z',
      p_assignment_end_datetime: '2027-01-01T02:00:00.000Z',
    })
  })

  it('moves 22:00 to 23:30 on 31 December', async () => {
    const { move } = await moveTo('23:30', at22)
    expect(move?.p_start_datetime).toBe('2026-12-31T23:30:00.000Z')
  })

  it('moves a 00:15 booking back to 23:30 on 31 December, not a day late', async () => {
    const { move } = await moveTo('23:30', {
      bookingDate: '2026-12-31',
      bookingTime: '00:15:00',
      start: '2027-01-01T00:15:00.000Z',
      end: '2027-01-01T01:45:00.000Z',
      special: NEW_YEARS_EVE,
    })
    expect(move?.p_start_datetime).toBe('2026-12-31T23:30:00.000Z')
  })

  it('refuses to move a booking when the hours cannot be read, rather than guess the day', async () => {
    const { status, body, move } = await moveTo('00:15', { ...at22, hoursError: true })
    expect(status).toBe(500)
    expect(body).toEqual({ error: 'Failed to load opening hours' })
    expect(move).toBeUndefined()
  })
})

describe('an ordinary day is unchanged', () => {
  beforeEach(() => vi.clearAllMocks())

  it('moves 18:00 to 19:30 on the same date in BST', async () => {
    const { move } = await moveTo('19:30', {
      bookingDate: '2026-07-20',
      bookingTime: '18:00:00',
      start: '2026-07-20T17:00:00.000Z',
      end: '2026-07-20T18:30:00.000Z',
    })
    expect(move).toMatchObject({
      p_booking_time: '19:30:00',
      p_start_datetime: '2026-07-20T18:30:00.000Z',
      p_booking_end_datetime: '2026-07-20T20:00:00.000Z',
    })
  })
})

describe('the clock-change nights, on a day that closes at 1am', () => {
  beforeEach(() => vi.clearAllMocks())

  it('moves 22:00 to 00:30 on the night the clocks go back', async () => {
    // Saturday 24 October 2026: 22:00 BST is 21:00 UTC; 00:30 BST on the 25th is 23:30 UTC.
    const { move } = await moveTo('00:30', {
      bookingDate: '2026-10-24',
      bookingTime: '22:00:00',
      start: '2026-10-24T21:00:00.000Z',
      end: '2026-10-24T22:30:00.000Z',
      special: { date: '2026-10-24', ...TO_1AM },
    })
    expect(move?.p_start_datetime).toBe('2026-10-24T23:30:00.000Z')
  })

  it('moves 22:00 to 00:30 on the night the clocks go forward', async () => {
    // Saturday 27 March 2027: 22:00 GMT; 00:30 GMT on the 28th, before the jump at 01:00 UTC.
    const { move } = await moveTo('00:30', {
      bookingDate: '2027-03-27',
      bookingTime: '22:00:00',
      start: '2027-03-27T22:00:00.000Z',
      end: '2027-03-27T23:30:00.000Z',
      special: { date: '2027-03-27', ...TO_1AM },
    })
    expect(move?.p_start_datetime).toBe('2027-03-28T00:30:00.000Z')
  })
})
