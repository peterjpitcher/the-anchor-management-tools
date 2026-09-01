import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PATCH } from './route'
import { NextRequest } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logAuditEvent } from '@/app/actions/audit'
import { sendTableBookingRescheduledNotificationIfAllowed } from '@/lib/table-bookings/bookings'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
  // Real London date extraction, so BST handling stays exercised rather than stubbed away.
  getLondonDateIso: vi.fn((date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(date),
  ),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))
// The rescheduled-notification side effect is exercised in its own tests; mock it
// here so this route test doesn't run the real helper against the minimal DB mock.
vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingRescheduledNotificationIfAllowed: vi.fn().mockResolvedValue(undefined),
}))

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

const makeRequest = (body: unknown, id = VALID_UUID) =>
  new NextRequest(`http://localhost/api/foh/bookings/${id}/time`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const makeParams = (id = VALID_UUID) => ({
  params: Promise.resolve({ id }),
})

const mockAuthFail = () => {
  vi.mocked(requireFohPermission).mockResolvedValueOnce({
    ok: false,
    response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  } as unknown as Awaited<ReturnType<typeof requireFohPermission>>)
}

/**
 * A 105-minute guest booking at 13:00 UTC with a 15-minute turnaround gap, so the assignment
 * runs 15 minutes past the booking. This is the shape that the previous version of the route
 * collapsed into a single 120-minute booking.
 */
const DEFAULT_BOOKING = {
  id: VALID_UUID,
  status: 'confirmed',
  booking_time: '13:00:00',
  booking_date: '2026-03-15',
  start_datetime: '2026-03-15T13:00:00.000Z',
  end_datetime: '2026-03-15T14:45:00.000Z',
  duration_minutes: 105,
  seated_at: null,
  left_at: null,
  event_id: null,
  high_chair_count: 0,
}

const DEFAULT_ASSIGNMENTS = [
  { start_datetime: '2026-03-15T13:00:00.000Z', end_datetime: '2026-03-15T15:00:00.000Z' },
]

const createSupabaseMock = (options: {
  booking?: Record<string, unknown> | null
  assignments?: Array<Record<string, unknown>>
  rpcResult?: unknown
  rpcError?: unknown
} = {}) => {
  const {
    booking = DEFAULT_BOOKING,
    assignments = DEFAULT_ASSIGNMENTS,
    rpcResult = {
      state: 'updated',
      assignment_count: 1,
      high_chairs_requested: 0,
      high_chairs_granted: 0,
    },
    rpcError = null,
  } = options

  const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: rpcError })

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'table_bookings') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: booking, error: null }) }),
        }),
      }
    }
    return {
      select: () => ({ eq: () => Promise.resolve({ data: assignments, error: null }) }),
    }
  })

  return { from, rpc }
}

const mockAuthSuccess = (dbMock: Record<string, unknown> = {}) => {
  vi.mocked(requireFohPermission).mockResolvedValueOnce({
    ok: true,
    userId: 'user-1',
    supabase: dbMock as unknown as Awaited<ReturnType<typeof requireFohPermission>>['supabase'],
  } as unknown as Awaited<ReturnType<typeof requireFohPermission>>)
}

describe('PATCH /api/foh/bookings/[id]/time', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('request validation', () => {
    it('returns 401 when auth fails', async () => {
      mockAuthFail()
      const res = await PATCH(makeRequest({ time: '14:00' }), makeParams())
      expect(res.status).toBe(401)
    })

    it('returns 400 for invalid UUID in params', async () => {
      mockAuthSuccess({})
      const res = await PATCH(makeRequest({ time: '14:00' }), makeParams('not-a-uuid'))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/invalid booking id/i)
    })

    it('returns 400 for missing time field', async () => {
      mockAuthSuccess({})
      const res = await PATCH(makeRequest({}), makeParams())
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid time format (e.g. "25:00")', async () => {
      mockAuthSuccess({})
      const res = await PATCH(makeRequest({ time: '25:00' }), makeParams())
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/hh:mm/i)
    })

    it('returns 400 for invalid time format (e.g. "9:00" without leading zero)', async () => {
      mockAuthSuccess({})
      const res = await PATCH(makeRequest({ time: '9:00' }), makeParams())
      expect(res.status).toBe(400)
    })

    it('returns 404 when the booking does not exist', async () => {
      mockAuthSuccess(createSupabaseMock({ booking: null }))
      const res = await PATCH(makeRequest({ time: '14:00' }), makeParams())
      expect(res.status).toBe(404)
    })
  })

  describe('eligibility, enforced server-side rather than trusted from the UI', () => {
    it.each(['cancelled', 'no_show', 'completed'])('refuses a %s booking', async (status) => {
      const db = createSupabaseMock({ booking: { ...DEFAULT_BOOKING, status } })
      mockAuthSuccess(db)
      const res = await PATCH(makeRequest({ time: '14:00' }), makeParams())
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('ineligible_status')
      expect(db.rpc).not.toHaveBeenCalled()
    })

    it('refuses a booking whose party has already left, even on a live status', async () => {
      const db = createSupabaseMock({
        booking: { ...DEFAULT_BOOKING, status: 'confirmed', left_at: '2026-03-15T14:00:00.000Z' },
      })
      mockAuthSuccess(db)
      const res = await PATCH(makeRequest({ time: '14:00' }), makeParams())
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('already_left')
      expect(db.rpc).not.toHaveBeenCalled()
    })

    it('refuses an event-linked booking so the table cannot drift from its event', async () => {
      const db = createSupabaseMock({
        booking: { ...DEFAULT_BOOKING, event_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' },
      })
      mockAuthSuccess(db)
      const res = await PATCH(makeRequest({ time: '14:00' }), makeParams())
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('event_linked')
      expect(db.rpc).not.toHaveBeenCalled()
    })

    it('allows a seated booking, which the UI warns about rather than blocking', async () => {
      const db = createSupabaseMock({
        booking: { ...DEFAULT_BOOKING, seated_at: '2026-03-15T13:05:00.000Z' },
      })
      mockAuthSuccess(db)
      const res = await PATCH(makeRequest({ time: '14:00' }), makeParams())
      expect(res.status).toBe(200)
      expect(db.rpc).toHaveBeenCalled()
    })

    it('returns 422 rather than a generic 500 when the stored window is unusable', async () => {
      const db = createSupabaseMock({
        booking: {
          ...DEFAULT_BOOKING,
          start_datetime: null,
          booking_date: null,
          booking_time: null,
        },
      })
      mockAuthSuccess(db)
      const res = await PATCH(makeRequest({ time: '14:00' }), makeParams())
      expect(res.status).toBe(422)
      expect((await res.json()).code).toBe('corrupt_window')
      expect(db.rpc).not.toHaveBeenCalled()
    })
  })

  describe('window arithmetic', () => {
    it('keeps the guest booking and the table hold as two separate windows', async () => {
      const db = createSupabaseMock()
      mockAuthSuccess(db)

      const res = await PATCH(makeRequest({ time: '18:00' }), makeParams())
      expect(res.status).toBe(200)

      // 13:00 UTC is 13:00 London on 2026-03-15 (before the clocks go forward), and the guest
      // booking is 105 minutes with a 15-minute turnaround on top.
      const args = db.rpc.mock.calls[0]?.[1] as Record<string, string>
      expect(db.rpc).toHaveBeenCalledWith('move_table_booking_time_v06', expect.any(Object))
      expect(args.p_table_booking_id).toBe(VALID_UUID)
      expect(args.p_booking_time).toBe('18:00:00')
      expect(args.p_start_datetime).toBe('2026-03-15T18:00:00.000Z')
      // The guest keeps their 105 minutes.
      expect(args.p_booking_end_datetime).toBe('2026-03-15T19:45:00.000Z')
      // The table stays held for the extra 15.
      expect(args.p_assignment_end_datetime).toBe('2026-03-15T20:00:00.000Z')
    })

    it('preserves the gap this booking actually carries, not the current setting', async () => {
      // A booking taken when no turnaround was configured: assignment ends with the booking.
      const db = createSupabaseMock({
        assignments: [
          { start_datetime: '2026-03-15T13:00:00.000Z', end_datetime: '2026-03-15T14:45:00.000Z' },
        ],
      })
      mockAuthSuccess(db)

      await PATCH(makeRequest({ time: '18:00' }), makeParams())
      const args = db.rpc.mock.calls[0]?.[1] as Record<string, string>
      expect(args.p_booking_end_datetime).toBe('2026-03-15T19:45:00.000Z')
      expect(args.p_assignment_end_datetime).toBe('2026-03-15T19:45:00.000Z')
    })

    it('falls back to duration_minutes when the booking row has no end', async () => {
      const db = createSupabaseMock({
        booking: { ...DEFAULT_BOOKING, end_datetime: null, duration_minutes: 90 },
        assignments: [],
      })
      mockAuthSuccess(db)

      await PATCH(makeRequest({ time: '18:00' }), makeParams())
      const args = db.rpc.mock.calls[0]?.[1] as Record<string, string>
      expect(args.p_booking_end_datetime).toBe('2026-03-15T19:30:00.000Z')
      expect(args.p_assignment_end_datetime).toBe('2026-03-15T19:30:00.000Z')
    })

    it('handles a booking with no table assignment at all', async () => {
      const db = createSupabaseMock({ assignments: [] })
      mockAuthSuccess(db)
      const res = await PATCH(makeRequest({ time: '18:00' }), makeParams())
      expect(res.status).toBe(200)
      const args = db.rpc.mock.calls[0]?.[1] as Record<string, string>
      expect(args.p_assignment_end_datetime).toBe(args.p_booking_end_datetime)
    })

    it('converts London clock time correctly during British Summer Time', async () => {
      // 1 July: London is UTC+1, so an 18:00 London arrival is 17:00 UTC.
      const db = createSupabaseMock({
        booking: {
          ...DEFAULT_BOOKING,
          booking_date: '2026-07-01',
          start_datetime: '2026-07-01T12:00:00.000Z',
          end_datetime: '2026-07-01T13:45:00.000Z',
        },
        assignments: [
          { start_datetime: '2026-07-01T12:00:00.000Z', end_datetime: '2026-07-01T14:00:00.000Z' },
        ],
      })
      mockAuthSuccess(db)

      await PATCH(makeRequest({ time: '18:00' }), makeParams())
      const args = db.rpc.mock.calls[0]?.[1] as Record<string, string>
      expect(args.p_start_datetime).toBe('2026-07-01T17:00:00.000Z')
    })
  })

  describe('no-op and conflict', () => {
    it('writes nothing and tells nobody when the time is unchanged', async () => {
      const db = createSupabaseMock()
      mockAuthSuccess(db)

      const res = await PATCH(makeRequest({ time: '13:00' }), makeParams())
      expect(res.status).toBe(200)
      expect((await res.json()).data.state).toBe('unchanged')
      expect(db.rpc).not.toHaveBeenCalled()
      expect(sendTableBookingRescheduledNotificationIfAllowed).not.toHaveBeenCalled()
      expect(logAuditEvent).not.toHaveBeenCalled()
    })

    it('maps a table clash to a 409 with a readable message', async () => {
      const db = createSupabaseMock({
        rpcError: { code: '23P01', message: 'table_assignment_overlap' },
      })
      mockAuthSuccess(db)

      const res = await PATCH(makeRequest({ time: '18:00' }), makeParams())
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.code).toBe('conflict')
      expect(json.error).toMatch(/conflicts with another booking/i)
      expect(sendTableBookingRescheduledNotificationIfAllowed).not.toHaveBeenCalled()
    })
  })

  describe('side effects', () => {
    it('always tells the guest when the time actually changed', async () => {
      mockAuthSuccess(createSupabaseMock())
      await PATCH(makeRequest({ time: '18:00' }), makeParams())
      expect(sendTableBookingRescheduledNotificationIfAllowed).toHaveBeenCalledWith(
        expect.anything(),
        { tableBookingId: VALID_UUID },
      )
    })

    it('audits the move with both windows and the surface', async () => {
      mockAuthSuccess(createSupabaseMock())
      await PATCH(makeRequest({ time: '18:00' }), makeParams())

      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'change_time',
          resource_type: 'table_booking',
          resource_id: VALID_UUID,
          operation_status: 'success',
          old_values: expect.objectContaining({ booking_time: '13:00' }),
          new_values: expect.objectContaining({ booking_time: '18:00' }),
          additional_info: expect.objectContaining({ surface: 'foh', turnaround_minutes: 15 }),
        }),
      )
    })

    it('reports a high chair lost to the move', async () => {
      const db = createSupabaseMock({
        booking: { ...DEFAULT_BOOKING, high_chair_count: 2 },
        rpcResult: {
          state: 'updated',
          assignment_count: 1,
          high_chairs_requested: 2,
          high_chairs_granted: 1,
        },
      })
      mockAuthSuccess(db)

      const res = await PATCH(makeRequest({ time: '18:00' }), makeParams())
      const json = await res.json()
      expect(json.data.high_chairs_granted).toBe(1)
      expect(json.data.high_chairs_lost).toBe(1)
    })
  })
})
