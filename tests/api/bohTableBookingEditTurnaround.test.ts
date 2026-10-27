import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/foh/api-auth', () => ({ requireBohTableBookingPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/business-hours/trading-day', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/business-hours/trading-day')>()),
  loadTradingHours: vi.fn(async (_db: unknown, dates: string[]) =>
    new Map(dates.map((date) => [date, { opens: '12:00:00', closes: '22:00:00', is_closed: false }]))),
}))
vi.mock('@/lib/table-bookings/bookings', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/table-bookings/bookings')>()),
  sendTableBookingRescheduledNotificationIfAllowed: vi.fn().mockResolvedValue(null),
  sendTableBookingCancelledSmsIfAllowed: vi.fn().mockResolvedValue(undefined),
}))

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { PATCH as patchBooking } from '@/app/api/boh/table-bookings/[id]/route'

/**
 * BK-037: the back-office edit rewrote every table assignment to the guest's window on any save,
 * a notes-only one included, which threw away the 15-minute turnaround. It now rewrites them only
 * when the date, the time or the duration changes, and carries the gap to the new window.
 */

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

// 18:00 to 19:30 London on Monday 20 July 2026 (BST), the table held to 19:45.
const EXISTING = {
  id: BOOKING_ID,
  status: 'confirmed',
  booking_date: '2026-07-20',
  booking_time: '18:00:00',
  duration_minutes: 90,
  start_datetime: '2026-07-20T17:00:00.000Z',
  end_datetime: '2026-07-20T18:30:00.000Z',
  customer_id: null,
  special_requirements: null,
  dietary_requirements: [],
  allergies: [],
  celebration_type: null,
  internal_notes: null,
  high_chair_count: 0,
  is_outside_seating: false,
}
const ASSIGNMENT = { id: 'assignment-1', start_datetime: '2026-07-20T17:00:00.000Z', end_datetime: '2026-07-20T18:45:00.000Z' }

function setup() {
  const assignmentSelectEq = vi.fn().mockResolvedValue({ data: [ASSIGNMENT], error: null })
  const assignmentSelect = vi.fn().mockReturnValue({ eq: assignmentSelectEq })
  const assignmentUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const assignmentUpdate = vi.fn().mockReturnValue({ eq: assignmentUpdateEq })

  const bookingUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BOOKING_ID }, error: null }) }),
    }),
  })
  const bookingSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: EXISTING, error: null }) }),
  })

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'table_bookings') return { select: bookingSelect, update: bookingUpdate }
      if (table === 'booking_table_assignments') return { select: assignmentSelect, update: assignmentUpdate }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
  ;(requireBohTableBookingPermission as unknown as Mock).mockResolvedValue({ ok: true, supabase, userId: 'user-1' })
  return { assignmentSelect, assignmentUpdate }
}

async function save(body: Record<string, unknown>) {
  return patchBooking(
    new Request(`http://localhost/api/boh/table-bookings/${BOOKING_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ booking_date: '2026-07-20', booking_time: '18:00', duration_minutes: 90, ...body }),
    }) as never,
    { params: Promise.resolve({ id: BOOKING_ID }) }
  )
}

describe('the back-office edit keeps the table turnaround', () => {
  beforeEach(() => vi.clearAllMocks())

  it('leaves the table windows alone when only the notes change', async () => {
    const { assignmentSelect, assignmentUpdate } = setup()

    const response = await save({ internal_notes: 'Regulars, window seat if possible' })

    expect(response.status).toBe(200)
    expect(assignmentSelect).not.toHaveBeenCalled()
    expect(assignmentUpdate).not.toHaveBeenCalled()
  })

  it('carries the 15-minute gap to the new time', async () => {
    const { assignmentUpdate } = setup()

    const response = await save({ booking_time: '19:30' })

    expect(response.status).toBe(200)
    expect(assignmentUpdate).toHaveBeenCalledWith({
      start_datetime: '2026-07-20T18:30:00.000Z',
      // The guest now ends at 21:00 London (20:00 UTC); the table is held 15 minutes longer.
      end_datetime: '2026-07-20T20:15:00.000Z',
    })
  })

  it('carries the gap through a duration change', async () => {
    const { assignmentUpdate } = setup()

    await save({ duration_minutes: 120 })

    expect(assignmentUpdate).toHaveBeenCalledWith({
      start_datetime: '2026-07-20T17:00:00.000Z',
      end_datetime: '2026-07-20T19:15:00.000Z',
    })
  })
})
