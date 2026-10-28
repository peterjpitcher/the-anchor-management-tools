import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventBookingCancelledEmail: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/events/manage-booking', () => ({ processEventRefund: vi.fn() }))
vi.mock('@/lib/events/payment-alerts', () => ({ alertEventPaymentNeedsAPerson: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/money-alerts', () => ({
  alertMoneyNeedsAPerson: vi.fn().mockResolvedValue({ sent: true, duplicate: false }),
  formatPounds: (amount: number) => `£${amount.toFixed(2)}`,
}))

import { EventService } from '@/services/events'
import { processEventRefund } from '@/lib/events/manage-booking'
import { alertEventPaymentNeedsAPerson } from '@/lib/events/payment-alerts'
import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { sendEventBookingCancelledEmail } from '@/lib/email/event-ticket-emails'
import { sendSMS } from '@/lib/twilio'

/**
 * BK-136: cancelling a whole event asked PayPal for each payment's original amount. After a
 * partial refund PayPal returned the right remainder, but the result read as a refund needing
 * staff follow-up and the guest was told so. Each payment is now asked only for what it holds.
 *
 * BK-135: a ticket paid at the bar in cash or by card went to the PayPal refund, which found no
 * capture and reported "needs staff follow-up" with no list to work from. Bar payments are now
 * listed in the job result and one manager alert, and the guest is told we will give it back.
 */

type Call = { table: string; method: string; args: unknown[] }

function db(rows: { bookings: unknown[]; payments: unknown[]; refunds: unknown[] }) {
  const calls: Call[] = []
  const from = vi.fn((table: string) => {
    const own: Call[] = []
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'update', 'insert', 'eq', 'in', 'is', 'order', 'limit', 'maybeSingle', 'single']) {
      chain[method] = (...args: unknown[]) => {
        const call = { table, method, args }
        calls.push(call)
        own.push(call)
        return chain
      }
    }
    chain.then = (resolve: (value: unknown) => unknown) => {
      const isRefundRead = table === 'payments' && own.some((call) => call.method === 'eq' && call.args[0] === 'charge_type' && call.args[1] === 'refund')
      const data = table === 'payments' ? (isRefundRead ? rows.refunds : rows.payments) : table === 'bookings' ? rows.bookings : []
      return Promise.resolve({ data, error: null }).then(resolve)
    }
    return chain
  })
  return { client: { from } as never, calls }
}

const params = { eventId: 'event-1', eventName: 'Tinsel and Tipples', eventDate: '2026-11-20', eventTime: '19:00', cancelledBy: 'user-1' }

function booking(id: string) {
  return {
    id,
    customer_id: `customer-${id}`,
    seats: 2,
    status: 'confirmed',
    customers: { id: `customer-${id}`, first_name: 'Sam', mobile_number: '+447700900001', sms_status: 'active' },
  }
}

describe('whole-event cancellation refunds what each payment still holds', () => {
  beforeEach(() => vi.clearAllMocks())

  it('asks PayPal only for the rest after a partial refund, and calls it a success', async () => {
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'succeeded', amount: 60, currency: 'GBP' })
    const { client } = db({
      bookings: [booking('booking-1')],
      payments: [{ id: 'payment-1', event_booking_id: 'booking-1', amount: 80, status: 'partially_refunded', payment_provider: 'paypal', payment_method: 'paypal' }],
      refunds: [{ event_booking_id: 'booking-1', amount: 20, metadata: { source_payment_id: 'payment-1' } }],
    })

    const result = await EventService.cancelEventBookings({ ...params, supabase: client })

    expect(processEventRefund).toHaveBeenCalledWith(client, expect.objectContaining({ amount: 60, sourcePaymentId: 'payment-1' }))
    expect(result).toMatchObject({ refundsProcessed: 1, refundsFailed: 0, barRefundsOwed: [] })
    expect(alertEventPaymentNeedsAPerson).not.toHaveBeenCalled()
    expect(sendEventBookingCancelledEmail).toHaveBeenCalledWith(client, expect.objectContaining({
      refundStatus: 'succeeded', refundAmount: 60, refundIsRestOfPayment: true,
    }))
    expect(vi.mocked(sendSMS).mock.calls[0]?.[1]).toContain('The rest of your payment, £60.00, will be refunded within 5-10 business days.')
    expect(vi.mocked(sendSMS).mock.calls[0]?.[1]).not.toContain('Please contact us about your refund')
  })

  it('takes a refund recorded without its payment off what the booking holds', async () => {
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'succeeded', amount: 30, currency: 'GBP' })
    const { client } = db({
      bookings: [booking('booking-1')],
      payments: [{ id: 'payment-1', event_booking_id: 'booking-1', amount: 40, status: 'succeeded', payment_provider: 'paypal', payment_method: 'paypal' }],
      refunds: [{ event_booking_id: 'booking-1', amount: 10, metadata: {} }],
    })

    await EventService.cancelEventBookings({ ...params, supabase: client })

    expect(processEventRefund).toHaveBeenCalledWith(client, expect.objectContaining({ amount: 30 }))
  })

  it('asks for nothing when the payment has already been refunded in full', async () => {
    const { client } = db({
      bookings: [booking('booking-1')],
      payments: [{ id: 'payment-1', event_booking_id: 'booking-1', amount: 40, status: 'partially_refunded', payment_provider: 'paypal', payment_method: 'paypal' }],
      refunds: [{ event_booking_id: 'booking-1', amount: 40, metadata: { source_payment_id: 'payment-1' } }],
    })

    const result = await EventService.cancelEventBookings({ ...params, supabase: client })

    expect(processEventRefund).not.toHaveBeenCalled()
    expect(result).toMatchObject({ refundsProcessed: 0, refundsFailed: 0 })
    expect(alertEventPaymentNeedsAPerson).not.toHaveBeenCalled()
  })
})

describe('whole-event cancellation lists tickets paid at the bar', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists cash and card payments for a person to hand back, alerts once and tells the guest', async () => {
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'succeeded', amount: 40, currency: 'GBP' })
    const { client } = db({
      bookings: [booking('booking-cash'), booking('booking-card'), booking('booking-paypal')],
      payments: [
        { id: 'payment-cash', event_booking_id: 'booking-cash', amount: 45, status: 'succeeded', payment_provider: 'manual', payment_method: 'cash' },
        { id: 'payment-card', event_booking_id: 'booking-card', amount: 90, status: 'succeeded', payment_provider: 'manual', payment_method: 'card_terminal' },
        { id: 'payment-paypal', event_booking_id: 'booking-paypal', amount: 40, status: 'succeeded', payment_provider: 'paypal', payment_method: 'paypal' },
      ],
      refunds: [],
    })

    const result = await EventService.cancelEventBookings({ ...params, supabase: client })

    expect(vi.mocked(processEventRefund).mock.calls.map((call) => call[1].sourcePaymentId)).toEqual(['payment-paypal'])
    expect(result.barRefundsOwed).toEqual([
      { bookingId: 'booking-cash', paymentId: 'payment-cash', amount: 45, method: 'cash' },
      { bookingId: 'booking-card', paymentId: 'payment-card', amount: 90, method: 'card_terminal' },
    ])
    expect(result.refundsFailed).toBe(0)
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledTimes(1)
    const alert = vi.mocked(alertMoneyNeedsAPerson).mock.calls[0][1]
    expect(alert).toMatchObject({ domain: 'event_bookings', bookingId: 'event-1', kind: 'event_cancelled_bar_refunds', path: '/events/event-1' })
    expect(alert.title).toContain('£135.00')
    expect(Object.values(alert.context ?? {})).toEqual(['booking-cash: £45.00 (cash)', 'booking-card: £90.00 (card)'])
    expect(JSON.stringify(alert)).not.toContain('Sam')
    expect(alertEventPaymentNeedsAPerson).not.toHaveBeenCalled()

    const emailFor = (id: string) => vi.mocked(sendEventBookingCancelledEmail).mock.calls.find((call) => call[1].bookingId === id)?.[1]
    expect(emailFor('booking-cash')).toMatchObject({ refundStatus: 'bar_refund_due', refundAmount: 45 })
    const smsBodies = vi.mocked(sendSMS).mock.calls.map((call) => call[1] as string)
    expect(smsBodies.some((body) => body.includes("You paid £45.00 at the bar, so we'll be in touch to give it back."))).toBe(true)
  })

  it('tells a guest who paid both ways what goes back online and what at the bar (review finding on PR 277)', async () => {
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'succeeded', amount: 80, currency: 'GBP' })
    const { client } = db({
      bookings: [booking('booking-mixed')],
      payments: [
        { id: 'payment-paypal', event_booking_id: 'booking-mixed', amount: 80, status: 'succeeded', payment_provider: 'paypal', payment_method: 'paypal' },
        { id: 'payment-cash', event_booking_id: 'booking-mixed', amount: 45, status: 'succeeded', payment_provider: 'manual', payment_method: 'cash' },
      ],
      refunds: [],
    })

    await EventService.cancelEventBookings({ ...params, supabase: client })

    expect(sendEventBookingCancelledEmail).toHaveBeenCalledWith(client, expect.objectContaining({
      bookingId: 'booking-mixed', refundStatus: 'succeeded', refundAmount: 80, barRefundAmount: 45,
    }))
    const sms = String(vi.mocked(sendSMS).mock.calls[0]?.[1])
    expect(sms).toContain("The £80.00 you paid online will be refunded within 5-10 business days, and we'll hand back the £45.00 you paid at the bar.")
    expect(sms).not.toContain('£125.00')
    // GSM-7 only: straight apostrophes, the pound sign, nothing that forces a Unicode text.
    expect(sms).toMatch(/^[A-Za-z0-9 £.,:;'!?()\-+/@&%\n]*$/)
  })
})
