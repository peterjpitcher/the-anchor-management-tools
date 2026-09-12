import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({
  db: null as any,
  flagOn: true,
  /** Answers for the next reads of the email-first flag, before falling back to flagOn. */
  flagAnswers: [] as boolean[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => state.db),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) => {
    if (key !== 'private_booking_email_first') return false
    return state.flagAnswers.length > 0 ? (state.flagAnswers.shift() as boolean) : state.flagOn
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(async () => undefined),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))

vi.mock('@/services/private-bookings/financial', () => ({
  getPrivateBookingCancellationOutcome: vi.fn(),
}))

vi.mock('@/services/private-bookings/conflicts', () => ({
  getBookingConflictSummary: vi.fn(async () => []),
  getBookingSpaceIds: vi.fn(async () => []),
  findBookingConflicts: vi.fn(async () => []),
  checkCapacity: vi.fn(() => ({ ok: true })),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/services/sms-queue', async () => {
  const actual = await vi.importActual<typeof import('@/services/sms-queue')>('@/services/sms-queue')
  return {
    shouldAutoSendPrivateBookingSms: actual.shouldAutoSendPrivateBookingSms,
    SmsQueueService: { queueAndSend: vi.fn() },
  }
})

vi.mock('@/lib/email/private-booking-emails', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email/private-booking-emails')>('@/lib/email/private-booking-emails')
  return {
    ...actual,
    // The emails that have always gone alongside the texts, so the tests can see whether they still do.
    sendBookingCancelledEmail: vi.fn(async () => undefined),
    sendDepositReceivedEmail: vi.fn(async () => undefined),
    sendBookingConfirmationEmail: vi.fn(async () => undefined),
    sendBookingCalendarInvite: vi.fn(async () => undefined),
    sendBalancePaidEmail: vi.fn(async () => undefined),
  }
})

import { sendEmail } from '@/lib/email/emailService'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { SmsQueueService } from '@/services/sms-queue'
import {
  sendBookingCalendarInvite,
  sendBookingCancelledEmail,
  sendBookingConfirmationEmail,
  sendDepositReceivedEmail,
} from '@/lib/email/private-booking-emails'
import { toLocalIsoDate } from '@/lib/dateUtils'
import { getPrivateBookingCancellationOutcome } from '@/services/private-bookings/financial'
import { PrivateBookingService } from '@/services/private-bookings'
import { finalizeDepositPayment, updateDepositAmount } from '@/services/private-bookings/payments'

const mockedSendEmail = sendEmail as unknown as Mock
const mockedQueueAndSend = SmsQueueService.queueAndSend as unknown as Mock

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'confirmed',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_last_name: 'Smith',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900123',
    contact_email: 'host@example.com',
    event_type: 'Birthday party',
    event_date: '2026-10-03',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    hold_expiry: '2026-09-25T22:30:00.000Z',
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    balance_due_date: '2026-09-19',
    total_amount: 1200,
    calendar_event_id: null,
    contract_sent_at: null,
    layout: null,
    risk_status: 'normal',
    ...overrides,
  }
}

function seed(booking: Record<string, unknown>) {
  state.db = createFakeSupabase({
    private_bookings: [booking],
    private_bookings_with_details: [{ id: 'booking-1', gross_total: 1440, calculated_total: 1200 }],
    customers: [{ id: 'customer-1', email: 'alex@example.com', email_status: null, email_deactivated_at: null }],
    email_suppressions: [],
    private_booking_sms_queue: [],
    notification_deliveries: [],
    notification_attempts: [],
    private_booking_audit: [],
  })
}

function emailFirstFlagReads(): number {
  return vi.mocked(isMessagingFlagOn).mock.calls.filter(([key]) => key === 'private_booking_email_first').length
}

describe('private booking call sites, email first', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flagOn = true
    state.flagAnswers = []
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
    mockedQueueAndSend.mockResolvedValue({ success: true, sent: true, queueId: 'queue-1' })
    ;(getPrivateBookingCancellationOutcome as unknown as Mock).mockResolvedValue({
      outcome: 'refundable',
      refund_amount: 450,
      retained_amount: 0,
      deposit_deduction: 0,
      max_retainable: 0,
    })
  })

  it('cancelBooking: one variant email replaces both the text and the old cancellation email', async () => {
    seed(bookingRow())

    await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1')

    expect(mockedQueueAndSend).not.toHaveBeenCalled()
    expect(sendBookingCancelledEmail).not.toHaveBeenCalled()
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.commType).toBe('private_booking_cancelled_refundable')
    expect(email.text).toContain("We'll refund £450 within 10 working days")
    expect(email.text).toContain('Saturday, 3 October 2026')
  })

  it('cancelBooking with the flag off: the text and the old email, exactly as today', async () => {
    state.flagOn = false
    seed(bookingRow())

    await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1')

    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    expect(sendBookingCancelledEmail).toHaveBeenCalledTimes(1)
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('cancelBooking: when the email fails the text goes, and the old email does not', async () => {
    seed(bookingRow())
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })

    await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1')

    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    expect(sendBookingCancelledEmail).not.toHaveBeenCalled()
  })

  it('deposit received: one email carries the deposit and the confirmation, no text', async () => {
    seed(bookingRow({ status: 'draft' }))

    await finalizeDepositPayment({ bookingId: 'booking-1', amount: 250, method: 'card', performedByUserId: 'user-1' }, state.db)

    expect(sendDepositReceivedEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.commType).toBe('private_booking_deposit_received')
    expect(email.text).toContain('Deposit paid: £250')
    expect(email.text).toContain('Total event cost: £1,440')

    // The delivery states the deposit as recorded, so a bounce after staff delete it is a changed booking.
    const paidAt = state.db.tables.private_bookings[0].deposit_paid_date
    expect(paidAt).toBeTruthy()
    expect(state.db.tables.notification_deliveries[0].metadata.booking_facts).toEqual({
      event_date: '2026-10-03',
      deposit_paid_date: toLocalIsoDate(new Date(paidAt)),
    })
  })

  it('a waived deposit: the confirmation says confirmed, not provisional, and the calendar invite still goes', async () => {
    seed(bookingRow({ status: 'draft', deposit_amount: 250 }))

    await updateDepositAmount('booking-1', 0, 'user-1', { waived: true, waivedReason: 'Regular customer' })

    expect(sendBookingConfirmationEmail).not.toHaveBeenCalled()
    expect(sendBookingCalendarInvite).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.commType).toBe('private_booking_confirmed')
    expect(email.subject).toContain('Booking confirmed')
    expect(email.text).toContain('There is no deposit to pay for this booking.')
    expect(email.text).not.toMatch(/provisional/i)
  })
})

describe('each action reads the email-first flag once', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flagOn = true
    // The first read fails, which answers off and is not cached; a second read would say on.
    state.flagAnswers = [false, true]
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
    mockedQueueAndSend.mockResolvedValue({ success: true, sent: true, queueId: 'queue-1' })
    ;(getPrivateBookingCancellationOutcome as unknown as Mock).mockResolvedValue({
      outcome: 'refundable',
      refund_amount: 450,
      retained_amount: 0,
      deposit_deduction: 0,
      max_retainable: 0,
    })
  })

  it('cancelBooking: the guest gets today\'s text and email, never the new email as well as the old one', async () => {
    seed(bookingRow())

    await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1')

    expect(emailFirstFlagReads()).toBe(1)
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(sendBookingCancelledEmail).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
  })

  it('deposit received: today\'s text and deposit email, never the new email as well', async () => {
    seed(bookingRow({ status: 'draft' }))

    await finalizeDepositPayment({ bookingId: 'booking-1', amount: 250, method: 'card', performedByUserId: 'user-1' }, state.db)

    expect(emailFirstFlagReads()).toBe(1)
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(sendDepositReceivedEmail).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
  })

  it('a waived deposit: today\'s confirmation email and text, never the new email as well', async () => {
    seed(bookingRow({ status: 'draft', deposit_amount: 250 }))

    await updateDepositAmount('booking-1', 0, 'user-1', { waived: true, waivedReason: 'Regular customer' })

    expect(emailFirstFlagReads()).toBe(1)
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(sendBookingConfirmationEmail).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
  })

  it('cancelBooking with a steady flag still reads it once and sends the one variant email', async () => {
    state.flagAnswers = []
    seed(bookingRow())

    await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1')

    expect(emailFirstFlagReads()).toBe(1)
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect(sendBookingCancelledEmail).not.toHaveBeenCalled()
  })
})
