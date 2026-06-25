import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before imports
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  refundPayPalPayment: vi.fn(),
}))
vi.mock('@/lib/refund-notifications', () => ({
  sendRefundNotification: vi.fn(),
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { refundPayPalPayment } from '@/lib/paypal'
import { sendRefundNotification } from '@/lib/refund-notifications'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'

function mockSupabaseChain(returnData: any = null, returnError: any = null) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
    single: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
    order: vi.fn().mockResolvedValue({ data: returnData ? [returnData] : [], error: returnError }),
    rpc: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
  }
  return chain
}

describe('refundActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(checkUserPermission).mockResolvedValue(true)
  })

  describe('processPayPalRefund', () => {
    it('should reject if user lacks refund permission', async () => {
      vi.mocked(checkUserPermission).mockResolvedValue(false)

      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const { processPayPalRefund } = await import('../refundActions')
      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test reason')

      expect(result).toEqual({ error: expect.stringContaining('permission') })
    })

    it('should reject if no PayPal capture ID on booking', async () => {
      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const db = mockSupabaseChain({
        id: 'booking-1',
        deposit_amount: 100,
        paypal_deposit_capture_id: null,
        deposit_paid_date: '2026-04-01',
        customer_name: 'Test',
        contact_email: null,
        contact_phone: null,
      })
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const { processPayPalRefund } = await import('../refundActions')
      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test')

      expect(result).toEqual({ error: expect.stringContaining('No PayPal payment') })
    })

    it('should reject if capture is older than 180 days', async () => {
      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 181)

      const db = mockSupabaseChain({
        id: 'booking-1',
        deposit_amount: 100,
        paypal_deposit_capture_id: 'CAPTURE-1',
        deposit_paid_date: oldDate.toISOString(),
        customer_name: 'Test',
        contact_email: null,
        contact_phone: null,
      })
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const { processPayPalRefund } = await import('../refundActions')
      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test')

      expect(result).toEqual({ error: expect.stringContaining('180') })
    })

    it('loads parking refund customer details using real parking booking columns', async () => {
      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)
      vi.mocked(refundPayPalPayment).mockResolvedValue({
        refundId: 'PAYPAL-REFUND-1',
        status: 'PENDING',
        statusDetails: 'ECHECK',
      } as any)

      const parkingSelect = vi.fn()
      const parkingPaymentLookup: any = {
        select: vi.fn((columns: string) => {
          parkingSelect(columns)
          return parkingPaymentLookup
        }),
        eq: vi.fn(() => parkingPaymentLookup),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'parking-payment-1',
            transaction_id: 'CAPTURE-1',
            paid_at: new Date().toISOString(),
            amount: 20,
            currency: 'GBP',
            booking_id: 'parking-booking-1',
            parking_bookings: {
              customer_id: 'customer-1',
              customer_first_name: 'Sam',
              customer_last_name: 'Jones',
              customer_email: 'sam@example.com',
              customer_mobile: '+447700900000',
            },
          },
          error: null,
        }),
      }
      const existingRefundLookup: any = {
        select: vi.fn(() => existingRefundLookup),
        eq: vi.fn(() => existingRefundLookup),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
      const refundUpdate: any = {
        update: vi.fn(() => refundUpdate),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
      let refundTableCalls = 0
      const db = {
        from: vi.fn((table: string) => {
          if (table === 'parking_booking_payments') return parkingPaymentLookup
          if (table === 'payment_refunds') {
            refundTableCalls += 1
            return refundTableCalls === 1 ? existingRefundLookup : refundUpdate
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
        rpc: vi.fn().mockResolvedValue({ data: { refund_id: 'refund-1' }, error: null }),
      }
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const { processPayPalRefund } = await import('../refundActions')
      const result = await processPayPalRefund('parking', 'parking-payment-1', 10, 'test')

      expect(result).toMatchObject({ success: true, pending: true, refundId: 'refund-1' })
      expect(parkingSelect).toHaveBeenCalledWith(
        'id, transaction_id, paid_at, amount, currency, booking_id, parking_bookings(customer_id, customer_first_name, customer_last_name, customer_email, customer_mobile)'
      )
      expect(refundPayPalPayment).toHaveBeenCalledWith('CAPTURE-1', 10, expect.any(String), 'GBP')
    })

    it('does not mark a pending PayPal refund completed when post-processing fails', async () => {
      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)
      vi.mocked(refundPayPalPayment).mockResolvedValue({
        refundId: 'PAYPAL-REFUND-PENDING',
        status: 'PENDING',
        statusDetails: 'ECHECK',
        amount: '10.00',
        currency: 'GBP',
      } as any)
      vi.mocked(logAuditEvent).mockRejectedValueOnce(new Error('audit unavailable'))

      const privateBookingLookup: any = {
        select: vi.fn(() => privateBookingLookup),
        eq: vi.fn(() => privateBookingLookup),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'booking-1',
            paypal_deposit_capture_id: 'CAPTURE-1',
            deposit_paid_date: new Date().toISOString(),
            deposit_amount: 20,
            customer_id: null,
            customer_name: 'Test Customer',
            contact_email: null,
            contact_phone: null,
          },
          error: null,
        }),
      }
      const existingRefundLookup: any = {
        select: vi.fn(() => existingRefundLookup),
        eq: vi.fn(() => existingRefundLookup),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
      const pendingUpdatePayloads: any[] = []
      const pendingUpdate: any = {
        update: vi.fn((payload: any) => {
          pendingUpdatePayloads.push(payload)
          return pendingUpdate
        }),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
      const fallbackUpdatePayloads: any[] = []
      const fallbackUpdate: any = {
        update: vi.fn((payload: any) => {
          fallbackUpdatePayloads.push(payload)
          return fallbackUpdate
        }),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
      let paymentRefundCalls = 0
      const db = {
        from: vi.fn((table: string) => {
          if (table === 'private_bookings') return privateBookingLookup
          if (table === 'payment_refunds') {
            paymentRefundCalls += 1
            if (paymentRefundCalls === 1) return existingRefundLookup
            if (paymentRefundCalls === 2) return pendingUpdate
            return fallbackUpdate
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
        rpc: vi.fn().mockResolvedValue({ data: { refund_id: 'refund-1' }, error: null }),
      }
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const { processPayPalRefund } = await import('../refundActions')
      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test')

      expect(result).toMatchObject({ success: true, pending: true, refundId: 'refund-1' })
      expect(pendingUpdatePayloads[0]).toMatchObject({
        paypal_refund_id: 'PAYPAL-REFUND-PENDING',
        paypal_status: 'PENDING',
      })
      expect(fallbackUpdatePayloads[0]).toMatchObject({
        status: 'pending',
        paypal_status: 'PENDING',
      })
      expect(fallbackUpdatePayloads[0]).not.toMatchObject({ status: 'completed' })
    })
  })

  describe('processManualRefund', () => {
    it('should succeed without calling PayPal API', async () => {
      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const db = mockSupabaseChain({ id: 'booking-1', deposit_amount: 100, deposit_paid_date: '2026-04-01', customer_name: 'Test', contact_email: null, contact_phone: null })
      db.rpc.mockResolvedValue({ data: 100, error: null })
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const { processManualRefund } = await import('../refundActions')
      const result = await processManualRefund('private_booking', 'booking-1', 50, 'cash return', 'cash')

      expect(refundPayPalPayment).not.toHaveBeenCalled()
      expect(sendRefundNotification).not.toHaveBeenCalled()
    })
  })
})
