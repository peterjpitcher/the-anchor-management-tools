import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireBohTableBookingPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

// Preserve every real export from the bookings module, but stub the two customer
// notification helpers so the edit route's wiring can be asserted without sending.
vi.mock('@/lib/table-bookings/bookings', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/table-bookings/bookings')>()),
  sendTableBookingRescheduledNotificationIfAllowed: vi.fn().mockResolvedValue(undefined),
  sendTableBookingCancelledSmsIfAllowed: vi.fn().mockResolvedValue(undefined),
}))

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { sendTableBookingRescheduledNotificationIfAllowed } from '@/lib/table-bookings/bookings'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { PATCH as patchBooking } from '@/app/api/boh/table-bookings/[id]/route'
import { PATCH as patchPreorder } from '@/app/api/boh/table-bookings/[id]/preorder/route'

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000011'
const ITEM_ID = '00000000-0000-4000-8000-000000000021'

// What the booking's table assignment held before the edit. Deliberately not the booking's own
// window: assignments can carry a turnaround gap, so a restore has to use what was stored.
const ORIGINAL_ASSIGNMENT = {
  id: '00000000-0000-4000-8000-000000000031',
  start_datetime: '2026-07-20T17:00:00.000Z',
  end_datetime: '2026-07-20T18:45:00.000Z',
}

// The route reads each assignment's current window before moving it, so that it can put the
// table back if the booking update is then refused.
function assignmentWindowRead(rows: Array<Record<string, unknown>> = [ORIGINAL_ASSIGNMENT]) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error: null })
  return vi.fn().mockReturnValue({ eq })
}

function jsonRequest(body: unknown) {
  return new Request(`http://localhost/api/boh/table-bookings/${BOOKING_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('BOH table booking edit routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates editable booking fields and assignment window', async () => {
    const bookingUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: BOOKING_ID }, error: null })
    const bookingUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: bookingUpdateMaybeSingle })
    const bookingUpdateEq = vi.fn().mockReturnValue({ select: bookingUpdateSelect })
    const bookingUpdate = vi.fn().mockReturnValue({ eq: bookingUpdateEq })

    const bookingLoadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: BOOKING_ID,
        status: 'confirmed',
        booking_date: '2026-07-20',
        booking_time: '18:00:00',
        duration_minutes: 90,
        customer_id: null,
        special_requirements: null,
        dietary_requirements: [],
        allergies: [],
        celebration_type: null,
        internal_notes: null,
      },
      error: null,
    })
    const bookingLoadEq = vi.fn().mockReturnValue({ maybeSingle: bookingLoadMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingLoadEq })

    const assignmentEq = vi.fn().mockResolvedValue({ error: null })
    const assignmentUpdate = vi.fn().mockReturnValue({ eq: assignmentEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: bookingSelect, update: bookingUpdate }
        }
        if (table === 'booking_table_assignments') {
          return { select: assignmentWindowRead(), update: assignmentUpdate }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(requireBohTableBookingPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase,
      userId: 'user-1',
    })

    const response = await patchBooking(jsonRequest({
      booking_date: '2026-07-25',
      booking_time: '19:30',
      duration_minutes: 120,
      customer_id: CUSTOMER_ID,
      special_requirements: 'Window table',
      dietary_requirements: ['vegetarian'],
      allergies: ['nuts'],
      celebration_type: 'birthday',
      internal_notes: 'VIP',
    }) as any, {
      params: Promise.resolve({ id: BOOKING_ID }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ success: true, data: { id: BOOKING_ID, high_chair_count: 0 } })
    expect(assignmentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      start_datetime: expect.any(String),
      end_datetime: expect.any(String),
    }))
    expect(bookingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      booking_date: '2026-07-25',
      booking_time: '19:30',
      duration_minutes: 120,
      customer_id: CUSTOMER_ID,
      dietary_requirements: ['vegetarian'],
      allergies: ['nuts'],
    }))
    // Date/time changed → the customer is notified of the amended booking.
    expect(sendTableBookingRescheduledNotificationIfAllowed).toHaveBeenCalledWith(
      supabase,
      { tableBookingId: BOOKING_ID, previous: { startDateTime: expect.any(String) } },
    )
  })

  it('does not notify the customer when only metadata changes (same window)', async () => {
    const bookingUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: BOOKING_ID }, error: null })
    const bookingUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: bookingUpdateMaybeSingle })
    const bookingUpdateEq = vi.fn().mockReturnValue({ select: bookingUpdateSelect })
    const bookingUpdate = vi.fn().mockReturnValue({ eq: bookingUpdateEq })

    const bookingLoadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: BOOKING_ID,
        status: 'confirmed',
        booking_date: '2026-07-20',
        booking_time: '18:00:00',
        duration_minutes: 90,
        customer_id: CUSTOMER_ID,
        special_requirements: null,
        dietary_requirements: [],
        allergies: [],
        celebration_type: null,
        internal_notes: null,
        high_chair_count: 0,
        is_outside_seating: false,
      },
      error: null,
    })
    const bookingLoadEq = vi.fn().mockReturnValue({ maybeSingle: bookingLoadMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingLoadEq })

    const assignmentEq = vi.fn().mockResolvedValue({ error: null })
    const assignmentUpdate = vi.fn().mockReturnValue({ eq: assignmentEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: bookingSelect, update: bookingUpdate }
        }
        if (table === 'booking_table_assignments') {
          return { select: assignmentWindowRead(), update: assignmentUpdate }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(requireBohTableBookingPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase,
      userId: 'user-1',
    })

    // Same date/time/duration as stored (time submitted without seconds); only notes change.
    const response = await patchBooking(jsonRequest({
      booking_date: '2026-07-20',
      booking_time: '18:00',
      duration_minutes: 90,
      customer_id: CUSTOMER_ID,
      internal_notes: 'Updated a note only',
    }) as any, {
      params: Promise.resolve({ id: BOOKING_ID }),
    })

    expect(response.status).toBe(200)
    expect(bookingUpdate).toHaveBeenCalled()
    expect(sendTableBookingRescheduledNotificationIfAllowed).not.toHaveBeenCalled()
  })

  it('blocks preorder edits after cutoff', async () => {
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: BOOKING_ID,
        sunday_preorder_cutoff_at: '2020-01-01T12:00:00.000Z',
      },
      error: null,
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })
    const itemUpdate = vi.fn()

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: bookingSelect }
        }
        if (table === 'table_booking_items') {
          return { update: itemUpdate }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(requireBohTableBookingPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase,
      userId: 'user-1',
    })

    const response = await patchPreorder(jsonRequest({
      items: [{ id: ITEM_ID, quantity: 2, special_requests: 'No gravy' }],
    }) as any, {
      params: Promise.resolve({ id: BOOKING_ID }),
    })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload).toEqual({ error: 'Pre-order cutoff has passed' })
    expect(itemUpdate).not.toHaveBeenCalled()
  })
})

describe('BOH table booking edit: a refused booking update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const KITCHEN_NOT_SERVING = {
    code: '22023',
    message: 'The kitchen is not serving at 20:45 on 25 Jul 2026. Please choose a time inside a food service.',
    details: null,
    hint: null,
  }

  // An 18:00 food booking whose table assignment moves first and whose booking update is then
  // refused with `bookingUpdateError`.
  function buildSupabase(bookingUpdateError: Record<string, unknown>) {
    const bookingLoadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: BOOKING_ID,
        status: 'confirmed',
        booking_date: '2026-07-20',
        booking_time: '18:00:00',
        duration_minutes: 105,
        customer_id: CUSTOMER_ID,
        special_requirements: null,
        dietary_requirements: [],
        allergies: [],
        celebration_type: null,
        internal_notes: null,
        high_chair_count: 0,
        is_outside_seating: false,
      },
      error: null,
    })
    const bookingSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ maybeSingle: bookingLoadMaybeSingle }),
    })
    const bookingUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: bookingUpdateError }),
        }),
      }),
    })

    const assignmentEq = vi.fn().mockResolvedValue({ error: null })
    const assignmentUpdate = vi.fn().mockReturnValue({ eq: assignmentEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: bookingSelect, update: bookingUpdate }
        }
        if (table === 'booking_table_assignments') {
          return { select: assignmentWindowRead(), update: assignmentUpdate }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(requireBohTableBookingPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase,
      userId: 'user-1',
    })

    return { assignmentUpdate, assignmentEq }
  }

  const moveToLateEvening = () =>
    patchBooking(jsonRequest({
      booking_date: '2026-07-25',
      booking_time: '20:45',
      duration_minutes: 105,
      customer_id: CUSTOMER_ID,
    }) as any, {
      params: Promise.resolve({ id: BOOKING_ID }),
    })

  it('puts the table back and tells staff the kitchen is not serving', async () => {
    const { assignmentUpdate, assignmentEq } = buildSupabase(KITCHEN_NOT_SERVING)

    const response = await moveToLateEvening()

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: KITCHEN_NOT_SERVING.message })
    // Moved to the new window first, then restored to exactly what it held before.
    expect(assignmentUpdate).toHaveBeenCalledTimes(2)
    expect(assignmentUpdate).toHaveBeenNthCalledWith(2, {
      start_datetime: ORIGINAL_ASSIGNMENT.start_datetime,
      end_datetime: ORIGINAL_ASSIGNMENT.end_datetime,
    })
    expect(assignmentEq).toHaveBeenNthCalledWith(2, 'id', ORIGINAL_ASSIGNMENT.id)
    expect(sendTableBookingRescheduledNotificationIfAllowed).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('puts the table back and logs when the update fails for any other reason', async () => {
    const { assignmentUpdate } = buildSupabase({
      code: 'XX000',
      message: 'connection reset',
      details: null,
      hint: null,
    })

    const response = await moveToLateEvening()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to update booking' })
    expect(assignmentUpdate).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/failed to update booking/i),
      expect.objectContaining({
        metadata: expect.objectContaining({ bookingId: BOOKING_ID, code: 'XX000', message: 'connection reset' }),
      }),
    )
  })
})
