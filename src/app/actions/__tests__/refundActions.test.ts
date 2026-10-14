import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
// Imported once, like the mocked modules above. The actions' imports reach the private-booking
// email code (some 60 modules, plus the Twilio, Resend and Microsoft Graph clients): about half a
// second to load, and far longer in a busy full run. Loading it inside each test after
// vi.resetModules() charged that to the first test's 5 second budget. These tests never run that
// code and nothing they do run keeps state between tests, so one load is enough.
import { processManualRefund, processPayPalRefund } from '../refundActions'

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
    vi.mocked(checkUserPermission).mockResolvedValue(true)
  })

  describe('processPayPalRefund', () => {
    it.each(['paypal', 'manual'] as const)('does not refund an applied invoice deposit through the %s bond flow', async (method) => {
      vi.mocked(createClient).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      } as never)
      const db = mockSupabaseChain({
        id: 'booking-1',
        deposit_amount: 250,
        deposit_paid_date: new Date().toISOString(),
        paypal_deposit_capture_id: 'CAPTURE-1',
        invoice_id: 'invoice-1',
        invoice_deposit_treatment: 'deducted',
      })
      vi.mocked(createAdminClient).mockReturnValue(db as never)

      const result = method === 'paypal'
        ? await processPayPalRefund('private_booking', 'booking-1', 250, 'Return deposit')
        : await processManualRefund('private_booking', 'booking-1', 250, 'Return deposit', 'cash')

      expect(result).toEqual({ error: expect.stringContaining('applied to the invoice') })
      expect(db.rpc).not.toHaveBeenCalled()
      expect(refundPayPalPayment).not.toHaveBeenCalled()
    })

    it('should reject if user lacks refund permission', async () => {
      vi.mocked(checkUserPermission).mockResolvedValue(false)

      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

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

      const result = await processPayPalRefund('parking', 'parking-payment-1', 10, 'test')

      expect(result).toMatchObject({ success: true, pending: true, refundId: 'refund-1' })
      // start_at and reference joined in so the refund email can name which parking booking
      // the money came off, and on what date.
      expect(parkingSelect).toHaveBeenCalledWith(
        'id, transaction_id, paid_at, amount, currency, booking_id, parking_bookings(customer_id, customer_first_name, customer_last_name, customer_email, customer_mobile, start_at, reference)'
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

      const result = await processManualRefund('private_booking', 'booking-1', 50, 'cash return', 'cash')

      expect(refundPayPalPayment).not.toHaveBeenCalled()
      expect(sendRefundNotification).not.toHaveBeenCalled()
    })
  })

  // The owner's rule for money paths: once PayPal (or a member of staff) has moved the money, a
  // failed bookkeeping write is a warning on a successful result, never an error, because an error
  // reads as "the refund failed" and the next thing staff do is refund again.
  describe('bookkeeping writes that fail after the money has moved', () => {
    type Op = { table: string; kind: 'select' | 'update' | 'insert'; payload?: any }
    type Reply = { data: any; error: any }

    const WRITE_ERROR = { message: 'permission denied for table', code: '42501' }
    const BOOKING_NOT_UPDATED =
      'The refund went through, but the booking was not updated to show it. Do not refund again: ' +
      'tell the developer so the booking record can be corrected.'
    const STUCK_PENDING =
      'The refund record could not be marked as failed and still shows as pending: check it before trying again.'

    /**
     * A database whose every query is answered by `reply`, keyed on the table, the kind of query
     * and (for writes) the payload. Every operation is recorded so a test can assert what was
     * and was not written.
     */
    function makeDb(reply: (op: Op) => Reply) {
      const ops: Op[] = []
      const from = vi.fn((table: string) => {
        const op: Op = { table, kind: 'select' }
        const builder: any = {
          select: vi.fn(() => builder),
          update: vi.fn((payload: any) => {
            op.kind = 'update'
            op.payload = payload
            return builder
          }),
          insert: vi.fn((payload: any) => {
            op.kind = 'insert'
            op.payload = payload
            return builder
          }),
          eq: vi.fn(() => builder),
          in: vi.fn(() => builder),
          order: vi.fn(() => builder),
          limit: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => {
            ops.push({ ...op })
            return reply(op)
          }),
          then: (resolve: (value: Reply) => unknown, reject: (reason: unknown) => unknown) => {
            ops.push({ ...op })
            return Promise.resolve(reply(op)).then(resolve, reject)
          },
        }
        return builder
      })
      const rpc = vi.fn().mockResolvedValue({ data: { refund_id: 'refund-1' }, error: null })
      return { db: { from, rpc }, ops }
    }

    const BOOKING_TABLE: Record<'private_booking' | 'table_booking' | 'parking', string> = {
      private_booking: 'private_bookings',
      table_booking: 'table_bookings',
      parking: 'parking_booking_payments',
    }

    /** The booking row every source type's lookup reads, with no seasonal terms and no email. */
    const bookingRow = {
      id: 'booking-1',
      paypal_deposit_capture_id: 'CAPTURE-1',
      deposit_paid_date: new Date().toISOString(),
      card_capture_completed_at: new Date().toISOString(),
      deposit_amount: 20,
      deposit_refund_cutoff_days: null,
      transaction_id: 'CAPTURE-1',
      paid_at: new Date().toISOString(),
      amount: 20,
      currency: 'GBP',
      booking_id: 'parking-booking-1',
      customer_id: null,
      customer_name: 'Test Customer',
      contact_email: null,
      contact_phone: null,
      status: 'confirmed',
    }

    /** Answers the happy path; `overrides` returns a reply for the ops a test wants to change. */
    function happyReply(overrides: (op: Op) => Reply | undefined = () => undefined) {
      return (op: Op): Reply => {
        const override = overrides(op)
        if (override) return override
        if (op.kind !== 'select') return { data: null, error: null }
        if (op.table === 'payment_refunds') {
          // The existing-pending lookup is a maybeSingle; the completed-refunds sum is a list.
          return { data: [{ amount: 20 }], error: null }
        }
        return { data: bookingRow, error: null }
      }
    }

    function signIn() {
      vi.mocked(createClient).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      } as any)
    }

    let consoleError: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      signIn()
      vi.mocked(sendRefundNotification).mockResolvedValue('skipped' as any)
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => {
      consoleError.mockRestore()
    })

    function existingPendingIsNone(op: Op): Reply | undefined {
      // processPayPalRefund's first payment_refunds read looks for a reusable pending row.
      if (op.table === 'payment_refunds' && op.kind === 'select' && !existingPendingAnswered) {
        existingPendingAnswered = true
        return { data: null, error: null }
      }
      return undefined
    }
    let existingPendingAnswered = false
    beforeEach(() => {
      existingPendingAnswered = false
    })

    it('returns success with no warning when every write lands', async () => {
      vi.mocked(refundPayPalPayment).mockResolvedValue({ refundId: 'PP-1', status: 'COMPLETED', currency: 'GBP' } as any)
      const { db, ops } = makeDb(happyReply(existingPendingIsNone))
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const result = await processPayPalRefund('private_booking', 'booking-1', 20, 'test')

      expect(result).toEqual({ success: true, refundId: 'refund-1' })
      expect(ops).toContainEqual(expect.objectContaining({
        table: 'private_bookings',
        kind: 'update',
        payload: { deposit_refund_status: 'refunded' },
      }))
    })

    it.each(['private_booking', 'table_booking', 'parking'] as const)(
      'warns, and still reports success, when the %s refund status cannot be recorded after PayPal refunded',
      async (sourceType) => {
        vi.mocked(refundPayPalPayment).mockResolvedValue({ refundId: 'PP-1', status: 'COMPLETED', currency: 'GBP' } as any)
        const { db } = makeDb(
          happyReply((op) =>
            existingPendingIsNone(op) ??
            (op.table === BOOKING_TABLE[sourceType] && op.kind === 'update'
              ? { data: null, error: WRITE_ERROR }
              : undefined)
          )
        )
        vi.mocked(createAdminClient).mockReturnValue(db as any)

        const result = await processPayPalRefund(sourceType, 'booking-1', 20, 'test')

        expect(result).toEqual({ success: true, refundId: 'refund-1', warning: BOOKING_NOT_UPDATED })
        expect(result.error).toBeUndefined()
      }
    )

    it('writes no refund status, and warns, when the earlier refunds cannot be read', async () => {
      vi.mocked(refundPayPalPayment).mockResolvedValue({ refundId: 'PP-1', status: 'COMPLETED', currency: 'GBP' } as any)
      const { db, ops } = makeDb(
        happyReply((op) =>
          existingPendingIsNone(op) ??
          (op.table === 'payment_refunds' && op.kind === 'select'
            ? { data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } }
            : undefined)
        )
      )
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const result = await processPayPalRefund('table_booking', 'booking-1', 20, 'test')

      expect(result).toEqual({ success: true, refundId: 'refund-1', warning: BOOKING_NOT_UPDATED })
      // A failed read must not be summed as zero and written as a partial refund.
      expect(ops.filter((op) => op.table === 'table_bookings' && op.kind === 'update')).toEqual([])
    })

    it('warns on a manual refund when the booking refund status cannot be recorded', async () => {
      const { db } = makeDb(
        happyReply((op) =>
          op.table === 'private_bookings' && op.kind === 'update' ? { data: null, error: WRITE_ERROR } : undefined
        )
      )
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const result = await processManualRefund('private_booking', 'booking-1', 20, 'cash back', 'cash')

      expect(result).toEqual({ success: true, refundId: 'refund-1', warning: BOOKING_NOT_UPDATED })
    })

    it('returns a manual refund with no warning when every write lands', async () => {
      const { db } = makeDb(happyReply())
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const result = await processManualRefund('private_booking', 'booking-1', 20, 'cash back', 'cash')

      expect(result).toEqual({ success: true, refundId: 'refund-1' })
    })

    it.each([
      ['lands', true],
      ['fails', false],
    ] as const)('says the refund record is stuck as pending only when marking a rejected refund failed %s', async (_label, writeLands) => {
      vi.mocked(refundPayPalPayment).mockRejectedValue(new Error('UNPROCESSABLE_ENTITY'))
      const { db } = makeDb(
        happyReply((op) =>
          existingPendingIsNone(op) ??
          (!writeLands && op.table === 'payment_refunds' && op.kind === 'update' && op.payload?.status === 'failed'
            ? { data: null, error: WRITE_ERROR }
            : undefined)
        )
      )
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const result = await processPayPalRefund('private_booking', 'booking-1', 20, 'test')

      expect(result.success).toBeUndefined()
      expect(result.error).toContain('PayPal refund failed: UNPROCESSABLE_ENTITY.')
      if (writeLands) {
        expect(result.error).not.toContain(STUCK_PENDING)
      } else {
        expect(result.error).toMatch(new RegExp(`${STUCK_PENDING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
      }
    })

    it.each(['FAILED', 'CANCELLED'])(
      'says the refund record is stuck as pending when PayPal returns %s and it cannot be marked failed',
      async (paypalStatus) => {
        vi.mocked(refundPayPalPayment).mockResolvedValue({ refundId: 'PP-1', status: paypalStatus, currency: 'GBP' } as any)
        const { db } = makeDb(
          happyReply((op) =>
            existingPendingIsNone(op) ??
            (op.table === 'payment_refunds' && op.kind === 'update' && op.payload?.status === 'failed'
              ? { data: null, error: WRITE_ERROR }
              : undefined)
          )
        )
        vi.mocked(createAdminClient).mockReturnValue(db as any)

        const result = await processPayPalRefund('private_booking', 'booking-1', 20, 'test')

        expect(result.success).toBeUndefined()
        expect(result.error).toBe(
          `PayPal refund returned status: ${paypalStatus}. You can try again or use manual refund. ${STUCK_PENDING}`
        )
      }
    )

    it.each([
      [
        'COMPLETED',
        { pending: undefined },
        'The refund went through, but it was not recorded here. Do not refund again: tell the developer so the refund can be recorded.',
      ],
      [
        'PENDING',
        { pending: true },
        'The refund is pending at PayPal, but it was not recorded here. Do not refund again: tell the developer so the refund can be recorded.',
      ],
    ] as const)(
      'warns not to refund again when a %s refund cannot be recorded after post-processing failed',
      async (paypalStatus, extra, warning) => {
        // A currency mismatch throws inside post-processing, after PayPal has answered.
        vi.mocked(refundPayPalPayment).mockResolvedValue({ refundId: 'PP-1', status: paypalStatus, currency: 'USD' } as any)
        const { db } = makeDb(
          happyReply((op) =>
            existingPendingIsNone(op) ??
            (op.table === 'payment_refunds' && op.kind === 'update' && String(op.payload?.failure_message ?? '').startsWith('Post-processing error')
              ? { data: null, error: WRITE_ERROR }
              : undefined)
          )
        )
        vi.mocked(createAdminClient).mockReturnValue(db as any)

        const result = await processPayPalRefund('private_booking', 'booking-1', 20, 'test')

        expect(result).toEqual({ success: true, refundId: 'refund-1', ...(extra.pending ? { pending: true } : {}), warning })
      }
    )

    it('keeps the ordinary post-processing warning when the fallback record lands', async () => {
      vi.mocked(refundPayPalPayment).mockResolvedValue({ refundId: 'PP-1', status: 'COMPLETED', currency: 'USD' } as any)
      const { db } = makeDb(happyReply(existingPendingIsNone))
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const result = await processPayPalRefund('private_booking', 'booking-1', 20, 'test')

      expect(result).toEqual({
        success: true,
        refundId: 'refund-1',
        warning: 'Refund processed at PayPal but some local updates may have failed. Please refresh.',
      })
    })
  })
})
