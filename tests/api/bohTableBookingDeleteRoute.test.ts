import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { DELETE as deleteBohTableBooking } from '@/app/api/boh/table-bookings/[id]/route'

describe('BOH table-booking DELETE soft-cancel behavior', () => {
  it('soft-cancels booking and does not run hard delete', async () => {
    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'booking-1', booking_reference: 'TB-1', status: 'confirmed' },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        booking_reference: 'TB-1',
        status: 'cancelled',
        cancelled_at: '2026-02-23T11:00:00.000Z',
        cancelled_by: 'staff',
        cancellation_reason: 'boh_soft_delete',
      },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const hardDeleteEq = vi.fn()
    const hardDelete = vi.fn().mockReturnValue({ eq: hardDeleteEq })

    const tableBookings = {
      select: loadSelect,
      update,
      delete: hardDelete,
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase: {
        from: vi.fn().mockReturnValue(tableBookings),
      },
    })

    const response = await deleteBohTableBooking({} as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cancelled',
        cancelled_by: 'staff',
        cancellation_reason: 'boh_soft_delete',
      })
    )
    expect(hardDelete).not.toHaveBeenCalled()
    expect(hardDeleteEq).not.toHaveBeenCalled()
    expect(payload).toMatchObject({
      success: true,
      data: {
        id: 'booking-1',
        booking_reference: 'TB-1',
        status: 'cancelled',
        soft_deleted: true,
      },
    })
  })
})
