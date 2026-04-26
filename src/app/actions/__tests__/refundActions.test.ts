import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before imports
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/paypal', () => ({
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
