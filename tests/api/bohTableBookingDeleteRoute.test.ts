import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/foh/api-auth', () => ({
  requireBohTableBookingPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/table-bookings/refunds', () => ({
  refundTableBookingDeposit: vi.fn().mockResolvedValue({ action: 'none' }),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingCancelledSmsIfAllowed: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/payments/stripe', () => ({
  expireStripeCheckoutSession: vi.fn(),
  isStripeConfigured: vi.fn(() => false),
}))

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { logAuditEvent } from '@/app/actions/audit'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { refundTableBookingDeposit } from '@/lib/table-bookings/refunds'
import { checkUserPermission } from '@/app/actions/rbac'
import { DELETE as deleteBohTableBooking } from '@/app/api/boh/table-bookings/[id]/route'
import { NextRequest } from 'next/server'

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

function deleteRequest(body?: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/boh/table-bookings/${BOOKING_ID}`, {
    method: 'DELETE',
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
}

/** A live booking the soft delete cancels; returns the update spy. */
function mockLiveBooking() {
  const loadMaybeSingle = vi.fn().mockResolvedValue({
    data: { id: BOOKING_ID, booking_reference: 'TB-1', booking_date: '2026-02-23', customer_id: 'customer-1', status: 'confirmed' },
    error: null,
  })
  const updateMaybeSingle = vi.fn().mockResolvedValue({
    data: { id: BOOKING_ID, booking_reference: 'TB-1', status: 'cancelled', cancelled_at: '2026-02-23T11:00:00.000Z', cancellation_reason: 'x' },
    error: null,
  })
  const updateChain = { eq: vi.fn(() => updateChain), select: vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle }) }
  const update = vi.fn().mockReturnValue(updateChain)
  ;(requireBohTableBookingPermission as unknown as Mock).mockResolvedValue({
    ok: true,
    supabase: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle }) }),
        update,
        delete: vi.fn(),
      }),
    },
    userId: 'user-1',
  })
  return { update }
}

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
    const updateChain = {
      eq: vi.fn(() => updateChain),
      select: updateSelect,
    }
    const update = vi.fn().mockReturnValue(updateChain)

    const hardDeleteEq = vi.fn()
    const hardDelete = vi.fn().mockReturnValue({ eq: hardDeleteEq })

    const tableBookings = {
      select: loadSelect,
      update,
      delete: hardDelete,
    }

    ;(requireBohTableBookingPermission as unknown as Mock).mockResolvedValue({
      ok: true,
      supabase: {
        from: vi.fn().mockReturnValue(tableBookings),
      },
      userId: 'user-1',
    })

    const response = await deleteBohTableBooking(deleteRequest(), {
      params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cancelled',
        cancelled_by: 'staff',
        // A screen that sends no choice keeps the guest's terms (BK-046).
        cancellation_reason: 'Guest asked staff to cancel',
      })
    )
    expect(hardDelete).not.toHaveBeenCalled()
    expect(hardDeleteEq).not.toHaveBeenCalled()
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      operation_type: 'update',
      resource_type: 'table_booking',
      resource_id: '00000000-0000-4000-8000-000000000001',
      operation_status: 'success',
      additional_info: {
        action: 'boh_table_booking_soft_cancel',
        cancelled_by: 'guest',
        cancelled_by_given: false,
        manager_refund_gbp: null,
      },
    }))
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

    ;(requireBohTableBookingPermission as unknown as Mock).mockResolvedValue({
      ok: true,
      supabase: {
        from: vi.fn().mockReturnValue(tableBookings),
      },
      userId: 'user-1',
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
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      operation_type: 'delete',
      resource_type: 'table_booking',
      resource_id: '00000000-0000-4000-8000-000000000001',
      operation_status: 'success',
      additional_info: { action: 'boh_table_booking_hard_delete' },
    }))
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

  it('explains the refusal when the database guard finds money the route check cannot see', async () => {
    // An older booking paid through a legacy ledger: nothing on the booking row says so.
    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: '00000000-0000-4000-8000-000000000001',
        booking_reference: 'TB-1',
        booking_date: '2026-02-23',
        customer_id: 'customer-1',
        status: 'cancelled',
        payment_status: null,
        paypal_deposit_capture_id: null,
      },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const hardDeleteMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23503', message: 'Table booking TB-1 holds a payment, so it cannot be deleted' },
    })
    const hardDeleteSelect = vi.fn().mockReturnValue({ maybeSingle: hardDeleteMaybeSingle })
    const hardDeleteEq = vi.fn().mockReturnValue({ select: hardDeleteSelect })
    const hardDelete = vi.fn().mockReturnValue({ eq: hardDeleteEq })

    ;(requireBohTableBookingPermission as unknown as Mock).mockResolvedValue({
      ok: true,
      supabase: {
        from: vi.fn().mockReturnValue({ select: loadSelect, update: vi.fn(), delete: hardDelete }),
      },
      userId: 'user-1',
    })

    const response = await deleteBohTableBooking({} as any, {
      params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }),
    })
    const payload = await response.json()

    expect(hardDelete).toHaveBeenCalled()
    expect(response.status).toBe(409)
    expect(payload.error).toContain('still holds a paid deposit')
  })

  describe('who is cancelling (BK-046)', () => {
    it('refunds a pub cancellation in full and records it on the booking', async () => {
      const { update } = mockLiveBooking()

      const response = await deleteBohTableBooking(deleteRequest({ cancelled_by: 'venue' }), {
        params: Promise.resolve({ id: BOOKING_ID }),
      })

      expect(response.status).toBe(200)
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ cancellation_reason: 'The pub cancelled' }))
      expect(refundTableBookingDeposit).toHaveBeenCalledWith(BOOKING_ID, expect.any(Date), {
        cancelledBy: 'venue',
        managerAmountGbp: null,
      })
    })

    it('applies the guest terms when the guest asked', async () => {
      mockLiveBooking()

      await deleteBohTableBooking(deleteRequest({ cancelled_by: 'guest' }), { params: Promise.resolve({ id: BOOKING_ID }) })

      expect(refundTableBookingDeposit).toHaveBeenCalledWith(BOOKING_ID, expect.any(Date), {
        cancelledBy: 'guest',
        managerAmountGbp: null,
      })
    })

    it('refuses a chosen refund amount from someone without table_bookings manage, before anything changes', async () => {
      const { update } = mockLiveBooking()
      vi.mocked(checkUserPermission).mockResolvedValue(false)

      const response = await deleteBohTableBooking(
        deleteRequest({ cancelled_by: 'venue', refund_amount_gbp: 40 }),
        { params: Promise.resolve({ id: BOOKING_ID }) },
      )

      expect(response.status).toBe(403)
      expect(checkUserPermission).toHaveBeenCalledWith('table_bookings', 'manage', 'user-1')
      expect(update).not.toHaveBeenCalled()
      expect(refundTableBookingDeposit).not.toHaveBeenCalled()
    })

    it("passes a manager's chosen amount to the refund", async () => {
      mockLiveBooking()
      vi.mocked(checkUserPermission).mockResolvedValue(true)

      const response = await deleteBohTableBooking(
        deleteRequest({ cancelled_by: 'guest', refund_amount_gbp: '40.00' }),
        { params: Promise.resolve({ id: BOOKING_ID }) },
      )

      expect(response.status).toBe(200)
      expect(refundTableBookingDeposit).toHaveBeenCalledWith(BOOKING_ID, expect.any(Date), {
        cancelledBy: 'guest',
        managerAmountGbp: 40,
      })
    })

    it('refuses an unknown choice', async () => {
      const { update } = mockLiveBooking()

      const response = await deleteBohTableBooking(deleteRequest({ cancelled_by: 'kitchen' }), {
        params: Promise.resolve({ id: BOOKING_ID }),
      })

      expect(response.status).toBe(400)
      expect(update).not.toHaveBeenCalled()
    })
  })
})
