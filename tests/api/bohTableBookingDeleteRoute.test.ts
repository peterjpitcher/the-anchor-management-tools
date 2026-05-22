import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
}))

vi.mock('@/lib/table-bookings/refunds', () => ({
  refundTableBookingDeposit: vi.fn().mockResolvedValue({ action: 'none' }),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingCancelledSmsIfAllowed: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/payments/stripe', () => ({
  expireStripeCheckoutSession: vi.fn(),
  isStripeConfigured: vi.fn(() => false),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { refundTableBookingDeposit } from '@/lib/table-bookings/refunds'
import { DELETE as deleteBohTableBooking } from '@/app/api/boh/table-bookings/[id]/route'

describe('BOH table-booking DELETE behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('soft-cancels booking and does not run hard delete', async () => {
    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: '00000000-0000-4000-8000-000000000001',
        booking_reference: 'TB-1',
        booking_date: '2026-02-23',
        customer_id: 'customer-1',
        status: 'confirmed',
      },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: '00000000-0000-4000-8000-000000000001',
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
      params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }),
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
        id: '00000000-0000-4000-8000-000000000001',
        booking_reference: 'TB-1',
        status: 'cancelled',
        soft_deleted: true,
      },
    })
  })

  it('hard-deletes already-cancelled bookings without re-cancelling or notifying again', async () => {
    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: '00000000-0000-4000-8000-000000000001',
        booking_reference: 'TB-1',
        booking_date: '2026-02-23',
        customer_id: 'customer-1',
        status: 'cancelled',
        cancelled_at: '2026-02-22T11:00:00.000Z',
        cancellation_reason: 'Customer requested',
      },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const update = vi.fn()
    const hardDeleteMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: '00000000-0000-4000-8000-000000000001',
        booking_reference: 'TB-1',
        status: 'cancelled',
        cancelled_at: '2026-02-22T11:00:00.000Z',
        cancellation_reason: 'Customer requested',
      },
      error: null,
    })
    const hardDeleteSelect = vi.fn().mockReturnValue({ maybeSingle: hardDeleteMaybeSingle })
    const hardDeleteEq = vi.fn().mockReturnValue({ select: hardDeleteSelect })
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
      params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(update).not.toHaveBeenCalled()
    expect(hardDelete).toHaveBeenCalled()
    expect(hardDeleteEq).toHaveBeenCalledWith('id', '00000000-0000-4000-8000-000000000001')
    expect(refundTableBookingDeposit).not.toHaveBeenCalled()
    expect(sendTableBookingCancelledSmsIfAllowed).not.toHaveBeenCalled()
    expect(payload).toMatchObject({
      success: true,
      data: {
        id: '00000000-0000-4000-8000-000000000001',
        booking_reference: 'TB-1',
        status: 'cancelled',
        cancelled_at: '2026-02-22T11:00:00.000Z',
        cancellation_reason: 'Customer requested',
        hard_deleted: true,
        soft_deleted: false,
      },
    })
  })
})
