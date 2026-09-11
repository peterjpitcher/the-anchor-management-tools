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
import { tryEmailForApprovedPrivateBookingText } from '@/lib/private-bookings/approved-message'
import { runDelayedFallbackJob } from '@/lib/notifications/delayed-fallback/run'
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
