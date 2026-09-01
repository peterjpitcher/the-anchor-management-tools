import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
  getLondonDateIso: vi.fn(() => '2026-07-20'),
}))

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
import { sendTableBookingRescheduledNotificationIfAllowed } from '@/lib/table-bookings/bookings'
import { PATCH as patchTime } from '@/app/api/foh/bookings/[id]/time/route'

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

function buildSupabase() {
  // Guest window 17:00-18:30 UTC, which is 18:00-19:30 London in July (BST). The assignment
  // runs 15 minutes longer because a turnaround gap is configured; the route must keep those
  // two windows apart rather than writing the longer one back to the booking.
  const booking = {
    id: BOOKING_ID,
    status: 'confirmed',
    booking_time: '18:00:00',
    booking_date: '2026-07-20',
    start_datetime: '2026-07-20T17:00:00.000Z',
    end_datetime: '2026-07-20T18:30:00.000Z',
    duration_minutes: 90,
    seated_at: null,
    left_at: null,
    event_id: null,
    high_chair_count: 0,
  }

  const rpc = vi.fn().mockResolvedValue({
    data: { state: 'updated', assignment_count: 1, high_chairs_requested: 0, high_chairs_granted: 0 },
    error: null,
  })

  return {
    from: vi.fn((table: string) => {
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
            eq: () => Promise.resolve({
              data: [{ start_datetime: '2026-07-20T17:00:00.000Z', end_datetime: '2026-07-20T18:45:00.000Z' }],
              error: null,
            }),
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc,
  }
}

function jsonRequest(body: unknown) {
  return new Request(`http://localhost/api/foh/bookings/${BOOKING_ID}/time`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('FOH table-booking time move — customer notification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('notifies the customer when the time actually changes', async () => {
    const supabase = buildSupabase()
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({ ok: true, userId: 'user-1', supabase })

    // Stored time is 18:00 London; move to 19:30.
    const response = await patchTime(jsonRequest({ time: '19:30' }) as any, {
      params: Promise.resolve({ id: BOOKING_ID }),
    })

    expect(response.status).toBe(200)
    expect(sendTableBookingRescheduledNotificationIfAllowed).toHaveBeenCalledWith(
      supabase,
      { tableBookingId: BOOKING_ID },
    )
  })

  it('does not notify when the booking is dropped back on the same time', async () => {
    const supabase = buildSupabase()
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({ ok: true, userId: 'user-1', supabase })

    // Stored time is 18:00 London; "move" to the same 18:00.
    const response = await patchTime(jsonRequest({ time: '18:00' }) as any, {
      params: Promise.resolve({ id: BOOKING_ID }),
    })

    expect(response.status).toBe(200)
    expect(sendTableBookingRescheduledNotificationIfAllowed).not.toHaveBeenCalled()
  })
})
