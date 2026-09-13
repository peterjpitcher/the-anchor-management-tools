/**
 * Which refund email a guest gets, and what it is told about the booking.
 *
 * Two defects: a completed private booking refunded by PayPal produced TWO guest emails, the
 * itemised deposit one and the generic one, which disagreed with each other; and a full
 * parking refund cancelled the booking without telling the guest, who could then have driven
 * to Heathrow expecting a space.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  refundPayPalPayment: vi.fn(),
}))
vi.mock('@/lib/refund-notifications', () => ({ sendRefundNotification: vi.fn() }))
vi.mock('@/lib/email/private-booking-emails', () => ({
  sendDepositRefundEmail: vi.fn(),
  sendDepositRefundWithDeductionsEmail: vi.fn(),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/table-bookings/deposit-refund', () => ({
  resolveSeasonalDepositRefund: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { refundPayPalPayment } from '@/lib/paypal'
import { sendRefundNotification } from '@/lib/refund-notifications'
import { sendDepositRefundEmail } from '@/lib/email/private-booking-emails'
import { checkUserPermission } from '@/app/actions/rbac'

const CAPTURED_AT = '2026-09-01T12:00:00.000Z'

type TableState = Record<string, any>

/**
 * A per-table fake, because this flow reads and writes five tables in sequence and a single
 * chainable stub cannot tell them apart.
 */
function buildDb(state: {
  parkingPayment?: TableState
  parkingBooking?: TableState
  privateBooking?: TableState
  completedRefunds?: Array<{ amount: number }>
}) {
  const parkingBookingUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })

  const db: any = {
    from: vi.fn((table: string) => {
      if (table === 'parking_booking_payments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: state.parkingPayment ?? null, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        }
      }
      if (table === 'parking_bookings') {
        return { update: parkingBookingUpdate }
      }
      if (table === 'private_bookings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: state.privateBooking ?? null, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        }
      }
      if (table === 'payment_refunds') {
        // Two different reads land here: the pending-row lookup (four `eq` calls then
        // `maybeSingle`) and the completed-refund sum (three `eq` calls, then awaited). One
        // chain has to answer both, so every link is awaitable and also chainable.
        const link = (): any => {
          const node: any = Promise.resolve({
            data: state.completedRefunds ?? [{ amount: 72.5 }],
            error: null,
          })
          node.eq = vi.fn(link)
          node.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
          return node
        }
        return {
          select: vi.fn(link),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn().mockResolvedValue({ data: { refund_id: 'refund-1' }, error: null }),
  }

  return { db, parkingBookingUpdate }
}

describe('refund notification routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(checkUserPermission).mockResolvedValue(true)
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    } as never)
    vi.mocked(refundPayPalPayment).mockResolvedValue({
      status: 'COMPLETED',
      refundId: 'paypal-refund-1',
      currency: 'GBP',
    } as never)
    vi.mocked(sendRefundNotification).mockResolvedValue('email_sent' as never)
  })

  it('sends only the itemised private booking email, not the generic one as well', async () => {
    const { db } = buildDb({
      // The whole £250 deposit is back, so the ledger says so: the email's figures come from the
      // completed refunds on the booking, not from the payment in front of it (review PB-4).
      completedRefunds: [{ amount: 250 }],
      privateBooking: {
        id: 'booking-1',
        status: 'completed',
        customer_id: 'customer-1',
        contact_email: 'guest@example.com',
        customer_first_name: 'Jane',
        customer_name: 'Jane Smith',
        event_date: '2026-09-19',
        event_type: 'Birthday',
        deposit_amount: 250,
        deposit_paid_date: CAPTURED_AT,
        paypal_deposit_capture_id: 'CAPTURE-1',
        invoice_id: null,
        invoice_deposit_treatment: null,
        contact_phone: '+447700900000',
      },
    })
    vi.mocked(createAdminClient).mockReturnValue(db as never)

    const { processPayPalRefund } = await import('@/app/actions/refundActions')
    const result = await processPayPalRefund('private_booking', 'booking-1', 250, 'Return deposit')

    expect(result).toMatchObject({ success: true })
    expect(sendDepositRefundEmail).toHaveBeenCalled()
    expect(sendRefundNotification).not.toHaveBeenCalled()
  })

  it('still sends the generic email for a private booking that is not completed', async () => {
    const { db } = buildDb({
      privateBooking: {
        id: 'booking-1',
        status: 'confirmed',
        customer_id: 'customer-1',
        contact_email: 'guest@example.com',
        customer_name: 'Jane Smith',
        contact_phone: '+447700900000',
        event_date: '2026-09-19',
        deposit_amount: 250,
        deposit_paid_date: CAPTURED_AT,
        paypal_deposit_capture_id: 'CAPTURE-1',
        invoice_id: null,
        invoice_deposit_treatment: null,
      },
    })
    vi.mocked(createAdminClient).mockReturnValue(db as never)

    const { processPayPalRefund } = await import('@/app/actions/refundActions')
    await processPayPalRefund('private_booking', 'booking-1', 250, 'Return deposit')

    expect(sendDepositRefundEmail).not.toHaveBeenCalled()
    expect(sendRefundNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          subject: 'private_booking',
          bookingDate: '2026-09-19',
        }),
      })
    )
  })

  it('tells a parking guest the booking was cancelled by the refund', async () => {
    const { db, parkingBookingUpdate } = buildDb({
      parkingPayment: {
        id: 'parking-payment-1',
        transaction_id: 'CAPTURE-1',
        paid_at: CAPTURED_AT,
        amount: 72.5,
        currency: 'gbp',
        booking_id: 'parking-booking-1',
        parking_bookings: {
          customer_id: 'customer-1',
          customer_first_name: 'Sam',
          customer_last_name: 'Patel',
          customer_email: 'sam@example.com',
          customer_mobile: '+447700900001',
          start_at: '2026-10-24T23:30:00Z',
          reference: 'PK-7781',
        },
      },
    })
    vi.mocked(createAdminClient).mockReturnValue(db as never)

    const { processPayPalRefund } = await import('@/app/actions/refundActions')
    await processPayPalRefund('parking', 'parking-payment-1', 72.5, 'Guest cancelled')

    expect(parkingBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' })
    )
    expect(sendRefundNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          subject: 'parking',
          reference: 'PK-7781',
          bookingCancelled: true,
        }),
        parkingBookingId: 'parking-booking-1',
      })
    )
  })
})
