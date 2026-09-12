import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCleanRender, expectedLongDate } from '../mocks/emailRenderChecks'

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

const loadBookingItemsWithTypesMock = vi.hoisted(() => vi.fn())
const getDefaultTicketTypeIdMock = vi.hoisted(() => vi.fn())
const bookingItemsAreMultiTypeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/events/ticket-type-queries', () => ({
  loadBookingItemsWithTypes: loadBookingItemsWithTypesMock,
  getDefaultTicketTypeId: getDefaultTicketTypeIdMock,
  bookingItemsAreMultiType: bookingItemsAreMultiTypeMock,
}))

const { warn } = vi.hoisted(() => ({
  warn: vi.fn(),
}))

// Without this the guest manage link is shortened for real, createShortLinkInternal
// throws on the test's Supabase stub, and the fail-open helper hands back the long
// URL. Every assertion below would still pass while proving nothing about what the
// guest receives.
const createShortLinkInternalMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/short-links', () => ({
  ShortLinkService: {
    createShortLinkInternal: createShortLinkInternalMock,
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn,
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { sendEmail } from '@/lib/email/emailService'
import { createEventManageToken } from '@/lib/events/manage-booking'
import {
  sendEventBookingCancelledEmail,
  sendEventBookingConfirmedEmail,
  sendEventPaymentConfirmationEmail,
  sendEventPaymentExpiredEmail,
  sendEventPaymentLinkEmail,
  sendEventPaymentManualReviewEmail,
  sendEventPostponedEmail,
  sendEventRefundStatusUpdateEmail,
  sendEventRescheduledEmail,
  sendEventTicketTransferredEmail,
} from '@/lib/email/event-ticket-emails'

type EventFixture = Record<string, unknown>

/** A quiz night: cash on the night, a table booking, arrival 6:30pm, 7pm start, British Summer Time. */
const QUIZ_EVENT: EventFixture = {
  id: 'event-quiz',
  name: 'Quiz Night',
  event_type: 'quiz',
  start_datetime: '2026-09-16T18:00:00.000Z',
  date: '2026-09-16',
  time: '19:00:00',
  doors_time: '18:30:00',
  booking_url: 'https://www.the-anchor.pub/events/quiz-night',
  booking_mode: 'table',
  payment_mode: 'cash_only',
  price: 3,
  price_per_seat: 3,
  is_free: false,
  online_discount_type: null,
  online_discount_value: null,
  online_discount_ends_at: null,
  category: { name: 'Quiz Night', slug: 'quiz-night' },
}

/** Cash bingo: communal seating, and the two rules that always travel together. */
const CASH_BINGO_EVENT: EventFixture = {
  ...QUIZ_EVENT,
  id: 'event-bingo',
  name: 'Cash Bingo',
  event_type: 'cash_bingo',
  price: 10,
  price_per_seat: 10,
  booking_mode: 'communal',
  category: { name: 'Cash Bingo', slug: 'cash-bingo' },
}

/** Karaoke on 18 September: free, communal, arrive from 7pm for an 8pm start. */
const KARAOKE_EVENT: EventFixture = {
  ...QUIZ_EVENT,
  id: 'event-karaoke',
  name: 'Karaoke Night',
  event_type: 'karaoke',
  start_datetime: '2026-09-18T19:00:00.000Z',
  date: '2026-09-18',
  time: '20:00:00',
  doors_time: '19:00:00',
  booking_mode: 'communal',
  payment_mode: 'free',
  price: 0,
  price_per_seat: null,
  is_free: true,
  category: { name: 'Karaoke', slug: 'karaoke' },
}

/** The tasting night on 20 November: prepaid, and on a GMT date. */
const TASTING_EVENT: EventFixture = {
  ...QUIZ_EVENT,
  id: 'event-tasting',
  name: 'Tinsel and Tipples Christmas Tasting Night',
  event_type: 'tasting',
  start_datetime: '2026-11-20T19:00:00.000Z',
  date: '2026-11-20',
  time: '19:00:00',
  doors_time: '18:30:00',
  booking_mode: 'general',
  payment_mode: 'prepaid',
  price: 45,
  price_per_seat: 45,
  is_free: false,
  online_discount_type: 'fixed',
  online_discount_value: 5,
  category: { name: 'Tasting Night', slug: 'tasting-night' },
}

/** A party that starts a quarter of an hour after midnight, which is the case date maths breaks on. */
const AFTER_MIDNIGHT_EVENT: EventFixture = {
  ...QUIZ_EVENT,
  id: 'event-late',
  name: 'Halloween Party',
  event_type: 'party',
  start_datetime: '2026-11-01T00:15:00.000Z',
  date: '2026-11-01',
  time: '00:15:00',
  doors_time: '23:30:00',
  booking_mode: 'general',
  payment_mode: 'free',
  price: 0,
  price_per_seat: null,
  is_free: true,
  category: { name: 'Party Night', slug: 'party-night' },
}

function buildSupabase(options?: {
  booking?: Record<string, unknown> | null
  event?: EventFixture
  customer?: Record<string, unknown>
  existingConfirmation?: Record<string, unknown> | null
}) {
  const defaultBooking = {
    id: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
    customer_id: 'customer-1',
    seats: 2,
    status: 'confirmed',
    event_seating_type: 'seated',
    attendee_names: [],
    customers: {
      id: 'customer-1',
      first_name: 'Pat',
      email: 'pat@example.com',
      email_status: 'active',
      email_deactivated_at: null,
      ...(options?.customer ?? {}),
    },
    events: options?.event ?? QUIZ_EVENT,
  }

  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: options?.booking === null
      ? null
      : { ...defaultBooking, ...(options?.booking ?? {}) },
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

function lastSend(): { subject: string; html: string; text: string; metadata: Record<string, unknown> } {
  const calls = (sendEmail as unknown as vi.Mock).mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0]
}

/**
 * The polish every event email now carries: a viewport so a phone does not render it at desktop
 * width, a hidden preheader so the inbox previews something better than "Hi Pat,", and a button
 * tall enough to hit (13px + 18px + 13px = 44px).
 */
function assertHouseShell(html: string): void {
  expect(html).toContain('<meta name="viewport" content="width=device-width,initial-scale=1">')
  expect(html).toContain('display:none;max-height:0;overflow:hidden')
  expect(html).toContain('padding:13px 22px')
}

const QUIZ_WHEN = `${expectedLongDate('2026-09-16')} at 7pm`

describe('event guest emails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(sendEmail as unknown as vi.Mock).mockResolvedValue({
      success: true,
      messageId: 'email-1',
    })
    createShortLinkInternalMock.mockResolvedValue({
      short_code: 'mng123',
      full_url: 'https://l.the-anchor.pub/mng123',
      already_exists: false,
    })
    loadBookingItemsWithTypesMock.mockResolvedValue(new Map())
    getDefaultTicketTypeIdMock.mockResolvedValue('type-default')
    bookingItemsAreMultiTypeMock.mockReturnValue(false)
  })

  afterEach(() => {
    delete process.env.EVENT_TICKET_TYPES_ENABLED
  })

  describe('booking confirmed, the free and pay-on-the-night nights', () => {
    it('confirms a quiz booking with the date, the arrival time and what to pay on the night', async () => {
      const result = await sendEventBookingConfirmedEmail(buildSupabase() as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        appBaseUrl: 'https://management.orangejelly.co.uk',
      })

      expect(result).toEqual({ success: true, messageId: 'email-1' })
      const sent = lastSend()
      assertCleanRender(sent)
      assertHouseShell(sent.html)
      expect(sent.subject).toBe(`Booking confirmed: Quiz Night, ${expectedLongDate('2026-09-16').split(' ').slice(0, 3).join(' ')}`)
      expect(sent.text).toContain(`You are booked in for Quiz Night on ${QUIZ_WHEN}, with 2 tickets in your name.`)
      expect(sent.text).toContain('Arrive from 6:30pm for a 7pm start.')
      expect(sent.text).toContain('Pay on the night: £3.00 per person, cash only.')
      expect(sent.text).toContain('Booking reference: 3F2A9C1B.')
      expect(sent.text).toContain('Need to change or cancel your booking? Call 01753 682707.')
      expect(sent.text).toContain('https://l.the-anchor.pub/mng123')
      // "Doors" is banned wording: the pub is open long before an event starts.
      expect(sent.text.toLowerCase()).not.toContain('doors')
      expect(sent.html.toLowerCase()).not.toContain('doors')
      expect(sent.metadata).toMatchObject({
        template_key: 'event_booking_confirmed_email',
        payment_mode: 'cash_only',
        booking_mode: 'table',
        seats: 2,
        manage_link_included: true,
      })
      expect((sendEmail as unknown as vi.Mock).mock.calls[0][0].commType).toBe('event_booking_confirmed')
    })

    it('gives cash bingo its two cash rules and both halves of the age rule, and promises no table', async () => {
      await sendEventBookingConfirmedEmail(buildSupabase({ event: CASH_BINGO_EVENT }) as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain('Books and daubers are cash only: £10 a book and £1 a dauber.')
      expect(sent.text).toContain('It is 18+ to play. Supervised under-18s are welcome to come along, but cannot play.')
      expect(sent.text).toContain('Seating is shared on the night, so there is no reserved table for your group.')
      expect(sent.text).not.toContain('your table')
    })

    it('tells a free night there is nothing to pay, and a standing ticket that it has no seat', async () => {
      await sendEventBookingConfirmedEmail(
        buildSupabase({ event: KARAOKE_EVENT, booking: { seats: 1, event_seating_type: 'standing' } }) as any,
        { bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70' }
      )

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain(`You are booked in for Karaoke Night on ${expectedLongDate('2026-09-18')} at 8pm, with 1 ticket in your name.`)
      expect(sent.text).toContain('Arrive from 7pm for an 8pm start.')
      expect(sent.text).toContain('There is nothing to pay for your place.')
      expect(sent.text).toContain('Your ticket is a standing ticket, so it does not include a table seat.')
    })

    it('reads correctly on a GMT date', async () => {
      await sendEventBookingConfirmedEmail(buildSupabase({ event: TASTING_EVENT }) as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain(`${expectedLongDate('2026-11-20')} at 7pm`)
    })

    it('reads correctly for a night that starts after midnight', async () => {
      await sendEventBookingConfirmedEmail(buildSupabase({ event: AFTER_MIDNIGHT_EVENT }) as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain(`${expectedLongDate('2026-11-01')} at 12:15am`)
      expect(sent.text).toContain('Arrive from 11:30pm')
    })

    it('skips when the confirmation has already gone out', async () => {
      const result = await sendEventBookingConfirmedEmail(
        buildSupabase({ existingConfirmation: { id: 'email-message-1' } }) as any,
        { bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70' }
      )

      expect(result).toEqual({ success: true, skipped: true })
      expect(sendEmail).not.toHaveBeenCalled()
    })

    it('skips an address that has bounced, which is what leaves the text as the fallback', async () => {
      const result = await sendEventBookingConfirmedEmail(
        buildSupabase({ customer: { email_status: 'bounced' } }) as any,
        { bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70' }
      )

      expect(result).toEqual({ success: false, skipped: true })
      expect(sendEmail).not.toHaveBeenCalled()
    })
  })

  describe('payment link', () => {
    it('says how much to pay, and holds one ticket in the singular', async () => {
      const result = await sendEventPaymentLinkEmail(
        buildSupabase({ event: TASTING_EVENT, booking: { seats: 1, status: 'pending_payment' } }) as any,
        {
          bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
          paymentLink: 'https://management.orangejelly.co.uk/g/pay-token/event-payment',
          holdExpiresAt: '2026-11-18T19:00:00.000Z',
        }
      )

      expect(result).toEqual({ success: true, messageId: 'email-1' })
      const sent = lastSend()
      assertCleanRender(sent)
      assertHouseShell(sent.html)
      expect(sent.text).toContain('1 ticket is held for Tinsel and Tipples Christmas Tasting Night')
      // £45 less the £5 online discount the record carries.
      expect(sent.text).toContain('Total to pay: £40.00.')
      expect(sent.subject).toContain(expectedLongDate('2026-11-20').split(' ').slice(0, 3).join(' '))
      expect(sent.metadata.amount_due).toBe(40)
    })
  })

  describe('payment confirmation', () => {
    it('sends a customer confirmation email after payment, with the refund bands', async () => {
      const supabase = buildSupabase({ event: TASTING_EVENT })

      const result = await sendEventPaymentConfirmationEmail(supabase as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        amount: 80,
        currency: 'GBP',
        appBaseUrl: 'https://management.orangejelly.co.uk',
      })

      expect(result).toEqual({ success: true, messageId: 'email-1' })
      expect(createEventManageToken).toHaveBeenCalledWith(supabase, expect.objectContaining({
        customerId: 'customer-1',
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        eventStartIso: '2026-11-20T19:00:00.000Z',
        appBaseUrl: 'https://management.orangejelly.co.uk',
      }))

      const sent = lastSend()
      assertCleanRender(sent)
      assertHouseShell(sent.html)
      expect(sent.text).toContain('We have received your £80.00 payment.')
      expect(sent.text).toContain('Need to cancel? Call 01753 682707.')
      expect(sent.text).toContain('Give up your seats 7 or more days before the event and we refund in full.')
      expect(sent.text).toContain('Inside 3 days there is no refund.')
      expect(sent.html).toContain('Manage booking')
      // The guest gets the short link, and no trace of the long token URL.
      expect(sent.html).toContain('https://l.the-anchor.pub/mng123')
      expect(sent.text).toContain('https://l.the-anchor.pub/mng123')
      expect(sent.html).not.toContain('/g/manage-token/manage-booking')
      expect(sent.text).not.toContain('/g/manage-token/manage-booking')
      expect(sent.metadata.short_link_fallback).toBe(false)
    })

    it('never tells a comped guest we received a payment of nothing', async () => {
      await sendEventPaymentConfirmationEmail(buildSupabase() as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        amount: 0,
        currency: 'GBP',
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).not.toContain('payment')
      expect(sent.text).toContain('is confirmed for 2 tickets')
      // Refund bands belong to a booking with money in it.
      expect(sent.text).not.toContain('we refund in full')
    })

    it('skips when a successful confirmation email already exists', async () => {
      const result = await sendEventPaymentConfirmationEmail(
        buildSupabase({ existingConfirmation: { id: 'email-message-1' } }) as any,
        { bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70', amount: 10, currency: 'GBP' }
      )

      expect(result).toEqual({ success: true, skipped: true })
      expect(sendEmail).not.toHaveBeenCalled()
      expect(createEventManageToken).not.toHaveBeenCalled()
    })

    it('skips when the customer does not have an email address', async () => {
      const result = await sendEventPaymentConfirmationEmail(
        buildSupabase({ customer: { email: null } }) as any,
        { bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70' }
      )

      expect(result).toEqual({ success: false, skipped: true })
      expect(sendEmail).not.toHaveBeenCalled()
    })

    it('lists per-type tickets without a stray dash', async () => {
      process.env.EVENT_TICKET_TYPES_ENABLED = 'true'
      loadBookingItemsWithTypesMock.mockResolvedValue(new Map([
        ['3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70', [
          {
            ticket_type_name: 'Standing',
            ticket_type_sort_order: 1,
            quantity: 2,
            unit_price: 5,
            attendee_names: ['Pat', 'Sam'],
          },
        ]],
      ]))
      bookingItemsAreMultiTypeMock.mockReturnValue(true)

      await sendEventPaymentConfirmationEmail(buildSupabase() as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        amount: 10,
        currency: 'GBP',
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain('2 x Standing at £5.00 each')
    })
  })

  it('sends a manual-review email when payment needs staff action, and says nothing about a zero payment', async () => {
    const result = await sendEventPaymentManualReviewEmail(buildSupabase() as any, {
      bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
      amount: 0,
      currency: 'GBP',
    })

    expect(result).toEqual({ success: true, messageId: 'email-1' })
    const sent = lastSend()
    assertCleanRender(sent)
    expect(sent.commType ?? (sendEmail as unknown as vi.Mock).mock.calls[0][0].commType).toBe('event_payment_manual_review')
    expect(sent.text).toContain('Staff need to check your booking')
    expect(sent.text).not.toContain('We have received your')
  })

  it('sends an expired hold email with a rebook link', async () => {
    const result = await sendEventPaymentExpiredEmail(buildSupabase() as any, {
      bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
    })

    expect(result).toEqual({ success: true, messageId: 'email-1' })
    const sent = lastSend()
    assertCleanRender(sent)
    expect(sent.text).toContain('Rebook here: https://www.the-anchor.pub/events/quiz-night')
  })

  describe('cancellations', () => {
    it('sends a cancellation email with refund details', async () => {
      const result = await sendEventBookingCancelledEmail(buildSupabase() as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        refundStatus: 'succeeded',
        refundAmount: 5,
        currency: 'GBP',
        reason: 'staff_cancel',
        paymentTaken: true,
      })

      expect(result).toEqual({ success: true, messageId: 'email-1' })
      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain('A refund of £5.00 has been issued')
      expect(sent.metadata).toMatchObject({ refund_status: 'succeeded', refund_amount: 5 })
    })

    it('says nothing about a refund when the guest never paid', async () => {
      await sendEventBookingCancelledEmail(buildSupabase() as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        refundStatus: null,
        refundAmount: null,
        currency: 'GBP',
        reason: 'staff_cancel',
        paymentTaken: false,
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).not.toContain('refund')
      expect(sent.text).not.toContain('Refund')
    })

    it('reaches the no-refund-due branch when money was taken and none is going back', async () => {
      await sendEventBookingCancelledEmail(buildSupabase({ event: TASTING_EVENT }) as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        refundStatus: null,
        refundAmount: null,
        currency: 'GBP',
        reason: 'staff_cancel',
        paymentTaken: true,
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain('No refund is due under the event cancellation policy.')
    })

    it('leads with the cancelled night, and apologises once, when the pub cancels', async () => {
      await sendEventBookingCancelledEmail(buildSupabase() as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        refundStatus: null,
        refundAmount: null,
        currency: 'GBP',
        reason: 'event_cancelled',
        paymentTaken: false,
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.subject).toBe(`Event cancelled: Quiz Night, ${expectedLongDate('2026-09-16').split(' ').slice(0, 3).join(' ')}`)
      expect(sent.text).toContain(`We've had to cancel Quiz Night on ${QUIZ_WHEN}, and we are sorry for the disappointment.`)
      expect(sent.text).not.toContain('has been cancelled (2 tickets)')
      expect(sent.text.match(/sorry/g)?.length ?? 0).toBe(1)
    })

    it('promises a cancelled night back in full when money was taken', async () => {
      await sendEventBookingCancelledEmail(buildSupabase({ event: TASTING_EVENT }) as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        refundStatus: null,
        refundAmount: null,
        currency: 'GBP',
        reason: 'event_cancelled',
        paymentTaken: true,
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain('A night we cancel is refunded in full')
    })
  })

  it('does not tell a guest we hit a snag with their refund', async () => {
    await sendEventRefundStatusUpdateEmail(buildSupabase({ event: TASTING_EVENT }) as any, {
      bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
      outcome: 'failed',
      amount: 45,
      currency: 'GBP',
    })

    const sent = lastSend()
    assertCleanRender(sent)
    expect(sent.text).toContain('Something went wrong when we tried to process your refund of £45.00')
    expect(sent.text).not.toContain('snag')
  })

  describe('ticket transfers', () => {
    it('names the date of each night, so two quiz nights are told apart', async () => {
      const result = await sendEventTicketTransferredEmail(
        buildSupabase({ event: { ...QUIZ_EVENT, start_datetime: '2026-09-23T18:00:00.000Z', date: '2026-09-23' } }) as any,
        {
          bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
          fromEventName: 'Quiz Night',
          toEventName: 'Quiz Night',
          fromEventStartIso: '2026-09-16T18:00:00.000Z',
          eventStartIso: '2026-09-23T18:00:00.000Z',
          appBaseUrl: 'https://management.orangejelly.co.uk',
        }
      )

      expect(result).toEqual({ success: true, messageId: 'email-1' })
      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain(
        `Your tickets have been moved from Quiz Night on ${QUIZ_WHEN} to Quiz Night on ${expectedLongDate('2026-09-23')} at 7pm.`
      )
      expect(sent.text).not.toContain('from Quiz Night to Quiz Night')
      expect(sent.metadata).toMatchObject({ from_event_start: '2026-09-16T18:00:00.000Z' })
    })

    it('speaks of one ticket in the singular, and owes an overpayment without a stray dash', async () => {
      await sendEventTicketTransferredEmail(
        buildSupabase({ booking: { seats: 1 } }) as any,
        {
          bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
          fromEventName: 'Tinsel and Tipples Christmas Tasting Night',
          toEventName: 'Quiz Night',
          fromEventStartIso: '2026-11-20T19:00:00.000Z',
          overpayment: 42,
        }
      )

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.subject).toContain('Ticket transferred: Quiz Night')
      expect(sent.text).toContain('Your ticket has been moved from')
      expect(sent.text).toContain('we owe you £42.00 and will be in touch about your refund')
    })
  })

  describe('rescheduling', () => {
    it('announces a British Summer Time evening at the time the London clock shows', async () => {
      const result = await sendEventRescheduledEmail(buildSupabase() as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        eventName: 'Quiz Night',
        oldDate: '2026-09-16',
        oldTime: '19:00',
        newDate: '2026-09-23',
        newTime: '19:00',
        appBaseUrl: 'https://management.orangejelly.co.uk',
      })

      expect(result).toEqual({ success: true, messageId: 'email-1' })
      const sent = lastSend()
      assertCleanRender(sent)
      assertHouseShell(sent.html)
      expect(sent.subject).toBe(`Event rescheduled: Quiz Night, now ${expectedLongDate('2026-09-23').split(' ').slice(0, 3).join(' ')}`)
      expect(sent.text).toContain(
        `Quiz Night has moved from ${QUIZ_WHEN} to ${expectedLongDate('2026-09-23')} at 7pm.`
      )
      // The defect this replaces: a UTC server read 19:00 as UTC and announced 8pm.
      expect(sent.text).not.toContain('at 8pm')
      expect(sent.metadata).toMatchObject({ old_date: '2026-09-16', new_date: '2026-09-23' })
    })

    it('announces a GMT evening at the time the London clock shows', async () => {
      await sendEventRescheduledEmail(buildSupabase({ event: TASTING_EVENT }) as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        eventName: 'Tinsel and Tipples Christmas Tasting Night',
        oldDate: '2026-11-20',
        oldTime: '19:00',
        newDate: '2026-11-27',
        newTime: '19:00',
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain(`to ${expectedLongDate('2026-11-27')} at 7pm.`)
    })

    it('handles a move to a time just after midnight', async () => {
      await sendEventRescheduledEmail(buildSupabase({ event: AFTER_MIDNIGHT_EVENT }) as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        eventName: 'Halloween Party',
        oldDate: '2026-10-31',
        oldTime: '20:00',
        newDate: '2026-11-01',
        newTime: '00:15',
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain(`to ${expectedLongDate('2026-11-01')} at 12:15am.`)
    })

    it('says what changed when only the start time moves', async () => {
      await sendEventRescheduledEmail(buildSupabase() as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        eventName: 'Quiz Night',
        oldDate: '2026-09-16',
        oldTime: '19:00',
        newDate: '2026-09-16',
        newTime: '20:00',
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain('still runs on the same day, but the start has moved from')
      expect(sent.text).toContain(`to ${expectedLongDate('2026-09-16')} at 8pm.`)
      // Nothing was paid for a cash-only night, so nothing "remains valid".
      expect(sent.text).not.toContain('remain valid')
      expect(sent.text).toContain('Your booking moves to the new date, so there is nothing you need to do.')
    })

    it('tells a paid booking its tickets remain valid, and an unpaid one that they are still held', async () => {
      await sendEventRescheduledEmail(buildSupabase({ event: TASTING_EVENT }) as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        eventName: 'Tinsel and Tipples Christmas Tasting Night',
        newDate: '2026-11-27',
        newTime: '19:00',
      })
      expect(lastSend().text).toContain('Your tickets remain valid for the new date.')

      await sendEventRescheduledEmail(
        buildSupabase({ event: TASTING_EVENT, booking: { status: 'pending_payment' } }) as any,
        {
          bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
          eventName: 'Tinsel and Tipples Christmas Tasting Night',
          newDate: '2026-11-27',
          newTime: '19:00',
        }
      )
      expect(lastSend().text).toContain('We are still holding your tickets, and they carry over to the new date.')
    })

    it('sends a guest who cannot make the new date to the phone, not to a page that cannot cancel', async () => {
      await sendEventRescheduledEmail(buildSupabase() as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        eventName: 'Quiz Night',
        newDate: '2026-09-23',
        newTime: '19:00',
      })

      const sent = lastSend()
      expect(sent.text).toContain('If the new date does not work for you, call 01753 682707 and we will cancel your booking.')
      expect(sent.text).not.toContain('manage-booking link')
    })
  })

  describe('postponed events', () => {
    it('names the date it was going to be, and offers no refund on a free night', async () => {
      const result = await sendEventPostponedEmail(buildSupabase({ event: KARAOKE_EVENT }) as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
        eventName: 'Karaoke Night',
      })

      expect(result).toEqual({ success: true, messageId: 'email-1' })
      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain(`Karaoke Night on ${expectedLongDate('2026-09-18')} at 8pm has been postponed.`)
      expect(sent.text).not.toContain('refund')
      expect(sent.text).toContain('your place carries over to it')
    })

    it('offers a paid guest the refund option', async () => {
      await sendEventPostponedEmail(buildSupabase({ event: TASTING_EVENT }) as any, {
        bookingId: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
      })

      const sent = lastSend()
      assertCleanRender(sent)
      expect(sent.text).toContain('or refund you')
    })
  })
})
