import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, flags: {} as Record<string, boolean> }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) => state.flags[key] === true),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(async () => undefined),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/customers', () => ({
  resolveCustomerIdForSms: vi.fn(async () => ({ customerId: 'customer-1' })),
}))

vi.mock('@/services/audit', () => ({
  AuditService: { logAuditEvent: vi.fn(async () => undefined) },
}))

import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'
import { reportCronFailure } from '@/lib/cron/alerting'
import { tryEmailForApprovedPrivateBookingText } from '@/lib/private-bookings/approved-message'
import { runDelayedFallbackJob } from '@/lib/notifications/delayed-fallback/run'
import { privateBookingMessageValidUntil, type CatalogueBooking } from '@/lib/private-bookings/message-catalogue'
import {
  balanceReminder21DayMessage,
  bookingCancelledRetentionMessage,
  depositReminder3DayMessage,
  depositReminder7DayMessage,
} from '@/lib/private-bookings/messages'

const mockedSendEmail = sendEmail as unknown as Mock
const mockedSendSMS = sendSMS as unknown as Mock

const NOW = new Date('2026-09-20T09:00:00.000Z')

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'draft',
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
    final_payment_date: null,
    setup_date: null,
    setup_time: null,
    ...overrides,
  }
}

function seed(booking: Record<string, unknown> = bookingRow(), extra: Record<string, any[]> = {}) {
  state.db = createFakeSupabase({
    private_bookings: [booking],
    private_bookings_with_details: [{ id: 'booking-1', balance_remaining: 1234.5, gross_total: 1484.5, calculated_total: 1484.5, total_amount: 1484.5 }],
    customers: [{ id: 'customer-1', email: 'alex@example.com', email_status: null, email_deactivated_at: null, mobile_number: '+447700900123' }],
    email_suppressions: [],
    notification_deliveries: [],
    notification_attempts: [],
    private_booking_audit: [],
    ...extra,
  })
}

const QUEUED_3DAY = depositReminder3DayMessage({
  customerFirstName: 'Alex',
  eventDate: '3 October 2026',
  depositAmount: 250,
  holdExpiry: '25 September 2026',
})

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sms-1',
    booking_id: 'booking-1',
    trigger_type: 'deposit_reminder_3day',
    template_key: 'private_booking_deposit_reminder_3day',
    message_body: QUEUED_3DAY,
    metadata: { hold_expiry_date: '2026-09-25' },
    ...overrides,
  }
}

describe('Send Now: tryEmailForApprovedPrivateBookingText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flags = { private_booking_email_first: true }
    seed()
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
  })

  it('emails an approved deposit reminder when the rebuilt text is exactly the approved one', async () => {
    const outcome = await tryEmailForApprovedPrivateBookingText({ row: queueRow(), performedBy: 'user-1', now: NOW })

    expect(outcome).toMatchObject({ status: 'sent' })
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'host@example.com',
        commType: 'private_booking_deposit_reminder_3day',
        idempotencyKey: 'pb:booking-1:deposit_reminder_3day:queue-sms-1',
      })
    )
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.text).toContain('25 September 2026')
    expect(email.text).toContain('£250')
    expect(email.text).toContain('Saturday, 3 October 2026')
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({ action: 'email_sent', performed_by: 'user-1' })
  })

  it('sends the approved text instead when the booking has changed since it was queued', async () => {
    seed(bookingRow({ deposit_amount: 200 }))
    const outcome = await tryEmailForApprovedPrivateBookingText({ row: queueRow(), performedBy: 'user-1', now: NOW })
    expect(outcome).toEqual({ status: 'not_attempted', reason: 'queued_text_differs' })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('emails an approved balance reminder with the amount still owed', async () => {
    seed(bookingRow({ status: 'confirmed' }))
    const body = balanceReminder21DayMessage({
      customerFirstName: 'Alex',
      eventDate: '3 October 2026',
      balanceAmount: 1234.5,
      balanceDueDate: '19 September 2026',
    })
    const outcome = await tryEmailForApprovedPrivateBookingText({
      row: queueRow({ trigger_type: 'balance_reminder_21day', template_key: 'private_booking_balance_reminder_21day', message_body: body }),
      performedBy: 'user-1',
      now: NOW,
    })
    expect(outcome).toMatchObject({ status: 'sent' })
    expect(mockedSendEmail.mock.calls[0][0].text).toContain('£1234.50')
  })

  it('emails an approved retention cancellation with the amounts the queued text states', async () => {
    seed(bookingRow({ status: 'cancelled' }))
    const body = bookingCancelledRetentionMessage({
      customerFirstName: 'Alex',
      eventDate: '3 October 2026',
      retainedAmount: 150,
      refundAmount: 100,
    })
    const outcome = await tryEmailForApprovedPrivateBookingText({
      row: queueRow({
        trigger_type: 'booking_cancelled_retention',
        template_key: 'private_booking_cancelled_retention',
        message_body: body,
        metadata: { financial_outcome: 'gm_review_required', refund_amount: 100, retained_amount: 150 },
      }),
      performedBy: 'user-1',
      now: NOW,
    })
    expect(outcome).toMatchObject({ status: 'sent' })
    const text = mockedSendEmail.mock.calls[0][0].text
    expect(text).toContain('£150 of your deposit has been retained')
    expect(text).toContain('£100 will be refunded within 10 working days')
  })

  it('sends the approved text when there is no usable address', async () => {
    seed(bookingRow({ contact_email: null }), {
      customers: [{ id: 'customer-1', email: null, email_status: null, email_deactivated_at: null }],
    })
    const outcome = await tryEmailForApprovedPrivateBookingText({ row: queueRow(), performedBy: 'user-1', now: NOW })
    expect(outcome).toMatchObject({ status: 'not_attempted', reason: 'no_address' })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('does nothing while the flag is off', async () => {
    state.flags = {}
    const outcome = await tryEmailForApprovedPrivateBookingText({ row: queueRow(), performedBy: 'user-1', now: NOW })
    expect(outcome).toEqual({ status: 'not_attempted', reason: 'flag_off' })
  })
})

describe('bounce fallback for a private booking email (P4 with P6)', () => {
  function delivery(overrides: Record<string, unknown> = {}) {
    return {
      id: 'delivery-1',
      customer_id: 'customer-1',
      template_key: 'private_booking_deposit_reminder_7day',
      category: 'transactional',
      policy: 'email_first',
      selected_channel: 'email',
      final_status: 'sent',
      delayed_fallback_allowed: true,
      delayed_fallback_sent_at: null,
      metadata: {
        private_booking_id: 'booking-1',
        trigger_type: 'deposit_reminder_7day',
        booking_facts: { event_date: '2026-10-03', hold_expiry_date: '2026-09-25', deposit_amount: 250 },
      },
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    state.flags = { bounce_sms_fallback: true, private_booking_email_first: true }
    mockedSendSMS.mockResolvedValue({ success: true, sid: 'SM-9' })
  })

  it('texts the reminder the email carried, rebuilt from the booking as it is now', async () => {
    seed(bookingRow(), { notification_deliveries: [delivery()] })

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'sent' })
    const expected = depositReminder7DayMessage({
      customerFirstName: 'Alex',
      eventDate: '3 October 2026',
      depositAmount: 250,
      // 25 Sept 22:30 UTC is 5.56 days after 20 Sept 09:00 UTC, which the reminder rounds up.
      daysRemaining: 6,
      holdExpiry: '25 September 2026',
    })
    expect(mockedSendSMS).toHaveBeenCalledWith('+447700900123', expected, expect.objectContaining({ customerId: 'customer-1' }))
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({ action: 'sms_sent', booking_id: 'booking-1' })
  })

  it('sends nothing once the booking is cancelled', async () => {
    seed(bookingRow({ status: 'cancelled' }), { notification_deliveries: [delivery()] })
    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })
    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'booking_cancelled' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('sends nothing when the deposit or deadline changed since the email', async () => {
    seed(bookingRow({ hold_expiry: '2026-10-01T22:30:00.000Z' }), { notification_deliveries: [delivery()] })
    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })
    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'booking_changed' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('texts a cancellation, which is meant to find the booking cancelled, with the amounts the email stated', async () => {
    seed(bookingRow({ status: 'cancelled' }), {
      notification_deliveries: [
        delivery({
          template_key: 'private_booking_cancelled_refundable',
          metadata: {
            private_booking_id: 'booking-1',
            trigger_type: 'booking_cancelled_refundable',
            booking_facts: { event_date: '2026-10-03', refund_amount: 450, retained_amount: 0, deduction_amount: 0 },
          },
        }),
      ],
    })
    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })
    expect(outcome).toMatchObject({ outcome: 'sent' })
    expect(mockedSendSMS.mock.calls[0][1]).toContain('£450 within 10 working days')
  })

  it('a guest with no number: undelivered, with an audit row on the booking', async () => {
    seed(bookingRow({ contact_phone: null }), {
      notification_deliveries: [delivery()],
      customers: [{ id: 'customer-1', email: 'alex@example.com', email_status: null, email_deactivated_at: null, mobile_number: null }],
    })
    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })
    expect(outcome).toMatchObject({ outcome: 'failed', reason: 'no_sms_channel' })
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({ action: 'message_undelivered' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })
})

/** A private booking email-first delivery row as the messenger writes it. */
function fallbackDelivery(triggerType: string, templateKey: string, facts: Record<string, unknown>) {
  return {
    id: 'delivery-1',
    customer_id: 'customer-1',
    template_key: templateKey,
    category: 'transactional',
    policy: 'email_first',
    selected_channel: 'email',
    final_status: 'sent',
    delayed_fallback_allowed: true,
    delayed_fallback_sent_at: null,
    metadata: { private_booking_id: 'booking-1', trigger_type: triggerType, booking_facts: facts },
  }
}

/** Runs the job at `firstRun`; if it waits for quiet hours to end, runs it again when it asked to. */
async function runAsTheQueueWould(firstRun: Date) {
  const first = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => firstRun })
  if (first.outcome !== 'deferred') return { first, final: first }
  const runAt = new Date(first.runAt)
  const final = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => runAt })
  return { first, final }
}

describe('bounce fallback: a text is never sent after its words stop being true', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flags = { bounce_sms_fallback: true, private_booking_email_first: true }
    mockedSendSMS.mockResolvedValue({ success: true, sid: 'SM-9' })
  })

  it('"tomorrow\'s the day" bouncing at 22:30 is not texted at 09:00 on the day itself', async () => {
    seed(bookingRow({ status: 'confirmed', event_date: '2026-09-21', hold_expiry: null, deposit_paid_date: '2026-09-01T10:00:00+00:00' }), {
      notification_deliveries: [
        fallbackDelivery('event_reminder_1d', 'private_booking_event_reminder_1d', { event_date: '2026-09-21', guest_count: 40 }),
      ],
    })

    // 22:30 BST on Sunday 20 September, the evening before the event.
    const { first, final } = await runAsTheQueueWould(new Date('2026-09-20T21:30:00.000Z'))

    expect(first).toMatchObject({ outcome: 'deferred', runAt: '2026-09-21T08:00:00.000Z' })
    expect(final).toMatchObject({ outcome: 'skipped', reason: 'too_late' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(reportCronFailure).not.toHaveBeenCalled()
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({
      action: 'email_bounced',
      metadata: expect.objectContaining({
        description: 'The email bounced. No text was sent because it would arrive too late for what it says to still be true.',
      }),
    })
  })

  it('the same reminder bouncing in the afternoon before is texted straight away', async () => {
    seed(bookingRow({ status: 'confirmed', event_date: '2026-09-21', hold_expiry: null, deposit_paid_date: '2026-09-01T10:00:00+00:00' }), {
      notification_deliveries: [
        fallbackDelivery('event_reminder_1d', 'private_booking_event_reminder_1d', { event_date: '2026-09-21', guest_count: 40 }),
      ],
    })

    const { final } = await runAsTheQueueWould(new Date('2026-09-20T13:00:00.000Z'))

    expect(final).toMatchObject({ outcome: 'sent' })
    expect(mockedSendSMS.mock.calls[0][1]).toContain("tomorrow's the day")
  })

  it('a 1-day hold reminder whose hold the 06:00 cron cancelled overnight is not texted at 09:00', async () => {
    seed(bookingRow({ status: 'cancelled', hold_expiry: '2026-09-21T05:30:00.000Z' }), {
      notification_deliveries: [
        fallbackDelivery('deposit_reminder_1day', 'private_booking_deposit_reminder_1day', {
          event_date: '2026-10-03',
          hold_expiry_date: '2026-09-21',
          deposit_amount: 250,
        }),
      ],
    })

    const { first, final } = await runAsTheQueueWould(new Date('2026-09-20T21:15:00.000Z'))

    expect(first.outcome).toBe('deferred')
    expect(final).toMatchObject({ outcome: 'skipped', reason: 'booking_cancelled' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('a 1-day hold reminder whose hold ran out before 09:00 is too late even before the cron cancels it', async () => {
    seed(bookingRow({ status: 'draft', hold_expiry: '2026-09-21T07:30:00.000Z' }), {
      notification_deliveries: [
        fallbackDelivery('deposit_reminder_1day', 'private_booking_deposit_reminder_1day', {
          event_date: '2026-10-03',
          hold_expiry_date: '2026-09-21',
          deposit_amount: 250,
        }),
      ],
    })

    const { final } = await runAsTheQueueWould(new Date('2026-09-20T21:15:00.000Z'))

    expect(final).toMatchObject({ outcome: 'skipped', reason: 'too_late' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('a "due today" balance reminder bouncing after midnight never chases the balance once it is overdue', async () => {
    seed(bookingRow({ status: 'confirmed', hold_expiry: null, deposit_paid_date: '2026-09-01T10:00:00+00:00' }), {
      notification_deliveries: [
        fallbackDelivery('balance_reminder_due', 'private_booking_balance_reminder_due', {
          event_date: '2026-10-03',
          balance_due_date: '2026-09-19',
          balance_amount: 1234.5,
        }),
      ],
    })

    // 00:30 BST on Sunday 20 September, the night after the balance fell due.
    const { first, final } = await runAsTheQueueWould(new Date('2026-09-19T23:30:00.000Z'))

    expect(first).toMatchObject({ outcome: 'deferred', runAt: '2026-09-20T08:00:00.000Z' })
    expect(final).toMatchObject({ outcome: 'skipped', reason: 'too_late' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('a "deposit received" email is not replaced by a text once staff have deleted the deposit', async () => {
    // deleteDeposit clears deposit_paid_date and puts the booking back to draft.
    seed(bookingRow({ status: 'draft', hold_expiry: null, deposit_paid_date: null }), {
      notification_deliveries: [
        fallbackDelivery('deposit_received', 'private_booking_deposit_received', { event_date: '2026-10-03', deposit_paid_date: '2026-09-18' }),
      ],
    })

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'booking_changed' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('a "deposit received" email is texted while the deposit is still recorded', async () => {
    seed(bookingRow({ status: 'confirmed', hold_expiry: null, deposit_paid_date: '2026-09-18T15:00:00+00:00' }), {
      notification_deliveries: [
        fallbackDelivery('deposit_received', 'private_booking_deposit_received', { event_date: '2026-10-03', deposit_paid_date: '2026-09-18' }),
      ],
    })

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'sent' })
    expect(mockedSendSMS.mock.calls[0][1]).toContain('deposit received')
  })
})

describe('bounce fallback: a message that no longer applies is skipped, never failed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flags = { bounce_sms_fallback: true, private_booking_email_first: true }
    mockedSendSMS.mockResolvedValue({ success: true, sid: 'SM-9' })
  })

  const HOLD_FACTS = { event_date: '2026-10-03', hold_expiry_date: '2026-09-25', deposit_amount: 250 }

  it.each([
    ['the deposit has been paid (the payment clears the hold)', { status: 'confirmed', hold_expiry: null, deposit_paid_date: '2026-09-20T08:00:00+00:00' }],
    ['the deposit has been paid, the hold not yet cleared', { deposit_paid_date: '2026-09-20T08:00:00+00:00' }],
    ['the deposit has been waived', { deposit_waived: true, deposit_amount: 0 }],
  ])('a hold reminder once %s', async (_label, change) => {
    seed(bookingRow(change), {
      notification_deliveries: [fallbackDelivery('deposit_reminder_7day', 'private_booking_deposit_reminder_7day', HOLD_FACTS)],
    })

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'no_longer_needed', deliveryId: 'delivery-1' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(reportCronFailure).not.toHaveBeenCalled()
    expect(state.db.tables.notification_deliveries[0].final_status).toBe('bounced')
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({
      action: 'email_bounced',
      metadata: expect.objectContaining({
        description: 'The email bounced. No text was sent because what it asked for has been done since, so it no longer applies.',
      }),
    })
  })

  it('a hold extension once the deposit has been paid', async () => {
    seed(bookingRow({ status: 'confirmed', hold_expiry: null, deposit_paid_date: '2026-09-20T08:00:00+00:00' }), {
      notification_deliveries: [
        fallbackDelivery('hold_extended', 'private_booking_hold_extended', { event_date: '2026-10-03', hold_expiry_date: '2026-09-25' }),
      ],
    })
    expect(await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })).toMatchObject({
      outcome: 'skipped',
      reason: 'no_longer_needed',
    })
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('a balance reminder once the balance has been paid', async () => {
    seed(bookingRow({ status: 'confirmed', hold_expiry: null, balance_due_date: '2026-09-25' }), {
      notification_deliveries: [
        fallbackDelivery('balance_reminder_21day', 'private_booking_balance_reminder_21day', {
          event_date: '2026-10-03',
          balance_due_date: '2026-09-25',
          balance_amount: 1234.5,
        }),
      ],
      private_bookings_with_details: [{ id: 'booking-1', balance_remaining: 0, gross_total: 1484.5, calculated_total: 1484.5, total_amount: 1484.5 }],
    })

    expect(await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })).toMatchObject({
      outcome: 'skipped',
      reason: 'no_longer_needed',
    })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('a balance that cannot be read is not treated as paid', async () => {
    seed(bookingRow({ status: 'confirmed', hold_expiry: null, balance_due_date: '2026-09-25' }), {
      notification_deliveries: [
        fallbackDelivery('balance_reminder_21day', 'private_booking_balance_reminder_21day', {
          event_date: '2026-10-03',
          balance_due_date: '2026-09-25',
          balance_amount: 1234.5,
        }),
      ],
      private_bookings_with_details: [],
    })

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })
    expect(outcome.outcome).toBe('failed')
  })
})

describe('bounce fallback: a text that needs staff approval is never sent without it', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flags = { bounce_sms_fallback: true, private_booking_email_first: true }
    mockedSendSMS.mockResolvedValue({ success: true, sid: 'SM-9' })
  })

  const GATED: Array<[string, string, Record<string, unknown>, Record<string, unknown>]> = [
    [
      'deposit_reminder_3day',
      'private_booking_deposit_reminder_3day',
      { hold_expiry: '2026-09-22T22:30:00.000Z' },
      { event_date: '2026-10-03', hold_expiry_date: '2026-09-22', deposit_amount: 250 },
    ],
    [
      'balance_reminder_21day',
      'private_booking_balance_reminder_21day',
      { status: 'confirmed', hold_expiry: null, balance_due_date: '2026-09-25' },
      { event_date: '2026-10-03', balance_due_date: '2026-09-25', balance_amount: 1234.5 },
    ],
    [
      'balance_reminder_16day',
      'private_booking_balance_reminder_16day',
      { status: 'confirmed', hold_expiry: null, balance_due_date: '2026-09-22' },
      { event_date: '2026-10-03', balance_due_date: '2026-09-22', balance_amount: 1234.5 },
    ],
    [
      'balance_reminder_15day',
      'private_booking_balance_reminder_15day',
      { status: 'confirmed', hold_expiry: null, balance_due_date: '2026-09-21' },
      { event_date: '2026-10-03', balance_due_date: '2026-09-21', balance_amount: 1234.5 },
    ],
    [
      'balance_reminder_due',
      'private_booking_balance_reminder_due',
      { status: 'confirmed', hold_expiry: null, balance_due_date: '2026-09-20' },
      { event_date: '2026-10-03', balance_due_date: '2026-09-20', balance_amount: 1234.5 },
    ],
    [
      'booking_cancelled_partial_refund',
      'private_booking_cancelled_partial_refund',
      { status: 'cancelled' },
      { event_date: '2026-10-03', refund_amount: 200, retained_amount: 50, deduction_amount: 50 },
    ],
    [
      'booking_cancelled_retention',
      'private_booking_cancelled_retention',
      { status: 'cancelled' },
      { event_date: '2026-10-03', refund_amount: 100, retained_amount: 150, deduction_amount: 0 },
    ],
    [
      'booking_cancelled_review_pending',
      'private_booking_cancelled_review_pending',
      { status: 'cancelled' },
      { event_date: '2026-10-03', refund_amount: 0, retained_amount: 0, deduction_amount: 0 },
    ],
  ]

  it.each(GATED)('%s: no text; listed under Undelivered guest messages and staff are told', async (triggerType, templateKey, change, facts) => {
    seed(bookingRow(change), { notification_deliveries: [fallbackDelivery(triggerType, templateKey, facts)] })

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })

    expect(outcome).toEqual({ outcome: 'failed', reason: 'needs_approval', deliveryId: 'delivery-1' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(state.db.tables.notification_deliveries[0]).toMatchObject({
      final_status: 'failed',
      metadata: expect.objectContaining({ undelivered_reason: 'needs_approval' }),
    })
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({
      action: 'message_undelivered',
      metadata: expect.objectContaining({
        description:
          'The email bounced and the text fallback failed: this text needs staff approval before it can be sent, so staff should contact the guest.',
      }),
    })
    expect(reportCronFailure).toHaveBeenCalledWith(
      'notification-delayed-fallback',
      expect.any(Error),
      expect.objectContaining({ reason: 'needs_approval', booking_id: 'booking-1' })
    )

    const { loadUndeliveredGuestMessages } = await import('@/lib/notifications/undelivered')
    const listed = await loadUndeliveredGuestMessages({ sinceIso: '2000-01-01T00:00:00.000Z' })
    expect(listed.rows).toEqual([
      expect.objectContaining({
        id: 'delivery-1',
        reason: 'Email bounced; the text needs staff approval, so it was not sent',
        booking: { href: '/private-bookings/booking-1', label: 'Private booking' },
      }),
    ])
  })

  it('a retention cancellation, emailed at once by cancelBooking, is listed for staff when that email bounces', async () => {
    seed(bookingRow({ status: 'cancelled' }), {
      notification_deliveries: [
        {
          ...fallbackDelivery('booking_cancelled_retention', 'private_booking_cancelled_retention', {
            event_date: '2026-10-03',
            refund_amount: 100,
            retained_amount: 150,
            deduction_amount: 0,
          }),
          metadata: {
            source: 'private_booking_messenger',
            private_booking_id: 'booking-1',
            trigger_type: 'booking_cancelled_retention',
            window_key: 'cancelled',
            email_recipient_source: 'contact_email',
            booking_facts: { event_date: '2026-10-03', refund_amount: 100, retained_amount: 150, deduction_amount: 0 },
          },
        },
      ],
    })

    const { final } = await runAsTheQueueWould(new Date('2026-09-20T21:40:00.000Z'))

    expect(final).toMatchObject({ outcome: 'failed', reason: 'needs_approval' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('a gated message whose booking has since been cancelled is skipped, not listed', async () => {
    seed(bookingRow({ status: 'cancelled', hold_expiry: '2026-09-22T22:30:00.000Z' }), {
      notification_deliveries: [
        fallbackDelivery('deposit_reminder_3day', 'private_booking_deposit_reminder_3day', {
          event_date: '2026-10-03',
          hold_expiry_date: '2026-09-22',
          deposit_amount: 250,
        }),
      ],
    })

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'booking_cancelled' })
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('a gated reminder that would land too late is skipped, not listed', async () => {
    seed(bookingRow({ status: 'confirmed', hold_expiry: null, balance_due_date: '2026-09-19' }), {
      notification_deliveries: [
        fallbackDelivery('balance_reminder_15day', 'private_booking_balance_reminder_15day', {
          event_date: '2026-10-03',
          balance_due_date: '2026-09-19',
          balance_amount: 1234.5,
        }),
      ],
    })

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'too_late' })
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('texts that go straight out still fall back as before', async () => {
    seed(bookingRow({ hold_expiry: '2026-09-21T06:00:00.000Z' }), {
      notification_deliveries: [
        fallbackDelivery('deposit_reminder_1day', 'private_booking_deposit_reminder_1day', {
          event_date: '2026-10-03',
          hold_expiry_date: '2026-09-21',
          deposit_amount: 250,
        }),
      ],
    })

    expect(await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })).toMatchObject({ outcome: 'sent' })
  })
})

describe('privateBookingMessageValidUntil: taken from the words, right across both clock changes', () => {
  function context(overrides: Partial<CatalogueBooking> = {}, storedFacts: Record<string, unknown> | null = null) {
    return { booking: bookingRow(overrides) as CatalogueBooking, now: NOW, storedFacts }
  }

  it.each([
    // "Tomorrow's the day" ends when the event's London day begins.
    ['event_reminder_1d', { event_date: '2026-10-25' }, '2026-10-24T23:00:00.000Z'],
    ['event_reminder_1d', { event_date: '2026-10-26' }, '2026-10-26T00:00:00.000Z'],
    ['event_reminder_1d', { event_date: '2027-03-28' }, '2027-03-28T00:00:00.000Z'],
    ['event_reminder_1d', { event_date: '2027-03-29' }, '2027-03-28T23:00:00.000Z'],
    // Hold wording runs to the hold expiry itself.
    ['deposit_reminder_1day', { hold_expiry: '2026-10-25T01:30:00+00:00' }, '2026-10-25T01:30:00.000Z'],
    ['deposit_reminder_3day', { hold_expiry: '2027-03-28T22:59:59+00:00' }, '2027-03-28T22:59:59.000Z'],
    ['deposit_reminder_7day', { hold_expiry: '2026-09-25T22:30:00.000Z' }, '2026-09-25T22:30:00.000Z'],
    ['booking_created', { hold_expiry: '2026-09-25T22:30:00.000Z' }, '2026-09-25T22:30:00.000Z'],
    ['hold_extended', { hold_expiry: '2026-09-25T22:30:00.000Z' }, '2026-09-25T22:30:00.000Z'],
    // "Due by" and "due today" end with the due date; "due tomorrow" and "2 days to go" sooner.
    ['balance_reminder_21day', { balance_due_date: '2026-10-25' }, '2026-10-26T00:00:00.000Z'],
    ['balance_reminder_16day', { balance_due_date: '2026-10-26' }, '2026-10-24T23:00:00.000Z'],
    ['balance_reminder_15day', { balance_due_date: '2026-10-25' }, '2026-10-24T23:00:00.000Z'],
    ['balance_reminder_due', { balance_due_date: '2026-10-25' }, '2026-10-26T00:00:00.000Z'],
    ['balance_reminder_21day', { balance_due_date: '2027-03-28' }, '2027-03-28T23:00:00.000Z'],
    ['balance_reminder_15day', { balance_due_date: '2027-03-28' }, '2027-03-28T00:00:00.000Z'],
    ['balance_reminder_due', { balance_due_date: '2027-03-27' }, '2027-03-28T00:00:00.000Z'],
    ['balance_due_date_changed', { balance_due_date: '2026-09-19' }, '2026-09-19T23:00:00.000Z'],
  ] as Array<[string, Partial<CatalogueBooking>, string]>)('%s with %o: valid until %s', (triggerType, overrides, expected) => {
    expect(privateBookingMessageValidUntil(triggerType, context(overrides))).toBe(expected)
  })

  it('a date change names a deadline only when its text states the new due date', () => {
    expect(privateBookingMessageValidUntil('date_changed', context({ balance_due_date: '2026-09-19' }, { balance_due_date: '2026-09-19' }))).toBe(
      '2026-09-19T23:00:00.000Z'
    )
    expect(privateBookingMessageValidUntil('date_changed', context({ balance_due_date: '2026-09-19' }, { balance_due_date: null }))).toBeNull()
  })

  it.each(['deposit_received', 'booking_confirmed', 'final_payment_received', 'setup_reminder', 'booking_cancelled_refundable', 'review_request'])(
    '%s: words that hold until the event, so no deadline of their own',
    (triggerType) => {
      expect(privateBookingMessageValidUntil(triggerType, context())).toBeNull()
    }
  )

  it('no hold expiry, no hold deadline', () => {
    expect(privateBookingMessageValidUntil('booking_created', context({ hold_expiry: null }))).toBeNull()
  })
})
