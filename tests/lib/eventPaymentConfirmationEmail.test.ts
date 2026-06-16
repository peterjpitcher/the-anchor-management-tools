import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn().mockResolvedValue({
    rawToken: 'manage-token',
    url: 'https://management.orangejelly.co.uk/g/manage-token/manage-booking',
    expiresAt: '2026-07-19T19:00:00.000Z',
  }),
}))

const { warn } = vi.hoisted(() => ({
  warn: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn,
  },
}))

import { sendEmail } from '@/lib/email/emailService'
import { createEventManageToken } from '@/lib/events/manage-booking'
import {
  sendEventBookingCancelledEmail,
  sendEventPaymentConfirmationEmail,
  sendEventPaymentExpiredEmail,
  sendEventPaymentManualReviewEmail,
  sendEventPostponedEmail,
  sendEventRescheduledEmail,
  sendEventTicketTransferredEmail,
} from '@/lib/email/event-ticket-emails'

function buildSupabase(options?: {
  booking?: Record<string, unknown> | null
  existingConfirmation?: Record<string, unknown> | null
}) {
  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: options?.booking === undefined
      ? {
          id: 'booking-1',
          customer_id: 'customer-1',
          seats: 2,
          customers: {
            id: 'customer-1',
            first_name: 'Pat',
            email: 'pat@example.com',
          },
          events: {
            id: 'event-1',
            name: 'Music Bingo',
            start_datetime: '2026-07-17T19:00:00.000Z',
            date: '2026-07-17',
            time: '20:00:00',
            booking_url: 'https://the-anchor.pub/events/music-bingo',
          },
        }
      : options.booking,
    error: null,
  })
  const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
  const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

  const emailMaybeSingle = vi.fn().mockResolvedValue({
    data: options?.existingConfirmation ?? null,
    error: null,
  })
  const emailLimit = vi.fn().mockReturnValue({ maybeSingle: emailMaybeSingle })
  const emailContains = vi.fn().mockReturnValue({ limit: emailLimit })
  const emailIn = vi.fn().mockReturnValue({ limit: emailLimit, contains: emailContains })
  const emailEqCommType = vi.fn().mockReturnValue({ in: emailIn })
  const emailEqBooking = vi.fn().mockReturnValue({ eq: emailEqCommType })
  const emailSelect = vi.fn().mockReturnValue({ eq: emailEqBooking })

  return {
    from: vi.fn((table: string) => {
      if (table === 'bookings') {
        return { select: bookingSelect }
      }
      if (table === 'email_messages') {
        return { select: emailSelect }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    emailMaybeSingle,
  }
}

describe('event payment confirmation email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(sendEmail as unknown as vi.Mock).mockResolvedValue({
      success: true,
      messageId: 'email-1',
    })
  })

  it('sends a customer confirmation email after payment', async () => {
    const supabase = buildSupabase()

    const result = await sendEventPaymentConfirmationEmail(supabase as any, {
      bookingId: 'booking-1',
      amount: 10,
      currency: 'GBP',
      appBaseUrl: 'https://management.orangejelly.co.uk',
    })

    expect(result).toEqual({ success: true, messageId: 'email-1' })
    expect(createEventManageToken).toHaveBeenCalledWith(supabase, expect.objectContaining({
      customerId: 'customer-1',
      bookingId: 'booking-1',
      eventStartIso: '2026-07-17T19:00:00.000Z',
      appBaseUrl: 'https://management.orangejelly.co.uk',
    }))
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'pat@example.com',
      subject: 'Booking confirmed: Music Bingo',
      commType: 'event_payment_confirmation',
      customerId: 'customer-1',
      eventBookingId: 'booking-1',
      metadata: expect.objectContaining({
        template_key: 'event_payment_confirmation_email',
        amount: 10,
        currency: 'GBP',
        manage_link_included: true,
      }),
    }))
    expect((sendEmail as unknown as vi.Mock).mock.calls[0][0].text).toContain('We have received your £10.00 payment')
    expect((sendEmail as unknown as vi.Mock).mock.calls[0][0].html).toContain('Manage booking')
  })

  it('skips when a successful confirmation email already exists', async () => {
    const supabase = buildSupabase({
      existingConfirmation: { id: 'email-message-1' },
    })

    const result = await sendEventPaymentConfirmationEmail(supabase as any, {
      bookingId: 'booking-1',
      amount: 10,
      currency: 'GBP',
    })

    expect(result).toEqual({ success: true, skipped: true })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(createEventManageToken).not.toHaveBeenCalled()
  })

  it('skips when the customer does not have an email address', async () => {
    const supabase = buildSupabase({
      booking: {
        id: 'booking-1',
        customer_id: 'customer-1',
        seats: 1,
        customers: {
          id: 'customer-1',
          first_name: 'Pat',
          email: null,
        },
        events: {
          id: 'event-1',
          name: 'Music Bingo',
          start_datetime: '2026-07-17T19:00:00.000Z',
        },
      },
    })

    const result = await sendEventPaymentConfirmationEmail(supabase as any, {
      bookingId: 'booking-1',
    })

    expect(result).toEqual({ success: false, skipped: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends a manual-review email when payment needs staff action', async () => {
    const result = await sendEventPaymentManualReviewEmail(buildSupabase() as any, {
      bookingId: 'booking-1',
      amount: 10,
      currency: 'GBP',
    })

    expect(result).toEqual({ success: true, messageId: 'email-1' })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Payment received: Music Bingo',
      commType: 'event_payment_manual_review',
      metadata: expect.objectContaining({
        template_key: 'event_payment_manual_review_email',
      }),
    }))
    expect((sendEmail as unknown as vi.Mock).mock.calls[0][0].text).toContain('Staff need to check your booking')
  })

  it('sends an expired hold email with a rebook link', async () => {
    const result = await sendEventPaymentExpiredEmail(buildSupabase() as any, {
      bookingId: 'booking-1',
    })

    expect(result).toEqual({ success: true, messageId: 'email-1' })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Payment hold released: Music Bingo',
      commType: 'event_payment_expired',
      metadata: expect.objectContaining({
        template_key: 'event_payment_expired_email',
      }),
    }))
    expect((sendEmail as unknown as vi.Mock).mock.calls[0][0].text).toContain('Rebook here: https://the-anchor.pub/events/music-bingo')
  })

  it('sends a cancellation email with refund details', async () => {
    const result = await sendEventBookingCancelledEmail(buildSupabase() as any, {
      bookingId: 'booking-1',
      refundStatus: 'succeeded',
      refundAmount: 5,
      currency: 'GBP',
      reason: 'staff_cancel',
    })

    expect(result).toEqual({ success: true, messageId: 'email-1' })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Booking cancelled: Music Bingo',
      commType: 'event_booking_cancelled',
      metadata: expect.objectContaining({
        template_key: 'event_booking_cancelled_email',
        refund_status: 'succeeded',
        refund_amount: 5,
      }),
    }))
    expect((sendEmail as unknown as vi.Mock).mock.calls[0][0].text).toContain('A refund of £5.00 has been issued')
  })

  it('sends a transfer email with a manage link', async () => {
    const result = await sendEventTicketTransferredEmail(buildSupabase() as any, {
      bookingId: 'booking-1',
      fromEventName: 'Quiz Night',
      toEventName: 'Music Bingo',
      eventStartIso: '2026-07-17T19:00:00.000Z',
      appBaseUrl: 'https://management.orangejelly.co.uk',
    })

    expect(result).toEqual({ success: true, messageId: 'email-1' })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Tickets transferred: Music Bingo',
      commType: 'event_ticket_transferred',
      metadata: expect.objectContaining({
        template_key: 'event_ticket_transferred_email',
      }),
    }))
    expect((sendEmail as unknown as vi.Mock).mock.calls[0][0].text).toContain('transferred from Quiz Night to Music Bingo')
  })

  it('sends a reschedule email for a specific date change', async () => {
    const result = await sendEventRescheduledEmail(buildSupabase() as any, {
      bookingId: 'booking-1',
      eventName: 'Music Bingo',
      oldDate: '2026-07-17',
      oldTime: '20:00',
      newDate: '2026-07-24',
      newTime: '20:00',
      appBaseUrl: 'https://management.orangejelly.co.uk',
    })

    expect(result).toEqual({ success: true, messageId: 'email-1' })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Event rescheduled: Music Bingo',
      commType: 'event_rescheduled',
      metadata: expect.objectContaining({
        template_key: 'event_rescheduled_email',
        old_date: '2026-07-17',
        new_date: '2026-07-24',
      }),
    }))
    expect((sendEmail as unknown as vi.Mock).mock.calls[0][0].text).toContain('has been rescheduled')
  })

  it('sends a postponed email telling guests staff will decide next steps', async () => {
    const result = await sendEventPostponedEmail(buildSupabase() as any, {
      bookingId: 'booking-1',
      eventName: 'Music Bingo',
    })

    expect(result).toEqual({ success: true, messageId: 'email-1' })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Event postponed: Music Bingo',
      commType: 'event_postponed',
      metadata: expect.objectContaining({
        template_key: 'event_postponed_email',
      }),
    }))
    expect((sendEmail as unknown as vi.Mock).mock.calls[0][0].text).toContain('Staff will decide whether to hold your tickets')
  })
})
