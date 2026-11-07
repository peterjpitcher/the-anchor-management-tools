import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Event checkout spec, Piece 4.1, through the booking service: a website hold (brand_site, with
 * the website's skip_customer_sms) is emailed its payment link once, at once, and never texted.
 * A guest with no email gets nothing, a failed email never fails the booking, and phone and
 * staff bookings keep the path they had.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
const twilio = vi.hoisted(() => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: twilio.sendSMS }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: vi.fn((value: string) => value) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/google-calendar-events', () => ({ syncPubOpsEventCalendarByEventId: vi.fn() }))
vi.mock('@/lib/events/guest-details-request', () => ({ requestMissingGuestDetails: vi.fn() }))
vi.mock('@/lib/bookings/contact-email', () => ({ recordBookingContactEmail: vi.fn() }))
vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn().mockResolvedValue({ url: 'https://example.com/manage' }),
}))
vi.mock('@/lib/events/event-payments', () => ({
  createEventPaymentToken: vi.fn().mockResolvedValue({ url: 'https://example.com/pay' }),
}))
const emails = vi.hoisted(() => ({
  sendEventBookingConfirmedEmail: vi.fn(),
  sendEventPaymentLinkEmail: vi.fn(),
}))
vi.mock('@/lib/email/event-ticket-emails', () => emails)
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/notifications/delivery-ledger', () => ({
  createNotificationDelivery: vi.fn(async () => 'delivery-1'),
  recordNotificationAttempt: vi.fn(async () => undefined),
  updateNotificationDelivery: vi.fn(async () => undefined),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { EventBookingService } from '@/services/event-bookings'

const HOLD_ENDS = '2026-11-07T20:42:00.000Z'

/** One database shared across calls, so a second booking call meets the first call's claim. */
function database(options: { customerEmail?: string | null } = {}) {
  const claimed = new Set<string>()
  const claims: string[] = []
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'customer-1',
                  first_name: 'Pat',
                  mobile_number: '+447700900123',
                  sms_status: 'active',
                  email: options.customerEmail ?? null,
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'idempotency_keys') {
        return {
          insert: async (row: { key: string }) => {
            claims.push(row.key)
            if (claimed.has(row.key)) return { error: { code: '23505', message: 'duplicate key' } }
            claimed.add(row.key)
            return { error: null }
          },
        }
      }
      // Anything else: an empty, successful answer.
      const chain: any = new Proxy({}, {
        get: (_t, prop) => prop === 'then'
          ? (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
          : () => chain,
      })
      return chain
    }),
    rpc: vi.fn().mockResolvedValue({
      data: {
        state: 'pending_payment',
        booking_id: 'booking-1',
        payment_mode: 'prepaid',
        event_id: 'event-1',
        event_name: 'Tasting Night',
        event_start_datetime: '2026-11-20T19:00:00Z',
        hold_expires_at: HOLD_ENDS,
      },
      error: null,
    }),
  }
  return { client, claims }
}

const base = {
  eventId: 'event-1',
  customerId: 'customer-1',
  normalizedPhone: '+447700900123',
  seats: 2,
  bookingMode: 'general' as const,
  appBaseUrl: 'https://management.orangejelly.co.uk',
}

const website = { ...base, source: 'brand_site' as const, skipPendingPaymentSms: true, contactEmail: 'guest@example.com' }

describe('website event hold payment email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    twilio.sendSMS.mockResolvedValue({ success: true, sid: 'SM1' })
    emails.sendEventPaymentLinkEmail.mockResolvedValue({ success: true, messageId: 'email-1' })
  })

  it('emails the payment link once and sends no text', async () => {
    const db = database()

    const result = await EventBookingService.createBooking({ ...website, supabaseClient: db.client as never })

    expect(result.resolvedState).toBe('pending_payment')
    expect(emails.sendEventPaymentLinkEmail).toHaveBeenCalledOnce()
    expect(emails.sendEventPaymentLinkEmail).toHaveBeenCalledWith(db.client, {
      bookingId: 'booking-1',
      paymentLink: 'https://example.com/pay',
      holdExpiresAt: HOLD_ENDS,
    })
    expect(twilio.sendSMS).not.toHaveBeenCalled()
    // A payment link is not a confirmation: what the website is told stays as it was.
    expect(result.notificationChannel).toBeNull()
  })

  it('sends nothing to a guest with no email', async () => {
    const db = database({ customerEmail: null })

    await EventBookingService.createBooking({ ...website, contactEmail: null, supabaseClient: db.client as never })

    expect(emails.sendEventPaymentLinkEmail).not.toHaveBeenCalled()
    expect(twilio.sendSMS).not.toHaveBeenCalled()
    expect(db.claims).toHaveLength(0)
  })

  it('does not resend when the same booking comes through again', async () => {
    const db = database()

    await EventBookingService.createBooking({ ...website, supabaseClient: db.client as never })
    await EventBookingService.createBooking({ ...website, supabaseClient: db.client as never })

    expect(db.claims).toEqual([
      'message:event_hold_payment_link_email:booking-1',
      'message:event_hold_payment_link_email:booking-1',
    ])
    expect(emails.sendEventPaymentLinkEmail).toHaveBeenCalledOnce()
  })

  it('still returns the held booking when the email fails or throws', async () => {
    for (const failure of [
      () => emails.sendEventPaymentLinkEmail.mockResolvedValueOnce({ success: false, error: 'Resend is down' }),
      () => emails.sendEventPaymentLinkEmail.mockRejectedValueOnce(new Error('boom')),
    ]) {
      failure()
      const db = database()

      const result = await EventBookingService.createBooking({ ...website, supabaseClient: db.client as never })

      expect(result).toMatchObject({ resolvedState: 'pending_payment', bookingId: 'booking-1', nextStepUrl: 'https://example.com/pay' })
    }
    expect(twilio.sendSMS).not.toHaveBeenCalled()
  })

  it('leaves a staff booking waiting for payment on its own path, with no website claim', async () => {
    emails.sendEventPaymentLinkEmail.mockResolvedValue({ success: false, skipped: true })
    const db = database()

    await EventBookingService.createBooking({ ...base, source: 'admin', skipPendingPaymentSms: true, supabaseClient: db.client as never })

    // BK-142: email first, and the text when no email could go, exactly as before.
    expect(emails.sendEventPaymentLinkEmail).toHaveBeenCalledOnce()
    expect(twilio.sendSMS).toHaveBeenCalledOnce()
    expect(db.claims).toHaveLength(0)
  })

  it('leaves a phone booking that the guest can be emailed on its own path, with no website claim', async () => {
    const db = database({ customerEmail: 'guest@example.com' })

    await EventBookingService.createBooking({ ...base, source: 'admin', supabaseClient: db.client as never })

    expect(emails.sendEventPaymentLinkEmail).toHaveBeenCalledOnce()
    expect(twilio.sendSMS).not.toHaveBeenCalled()
    expect(db.claims).toHaveLength(0)
  })
})
