// Editing a booking to a time after midnight on a night that closes at 1am.
//
// The BOH edit built the start from the date glued to the time, so a booking edited to 00:15
// on 31 December was written at 00:15 on 31 December, nearly a day before the guest arrives.
// The booking keeps the date it is given (the service date); its start sits inside that
// date's hours, as the booking functions read them.
//
// Instants are written in UTC so the file reads the same in both test zones: London is on GMT
// from 25 October 2026 to 28 March 2027 and on BST (UTC+1) either side.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/foh/api-auth', () => ({ requireBohTableBookingPermission: vi.fn() }))

vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

vi.mock('@/lib/table-bookings/bookings', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/table-bookings/bookings')>()),
  sendTableBookingRescheduledNotificationIfAllowed: vi.fn().mockResolvedValue(undefined),
  sendTableBookingCancelledSmsIfAllowed: vi.fn().mockResolvedValue(undefined),
}))

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { PATCH as patchBooking } from '@/app/api/boh/table-bookings/[id]/route'

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

const WEEKLY = { opens: '12:00:00', closes: '22:00:00', is_closed: false }
const SPECIALS = [
  { date: '2026-12-31', opens: '12:00:00', closes: '01:00:00', is_closed: false },
  { date: '2027-01-01', opens: null, closes: null, is_closed: true },
]

function buildSupabase() {
  const bookingUpdate = vi.fn(() => ({
    eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: BOOKING_ID }, error: null }) }) }),
  }))
  const assignmentUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'special_hours') {
        return {
          select: () => ({
            in: (_column: string, dates: string[]) =>
              Promise.resolve({ data: SPECIALS.filter((row) => dates.includes(row.date)), error: null }),
          }),
        }
      }
      if (table === 'table_bookings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: BOOKING_ID,
                    status: 'confirmed',
                    booking_date: '2026-12-31',
                    booking_time: '21:00:00',
                    duration_minutes: 90,
                    customer_id: null,
                    special_requirements: null,
                    dietary_requirements: [],
                    allergies: [],
                    celebration_type: null,
                    internal_notes: null,
                    high_chair_count: 0,
                    is_outside_seating: false,
                  },
                  error: null,
                }),
            }),
          }),
          update: bookingUpdate,
        }
      }
      if (table === 'booking_table_assignments') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [{ id: 'assignment-1', start_datetime: '2026-12-31T21:00:00.000Z', end_datetime: '2026-12-31T22:45:00.000Z' }],
                error: null,
              }),
          }),
          update: assignmentUpdate,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn((fn: string) =>
      Promise.resolve(fn === 'business_hours_for_date' ? { data: [WEEKLY], error: null } : { data: null, error: null }),
    ),
  }
  return { supabase, bookingUpdate, assignmentUpdate }
}

async function editTo(bookingDate: string, bookingTime: string) {
  const { supabase, bookingUpdate, assignmentUpdate } = buildSupabase()
  vi.mocked(requireBohTableBookingPermission).mockResolvedValue({ ok: true, supabase, userId: 'user-1' } as never)
  const response = await patchBooking(
    new Request(`http://localhost/api/boh/table-bookings/${BOOKING_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ booking_date: bookingDate, booking_time: bookingTime, duration_minutes: 90 }),
    }) as never,
    { params: Promise.resolve({ id: BOOKING_ID }) },
  )
  return {
    status: response.status,
    booking: (bookingUpdate.mock.calls[0] as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined,
    assignment: (assignmentUpdate.mock.calls[0] as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined,
  }
}

describe('BOH edit to a time after midnight on New Year\'s Eve', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes 00:15 on 31 December\'s service as 00:15 on 1 January, keeping the date', async () => {
    const { status, booking, assignment } = await editTo('2026-12-31', '00:15')
    expect(status).toBe(200)
    expect(booking).toMatchObject({
      booking_date: '2026-12-31',
      booking_time: '00:15',
      start_datetime: '2027-01-01T00:15:00.000Z',
      end_datetime: '2027-01-01T01:45:00.000Z',
    })
    expect(assignment).toEqual({ start_datetime: '2027-01-01T00:15:00.000Z', end_datetime: '2027-01-01T01:45:00.000Z' })
  })

  it('keeps an evening time on 31 December', async () => {
    const { booking } = await editTo('2026-12-31', '23:30')
    expect(booking).toMatchObject({ start_datetime: '2026-12-31T23:30:00.000Z' })
  })

  it('is unchanged on an ordinary date', async () => {
    // Monday 20 July 2026, BST: 19:30 is 18:30 UTC.
    const { booking } = await editTo('2026-07-20', '19:30')
    expect(booking).toMatchObject({ booking_date: '2026-07-20', start_datetime: '2026-07-20T18:30:00.000Z' })
  })
})
