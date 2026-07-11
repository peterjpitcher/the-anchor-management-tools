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

// Preserve every real export from the bookings module, but stub the two customer
// notification helpers so the edit route's wiring can be asserted without sending.
vi.mock('@/lib/table-bookings/bookings', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/table-bookings/bookings')>()),
  sendTableBookingRescheduledNotificationIfAllowed: vi.fn().mockResolvedValue(undefined),
  sendTableBookingCancelledSmsIfAllowed: vi.fn().mockResolvedValue(undefined),
}))

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { sendTableBookingRescheduledNotificationIfAllowed } from '@/lib/table-bookings/bookings'
import { PATCH as patchBooking } from '@/app/api/boh/table-bookings/[id]/route'
import { PATCH as patchPreorder } from '@/app/api/boh/table-bookings/[id]/preorder/route'

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000011'
const ITEM_ID = '00000000-0000-4000-8000-000000000021'

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
          return { update: assignmentUpdate }
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
      { tableBookingId: BOOKING_ID },
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
          return { update: assignmentUpdate }
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
