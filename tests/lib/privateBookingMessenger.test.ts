import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, flagOn: true }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) => (key === 'private_booking_email_first' ? state.flagOn : false)),
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

vi.mock('@/services/sms-queue', async () => {
  const actual = await vi.importActual<typeof import('@/services/sms-queue')>('@/services/sms-queue')
  return {
    shouldAutoSendPrivateBookingSms: actual.shouldAutoSendPrivateBookingSms,
    SmsQueueService: { queueAndSend: vi.fn() },
  }
})

import { sendEmail } from '@/lib/email/emailService'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { reportCronFailure } from '@/lib/cron/alerting'
import { SmsQueueService } from '@/services/sms-queue'
import { sendPrivateBookingMessage } from '@/lib/private-bookings/messenger'
import { loadUndeliveredGuestMessages } from '@/lib/notifications/undelivered'

const mockedSendEmail = sendEmail as unknown as Mock
const mockedQueueAndSend = SmsQueueService.queueAndSend as unknown as Mock

const BOOKING = { id: 'booking-1', customer_id: 'customer-1', contact_email: 'host@example.com' }

function sms(overrides: Record<string, unknown> = {}) {
  return {
    booking_id: 'booking-1',
    trigger_type: 'deposit_reminder_7day',
    template_key: 'private_booking_deposit_reminder_7day',
    message_body: 'Hi Alex, quick nudge. Your hold on 3 October 2026 expires in 5 days.',
    customer_phone: '+447700900123',
    customer_name: 'Alex Smith',
    customer_id: 'customer-1',
    priority: 2,
    metadata: { hold_expiry_date: '2026-09-25' },
    ...overrides,
  }
}

const emailContent = () => ({ subject: 'Deposit reminder', html: '<p>Deposit reminder</p>', text: 'Deposit reminder' })

function seed(options: { customerEmail?: string | null; emailStatus?: string | null; suppressed?: string[] } = {}) {
  state.db = createFakeSupabase({
    customers: [
      {
        id: 'customer-1',
        email: options.customerEmail === undefined ? 'alex@example.com' : options.customerEmail,
        email_status: options.emailStatus ?? null,
        email_deactivated_at: null,
      },
    ],
    email_suppressions: (options.suppressed ?? []).map((email) => ({ email })),
    notification_deliveries: [],
    notification_attempts: [],
    private_booking_audit: [],
  })
}

function send(overrides: Partial<Parameters<typeof sendPrivateBookingMessage>[0]> = {}) {
  return sendPrivateBookingMessage({
    sms: sms(),
    booking: BOOKING,
    email: emailContent,
    windowKey: '2026-09-25',
    facts: { event_date: '2026-10-03', hold_expiry_date: '2026-09-25', deposit_amount: 250 },
    ...overrides,
  })
}

describe('sendPrivateBookingMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flagOn = true
    seed()
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
    mockedQueueAndSend.mockResolvedValue({ success: true, sent: true, queueId: 'queue-1', sid: 'SM-1' })
  })

  it('flag off: exactly today, the text through the queue with the same input and result, no email', async () => {
    state.flagOn = false
    const input = sms()

    const result = await send({ sms: input })

    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend).toHaveBeenCalledWith(input)
    expect(result).toEqual({ success: true, sent: true, queueId: 'queue-1', sid: 'SM-1' })
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(state.db.tables.notification_deliveries).toEqual([])
  })

  it('a usable email: the email only, no queued text, recorded for the bounce fallback and the timeline', async () => {
    const result = await send()

    expect(result).toMatchObject({ success: true, sent: true, channel: 'email' })
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'host@example.com',
        subject: 'Deposit reminder',
        text: 'Deposit reminder',
        commType: 'private_booking_deposit_reminder_7day',
        privateBookingId: 'booking-1',
        customerId: 'customer-1',
        requireLog: true,
        idempotencyKey: 'pb:booking-1:deposit_reminder_7day:2026-09-25',
      })
    )

    const [delivery] = state.db.tables.notification_deliveries
    expect(delivery).toMatchObject({
      customer_id: 'customer-1',
      template_key: 'private_booking_deposit_reminder_7day',
      policy: 'email_first',
      category: 'transactional',
      delayed_fallback_allowed: true,
      final_status: 'sent',
      selected_channel: 'email',
      metadata: expect.objectContaining({
        private_booking_id: 'booking-1',
        trigger_type: 'deposit_reminder_7day',
        email_recipient_source: 'contact_email',
        booking_facts: { event_date: '2026-10-03', hold_expiry_date: '2026-09-25', deposit_amount: 250 },
      }),
    })
    expect(state.db.tables.notification_attempts).toEqual([
      expect.objectContaining({ delivery_id: delivery.id, channel: 'email', status: 'sent', resend_message_id: 'resend-1' }),
    ])
    expect(state.db.tables.private_booking_audit).toEqual([
      expect.objectContaining({
        booking_id: 'booking-1',
        action: 'email_sent',
        new_value: 'private_booking_deposit_reminder_7day',
        metadata: expect.objectContaining({ email_message_id: 'email-row-1', recipient_source: 'contact_email' }),
      }),
    ])
    // The address itself is not copied into the audit row.
    expect(JSON.stringify(state.db.tables.private_booking_audit)).not.toContain('host@example.com')
  })

  it('uses the flag value the calling action read, and does not read the flag again', async () => {
    const reads = () => vi.mocked(isMessagingFlagOn).mock.calls.filter(([key]) => key === 'private_booking_email_first').length

    // The flag row now answers on, but the action read it as off: the send follows the action.
    state.flagOn = true
    const offResult = await send({ emailFirst: false })
    expect(offResult).toEqual({ success: true, sent: true, queueId: 'queue-1', sid: 'SM-1' })
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)

    // And the other way round.
    state.flagOn = false
    const onResult = await send({ emailFirst: true })
    expect(onResult).toMatchObject({ sent: true, channel: 'email' })
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)

    expect(reads()).toBe(0)
  })

  it('reads the flag itself when the caller did not', async () => {
    await send()
    expect(vi.mocked(isMessagingFlagOn)).toHaveBeenCalledWith('private_booking_email_first')
  })

  it("no contact email: the customer's own address is used", async () => {
    await send({ booking: { ...BOOKING, contact_email: null } })
    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'alex@example.com' }))
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
  })

  it('the provider fails: the text goes in the same call and both attempts are recorded', async () => {
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })

    const result = await send()

    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ sent: true, channel: 'sms', emailError: 'Resend 500' })
    const [delivery] = state.db.tables.notification_deliveries
    expect(delivery).toMatchObject({ final_status: 'fallback_sent', selected_channel: 'sms' })
    expect(state.db.tables.notification_attempts.map((row: any) => [row.channel, row.status])).toEqual([
      ['email', 'failed'],
      ['sms', 'sent'],
    ])
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({ action: 'email_failed' })
  })

  it('a suppressed address: the text goes as today', async () => {
    seed({ suppressed: ['host@example.com', 'alex@example.com'] })

    await send()

    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    expect(state.db.tables.notification_deliveries).toEqual([])
  })

  it('no address at all: the text goes as today', async () => {
    seed({ customerEmail: null })
    await send({ booking: { ...BOOKING, contact_email: null } })
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
  })

  it("a bounced customer address is not used when it is the only one", async () => {
    seed({ emailStatus: 'bounced' })
    await send({ booking: { ...BOOKING, contact_email: null } })
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
  })

  it('both fail: the delivery is undelivered, staff are alerted, and it is listed', async () => {
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })
    mockedQueueAndSend.mockResolvedValue({ error: 'No phone number available for SMS' })

    const result = await send()

    expect(result).toMatchObject({ error: 'No phone number available for SMS', channel: null })
    const [delivery] = state.db.tables.notification_deliveries
    expect(delivery).toMatchObject({ final_status: 'failed', metadata: expect.objectContaining({ undelivered_reason: 'email_and_sms_failed' }) })
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({ action: 'email_failed' })
    expect(reportCronFailure).toHaveBeenCalledWith('private-booking-messenger', expect.any(Error), expect.objectContaining({ booking_id: 'booking-1' }))

    const listed = await loadUndeliveredGuestMessages({ sinceIso: '2000-01-01T00:00:00.000Z' })
    expect(listed.rows).toEqual([
      expect.objectContaining({
        id: delivery.id,
        reason: 'Email and text both failed',
        booking: { href: '/private-bookings/booking-1', label: 'Private booking' },
      }),
    ])
  })

  it('an email accepted but not logged counts as sent: no text, and staff are alerted', async () => {
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Email sent state could not be logged', messageId: 'resend-9' })

    const result = await send()

    expect(result).toMatchObject({ sent: true, channel: 'email' })
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })

  it('a text that waits for approval keeps waiting: nothing is emailed until Send Now', async () => {
    await send({
      sms: sms({ trigger_type: 'deposit_reminder_3day', template_key: 'private_booking_deposit_reminder_3day' }),
    })
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
  })

  it('a path that always emailed at once (cancellation) still emails now, and queues the text only if the email fails', async () => {
    const gated = sms({ trigger_type: 'booking_cancelled_retention', template_key: 'private_booking_cancelled_retention' })

    await send({ sms: gated, emailEvenWhenTextNeedsApproval: true })
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend).not.toHaveBeenCalled()

    vi.clearAllMocks()
    seed()
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })
    mockedQueueAndSend.mockResolvedValue({ success: true, requiresApproval: true, queueId: 'queue-9' })
    const result = await send({ sms: gated, emailEvenWhenTextNeedsApproval: true })
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ requiresApproval: true })
    // Waiting for approval is not a failure: nothing is listed as undelivered or alerted.
    expect(state.db.tables.notification_deliveries[0].final_status).not.toBe('failed')
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('a message with no email version goes by text', async () => {
    await send({ email: null })
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
  })

  const AUTOMATED_TRIGGERS = [
    'booking_created',
    'deposit_reminder_7day',
    'deposit_reminder_1day',
    'deposit_received',
    'booking_confirmed',
    'final_payment_received',
    'date_changed',
    'balance_due_date_changed',
    'setup_reminder',
    'booking_completed',
    'booking_expired',
    'hold_extended',
    'event_reminder_1d',
    'review_request',
    'booking_cancelled_hold',
    'booking_cancelled_refundable',
    'booking_cancelled_manual_review',
  ]

  it.each(AUTOMATED_TRIGGERS)('%s: email only when usable, the text when the email fails', async (trigger) => {
    await send({ sms: sms({ trigger_type: trigger, template_key: `private_booking_${trigger}` }) })
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend).not.toHaveBeenCalled()

    vi.clearAllMocks()
    seed()
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })
    mockedQueueAndSend.mockResolvedValue({ success: true, sent: true, queueId: 'queue-2' })
    await send({ sms: sms({ trigger_type: trigger, template_key: `private_booking_${trigger}` }) })
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    expect(state.db.tables.notification_attempts.map((row: any) => row.channel)).toEqual(['email', 'sms'])
  })

  const APPROVAL_TRIGGERS = [
    'deposit_reminder_3day',
    'balance_reminder_21day',
    'balance_reminder_16day',
    'balance_reminder_15day',
    'balance_reminder_due',
    'booking_cancelled_partial_refund',
    'booking_cancelled_retention',
    'booking_cancelled_review_pending',
  ]

  it.each(APPROVAL_TRIGGERS)('%s: still waits for approval, nothing emailed until Send Now', async (trigger) => {
    await send({ sms: sms({ trigger_type: trigger, template_key: `private_booking_${trigger}` }) })
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
  })
})
