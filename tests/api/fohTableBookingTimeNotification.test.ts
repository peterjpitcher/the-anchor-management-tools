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

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingRescheduledNotificationIfAllowed: vi.fn().mockResolvedValue(undefined),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { sendTableBookingRescheduledNotificationIfAllowed } from '@/lib/table-bookings/bookings'
import { PATCH as patchTime } from '@/app/api/foh/bookings/[id]/time/route'

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

function buildSupabase() {
  // One assignment window: 17:00–18:30 UTC → 18:00–19:30 London (BST) in July.
  const assignmentEq = vi.fn().mockResolvedValue({
    data: [{ start_datetime: '2026-07-20T17:00:00.000Z', end_datetime: '2026-07-20T18:30:00.000Z' }],
    error: null,
  })
  const assignmentSelect = vi.fn().mockReturnValue({ eq: assignmentEq })
  const rpc = vi.fn().mockResolvedValue({ data: { state: 'confirmed', assignment_count: 1 }, error: null })

  return {
    from: vi.fn((table: string) => {
      if (table === 'booking_table_assignments') {
        return { select: assignmentSelect }
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
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({ ok: true, supabase })

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
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({ ok: true, supabase })

    // Stored time is 18:00 London; "move" to the same 18:00.
    const response = await patchTime(jsonRequest({ time: '18:00' }) as any, {
      params: Promise.resolve({ id: BOOKING_ID }),
    })

    expect(response.status).toBe(200)
    expect(sendTableBookingRescheduledNotificationIfAllowed).not.toHaveBeenCalled()
  })
})
