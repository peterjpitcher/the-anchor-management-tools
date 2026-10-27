import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Review finding on release 13 (BK-065): a cancelled hire's refund cap counted only payments taken
 * on the booking. A balance the guest paid against the hire's invoice was left out, although the
 * cancellation promised it back, so the refund we promised was refused as too large. The cap now
 * comes from the same de-duplicated payment ledger the cancellation outcome reads.
 */

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/paypal', () => ({ PAYPAL_DEFAULT_CURRENCY: 'GBP', refundPayPalPayment: vi.fn() }))
vi.mock('@/lib/refund-notifications', () => ({ sendRefundNotification: vi.fn().mockResolvedValue('sent') }))
vi.mock('@/lib/email/private-booking-emails', () => ({
  sendDepositRefundEmail: vi.fn().mockResolvedValue(undefined),
  sendDepositPartRefundEmail: vi.fn().mockResolvedValue(undefined),
  sendPrivateBookingRefundSentEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/table-bookings/deposit-refund', () => ({ resolveSeasonalDepositRefund: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/private-bookings/payment-ledger', () => ({ readBookingPaymentLedger: vi.fn() }))

import { processManualRefund } from '@/app/actions/refundActions'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readBookingPaymentLedger } from '@/lib/private-bookings/payment-ledger'

function chain(result: unknown) {
  const p: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'update', 'insert', 'delete', 'contains']) p[m] = vi.fn(() => p)
  p.maybeSingle = vi.fn(() => Promise.resolve(result))
  p.single = vi.fn(() => Promise.resolve(result))
  p.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return p
}

const CANCELLED_HIRE = {
  id: 'pb-1',
  status: 'cancelled',
  paypal_deposit_capture_id: null,
  deposit_paid_date: '2026-09-01T10:00:00.000Z',
  deposit_amount: 250,
  refund_due_amount: 650,
  customer_id: 'cust-1',
  customer_name: 'Alex Doe',
  contact_email: 'alex@example.com',
  contact_phone: '+447700900000',
  invoice_id: 'inv-1',
  invoice_deposit_treatment: 'held_separately',
  event_date: '2026-12-05',
}

function makeDb() {
  const rpc = vi.fn().mockResolvedValue({ data: [{ refund_id: 'refund-1' }], error: null })
  const from = vi.fn((table: string) => {
    if (table === 'private_bookings') return chain({ data: CANCELLED_HIRE, error: null })
    // Nothing was paid on the booking itself: the balance went against the invoice.
    if (table === 'private_booking_payments') return chain({ data: [], error: null })
    return chain({ data: null, error: null })
  })
  return { from, rpc }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(createClient as unknown as Mock).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  })
})

describe('refunding a cancelled private hire', () => {
  it('caps the refund at the deposit plus every payment in the ledger, invoice receipts included', async () => {
    const db = makeDb()
    ;(createAdminClient as unknown as Mock).mockReturnValue(db)
    ;(readBookingPaymentLedger as unknown as Mock).mockResolvedValue({ balancePaymentsTotal: 400, appliedDepositAmount: 0 })

    const result = await processManualRefund('private_booking', 'pb-1', 650, 'Cancelled', 'bank_transfer')

    expect(result.success).toBe(true)
    expect(db.rpc).toHaveBeenCalledWith('reserve_refund_balance', expect.objectContaining({ p_original_amount: 650, p_amount: 650 }))
  })

  it('refuses, and moves nothing, when the payment ledger cannot be read', async () => {
    const db = makeDb()
    ;(createAdminClient as unknown as Mock).mockReturnValue(db)
    ;(readBookingPaymentLedger as unknown as Mock).mockRejectedValue(new Error('The booking invoice is missing or withdrawn. Review its payment link before continuing.'))

    const result = await processManualRefund('private_booking', 'pb-1', 650, 'Cancelled', 'bank_transfer')

    expect(result.error).toMatch(/missing or withdrawn/)
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
