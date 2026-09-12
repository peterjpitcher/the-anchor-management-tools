import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

// The deposit request goes email first whatever private_booking_email_first says, so every flag
// reads off here: the send must not depend on one.
vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async () => false),
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
import { SmsQueueService } from '@/services/sms-queue'
import { reportCronFailure } from '@/lib/cron/alerting'
import { confirmDeposit, DepositConfirmationError } from '@/services/private-bookings/deposit-confirmation'

const mockedSendEmail = sendEmail as unknown as Mock
const mockedQueueAndSend = SmsQueueService.queueAndSend as unknown as Mock

// 10:00 in London on Friday 11 September 2026.
const NOW = new Date('2026-09-11T09:00:00.000Z')

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
    event_date: '2026-11-21',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    hold_expiry: null,
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    deposit_confirmed_at: null,
    deposit_confirmed_by: null,
    paypal_deposit_order_id: 'old-order',
    balance_due_date: '2026-11-07',
    final_payment_date: null,
    setup_date: null,
    setup_time: null,
    ...overrides,
  }
}

function seed(booking: Record<string, unknown> = bookingRow(), customer: Record<string, unknown> = {}) {
  state.db = createFakeSupabase({
    private_bookings: [booking],
    customers: [{ id: 'customer-1', email: null, email_status: null, email_deactivated_at: null, mobile_number: '+447700900123', ...customer }],
    email_suppressions: [],
    notification_deliveries: [],
    notification_attempts: [],
    private_booking_audit: [],
  })
}

function row() {
  return state.db.tables.private_bookings[0]
}

function timeline(action: string) {
  return state.db.tables.private_booking_audit.filter((entry: any) => entry.action === action)
}

describe('Confirm deposit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
    mockedQueueAndSend.mockResolvedValue({ success: true, sent: true, queueId: 'queue-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records who and when, sets the deadline, and emails one deposit request with cash at the bar and the PayPal link', async () => {
    seed()

    const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 300, confirmedBy: 'user-1', now: NOW })

    expect(outcome).toMatchObject({ status: 'sent', channel: 'email', amount: 300, emailError: null })
    // No hold was set, so the creation rule: 14 days from now (25 September), well before the
    // balance deadline of 7 November. The whole of the 25th counts, because 25 September is the
    // date the guest is given (review PB-BR-1).
    expect(outcome.status === 'sent' && outcome.holdExpiry).toBe('2026-09-25T22:59:59.000Z')
    expect(outcome.status === 'sent' && outcome.message).toBe(
      'Deposit confirmed at £300, due by 25 September 2026. The deposit request was emailed to the guest.'
    )
    expect(row()).toMatchObject({
      deposit_confirmed_at: NOW.toISOString(),
      deposit_confirmed_by: 'user-1',
      deposit_amount: 300,
      hold_expiry: '2026-09-25T22:59:59.000Z',
      // An order made for the old amount is dropped, as editing the amount does.
      paypal_deposit_order_id: null,
    })

    expect(mockedQueueAndSend).not.toHaveBeenCalled()
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.to).toBe('host@example.com')
    expect(email.commType).toBe('private_booking_deposit_request')
    expect(email.idempotencyKey).toBe(`pb:booking-1:deposit_request:confirmed-${NOW.toISOString()}`)
    expect(email.subject).toBe('Your deposit for The Anchor: £300 by 25 September 2026')
    expect(email.text).toContain('The deposit for your booking on Saturday, 21 November 2026 is £300.')
    expect(email.text).toContain('You can pay it in cash at the bar, or by PayPal using the button below.')
    expect(email.text).toMatch(/Pay the deposit by PayPal: https:\/\/example\.com\/booking-portal\/[A-Za-z0-9_-]+\n/)
    expect(email.text).toContain("held separately from your bill and refunded after the event, less any documented deductions")

    // The delivery row lets a bounce rebuild the text; the timeline shows what happened.
    expect(state.db.tables.notification_deliveries[0].metadata).toMatchObject({
      private_booking_id: 'booking-1',
      trigger_type: 'deposit_request',
      booking_facts: { event_date: '2026-11-21', hold_expiry_date: '2026-09-25', deposit_amount: 300 },
    })
    expect(timeline('email_sent')).toHaveLength(1)
    expect(timeline('deposit_confirmed')[0]).toMatchObject({
      booking_id: 'booking-1',
      field_name: 'deposit_amount',
      old_value: '250',
      new_value: '300',
      performed_by: 'user-1',
      metadata: expect.objectContaining({ channel: 'email', description: outcome.status === 'sent' ? outcome.message : '' }),
    })
  })

  it('a double click sends one request: the second finds the deposit already confirmed', async () => {
    seed()

    const [first, second] = await Promise.all([
      confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW }),
      confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-2', now: NOW }),
    ])

    expect([first.status, second.status].sort()).toEqual(['already_confirmed', 'sent'])
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
    expect(timeline('deposit_confirmed')).toHaveLength(1)
  })

  it('confirming again later sends nothing more', async () => {
    seed()
    await confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })

    const again = await confirmDeposit({ bookingId: 'booking-1', amount: 400, confirmedBy: 'user-1', now: NOW })

    expect(again).toEqual({ status: 'already_confirmed', message: 'The deposit was already confirmed, so nothing more was sent.' })
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect(row().deposit_amount).toBe(250)
  })

  it('with no usable email address, texts the request through the queue, which sends it straight away', async () => {
    seed(bookingRow({ contact_email: null }))

    const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })

    expect(outcome).toMatchObject({ status: 'sent', channel: 'sms' })
    expect(outcome.status === 'sent' && outcome.message).toContain('The guest has no usable email address, so the deposit request was sent by text.')
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    const sms = mockedQueueAndSend.mock.calls[0][0]
    expect(sms).toMatchObject({ trigger_type: 'deposit_request', template_key: 'private_booking_deposit_request', created_by: 'user-1' })
    expect(sms.message_body).toMatch(
      /^Hi Alex, the deposit for your booking at The Anchor on 21 November 2026 is £250, due by 25 September 2026\. Pay in cash at the bar or by PayPal: https:\/\/example\.com\/booking-portal\/[A-Za-z0-9_-]+$/
    )
  })

  it('when the email fails, the text goes and staff are told both', async () => {
    seed()
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })

    const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })

    expect(outcome).toMatchObject({ status: 'sent', channel: 'sms', emailError: 'Resend 500' })
    expect(outcome.status === 'sent' && outcome.message).toContain('The email failed (Resend 500), so the deposit request was sent by text instead.')
    expect(row().deposit_confirmed_at).toBe(NOW.toISOString())
  })

  it('when nothing reaches the guest, the booking goes back to deposit to be confirmed and staff see why', async () => {
    seed(bookingRow({ hold_expiry: null, deposit_amount: 250 }))
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })
    mockedQueueAndSend.mockResolvedValue({ error: 'Twilio unavailable' })

    const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 300, confirmedBy: 'user-1', now: NOW })

    expect(outcome).toMatchObject({ status: 'not_sent', restored: true })
    expect(outcome.message).toBe(
      "Nothing was sent: the email failed (Resend 500) and the text failed too (Twilio unavailable). The deposit is still to be confirmed. Check the guest's email address and mobile number, then confirm again."
    )
    expect(row()).toMatchObject({ deposit_confirmed_at: null, deposit_confirmed_by: null, deposit_amount: 250, hold_expiry: null })
    expect(timeline('deposit_confirmation_failed')).toHaveLength(1)
    expect(timeline('deposit_confirmed')).toHaveLength(0)
    // The messenger raises the undelivered message with staff as well.
    expect(reportCronFailure).toHaveBeenCalled()

    // Once fixed, confirming again sends a fresh request.
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-2', emailMessageId: 'email-row-2' })
    const later = new Date(NOW.getTime() + 60_000)
    const retry = await confirmDeposit({ bookingId: 'booking-1', amount: 300, confirmedBy: 'user-1', now: later })
    expect(retry).toMatchObject({ status: 'sent', channel: 'email' })
    expect(mockedSendEmail.mock.calls.at(-1)?.[0].idempotencyKey).toBe(`pb:booking-1:deposit_request:confirmed-${later.toISOString()}`)
  })

  it('with no email and no mobile number, nothing is sent and the deposit stays to be confirmed', async () => {
    seed(bookingRow({ contact_email: null, contact_phone: null }), { mobile_number: null })
    mockedQueueAndSend.mockResolvedValue({ error: 'No phone number available for SMS' })

    const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })

    expect(outcome).toMatchObject({ status: 'not_sent', reason: 'the guest has no usable email address and no mobile number', restored: true })
    expect(row().deposit_confirmed_at).toBeNull()
  })

  it('a database failure saving the confirmation stops everything: nothing sent, nothing changed', async () => {
    seed()
    state.db.failures.push({ table: 'private_bookings', op: 'update', error: { code: '57014', message: 'canceling statement due to statement timeout' } })

    await expect(confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })).rejects.toThrow(
      'The deposit could not be confirmed (canceling statement due to statement timeout), so nothing was sent.'
    )
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
    expect(row().deposit_confirmed_at).toBeNull()
  })

  it('before the migration is applied, says so rather than a generic error', async () => {
    seed()
    state.db.failures.push({
      table: 'private_bookings',
      op: 'select',
      error: { code: '42703', message: 'column private_bookings.deposit_confirmed_at does not exist' },
    })

    await expect(confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })).rejects.toThrow(
      'Deposit confirmation needs a database change that has not been applied yet, so nothing was sent.'
    )
  })

  describe('the deadline it sets', () => {
    it('keeps a hold still in the future: the date has been held until then', async () => {
      seed(bookingRow({ hold_expiry: '2026-09-30T22:59:59.999Z' }))
      const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })
      expect(outcome.status === 'sent' && outcome.holdExpiry).toBe('2026-09-30T22:59:59.999Z')
    })

    it('replaces a hold that has run out while the deposit waited', async () => {
      seed(bookingRow({ hold_expiry: '2026-09-05T22:59:59.999Z' }))
      const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })
      expect(outcome.status === 'sent' && outcome.holdExpiry).toBe('2026-09-25T22:59:59.000Z')
    })

    it('inside the balance window: to the end of the second day, as at booking time', async () => {
      seed(bookingRow({ event_date: '2026-09-20', balance_due_date: '2026-09-11' }))
      const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })
      expect(outcome.status === 'sent' && outcome.holdExpiry).toBe('2026-09-13T22:59:59.000Z')
    })

    it('a date still to be confirmed gets no deadline, and the request says none', async () => {
      seed(bookingRow({ date_tbd: true }))
      const outcome = await confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })
      expect(outcome).toMatchObject({ status: 'sent', holdExpiry: null })
      expect(mockedSendEmail.mock.calls[0][0].text).not.toContain('Pay by')
    })

    it('refuses when the deadline would already have passed', async () => {
      seed(bookingRow({ event_date: '2026-09-11' }))
      await expect(confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })).rejects.toThrow(
        DepositConfirmationError
      )
      expect(mockedSendEmail).not.toHaveBeenCalled()
    })
  })

  it.each([
    ['a paid deposit', { deposit_paid_date: '2026-09-10' }, 'The deposit has already been paid.'],
    ['a waived deposit', { deposit_waived: true, deposit_amount: 0 }, 'The deposit has been waived, so there is nothing to confirm.'],
    ['a cancelled booking', { status: 'cancelled' }, 'Only a draft or confirmed booking can have its deposit confirmed.'],
  ])('refuses %s and sends nothing', async (_label, overrides, message) => {
    seed(bookingRow(overrides))
    await expect(confirmDeposit({ bookingId: 'booking-1', amount: 250, confirmedBy: 'user-1', now: NOW })).rejects.toThrow(message)
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
  })

  it('refuses a £0 amount, which is a waiver, not a confirmation', async () => {
    seed()
    await expect(confirmDeposit({ bookingId: 'booking-1', amount: 0, confirmedBy: 'user-1', now: NOW })).rejects.toThrow('Enter a deposit amount greater than £0')
  })
})
