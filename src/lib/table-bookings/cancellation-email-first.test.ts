import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The table booking cancellation notice under the messaging flag table_cancelled_email_first
 * (owner decision, 11 September 2026: every table booking text becomes an email when the guest
 * has a usable address).
 *
 * Runs through the real notifyCustomer, so "records both attempts" means the rows it writes to
 * notification_attempts. Only the providers, the database and the audit writer are mocked.
 */

vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email/logging', () => ({ isEmailSuppressed: vi.fn() }))
vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
  sendWhatsApp: vi.fn(),
  isCustomerSmsSendAllowed: vi.fn(),
  isCustomerWhatsAppSendAllowed: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('./refunds', () => ({ refundTableBookingDeposit: vi.fn() }))

import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { sendEmail } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import { isCustomerSmsSendAllowed, sendSMS } from '@/lib/twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuditService } from '@/services/audit'
import { buildSmsDedupContext } from '@/lib/sms/safety'
import {
  describeTableBookingCancellationRefund,
  sendTableBookingCancelledSmsIfAllowed,
  tableBookingCancelledEmailKey,
  type TableBookingCancellationRefundResult,
} from './bookings'
import { refundAndNotifyOnCancel } from './cancel-notify'
import { refundTableBookingDeposit } from './refunds'
import { buildTableBookingCancelledEmail } from './guest-emails'
import { describeGuestNotificationProblem } from './guest-notification-outcome'
import { argsOf, called, createRecordingSupabase } from '../../../tests/mocks/recordingSupabase'
import { assertCleanRender, expectedLongDate } from '../../../tests/mocks/emailRenderChecks'

type Customer = {
  id: string
  first_name: string | null
  mobile_number: string | null
  mobile_e164: string | null
  email: string | null
  sms_status: string | null
  sms_opt_in?: boolean | null
  email_status?: string | null
  email_deactivated_at?: string | null
}

const SARAH: Customer = {
  id: 'cust-1',
  first_name: 'Sarah',
  mobile_number: '+447700900123',
  mobile_e164: '+447700900123',
  email: 'sarah@example.com',
  sms_status: 'active',
  sms_opt_in: true,
  email_status: 'valid',
  email_deactivated_at: null,
}

const BOOKING = {
  id: 'booking-1',
  booking_reference: 'TB-A1B2',
  booking_date: '2026-09-12',
  booking_time: '19:30:00',
  start_datetime: '2026-09-12T18:30:00Z',
  party_size: 4,
}

function buildDb(customer: Customer | null, booking: typeof BOOKING & { cancelled_at?: string | null } = BOOKING) {
  return createRecordingSupabase({
    tables: {
      customers: () => ({ data: customer, error: null }),
      table_bookings: () => ({ data: booking, error: null }),
      notification_deliveries: (query) =>
        called(query, 'insert') ? { data: { id: 'delivery-1' }, error: null } : { data: null, error: null },
      notification_attempts: () => ({ data: null, error: null }),
    },
  })
}

function attemptRows(db: ReturnType<typeof buildDb>) {
  return db.queries
    .filter((query) => query.table === 'notification_attempts' && called(query, 'insert'))
    .map((query) => argsOf(query, 'insert')[0][0] as Record<string, unknown>)
}

function auditCalls() {
  return vi.mocked(AuditService.logAuditEvent).mock.calls.map(([params]) => params)
}

async function cancel(
  db: ReturnType<typeof buildDb>,
  overrides: { refundResult?: TableBookingCancellationRefundResult; tableBookingId?: string; bookingReference?: string } = {}
) {
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return sendTableBookingCancelledSmsIfAllowed(db.client as never, {
    customerId: 'cust-1',
    bookingReference: overrides.bookingReference ?? BOOKING.booking_reference,
    bookingDate: BOOKING.booking_date,
    refundResult: overrides.refundResult ?? { refunded: true, amountPence: 15000, tier: 'full' },
    tableBookingId: overrides.tableBookingId ?? BOOKING.id,
  })
}

// The date exactly as the cancellation text has always printed it ("Sat, 12 Sept 2026" on
// Node 20's locale data), so the comparison does not depend on a runtime's punctuation.
const LEGACY_TEXT_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
}).format(new Date('2026-09-12T12:00:00Z'))

const LEGACY_FULL_REFUND_TEXT = `The Anchor: Sarah, your booking on ${LEGACY_TEXT_DATE} has been cancelled. Your £150.00 refund will land within 5-10 days. Hope to see you again soon!`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isMessagingFlagOn).mockImplementation(async (key) => key === 'table_cancelled_email_first')
  vi.mocked(isEmailSuppressed).mockResolvedValue(false)
  vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: true } as never)
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 're_1' } as never)
  vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM1' } as never)
})

describe('cancellation notice, email first (flag on)', () => {
  it('emails a guest with a usable address and sends no text', async () => {
    const db = buildDb(SARAH)

    const outcome = await cancel(db)

    expect(outcome).toEqual({ status: 'sent', channel: 'email', fallbackUsed: false, error: null })
    expect(sendSMS).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        to: 'sarah@example.com',
        subject: 'Your booking at The Anchor has been cancelled',
        commType: 'table_booking_cancelled',
        tableBookingId: 'booking-1',
        customerId: 'cust-1',
        idempotencyKey: 'table_booking_cancelled:booking-1',
        requireLog: true,
      })
    )
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        operation_type: 'table_booking.notification_sent',
        resource_id: 'booking-1',
        operation_status: 'success',
        additional_info: expect.objectContaining({ comm_type: 'table_booking_cancelled', sent_channel: 'email' }),
      }),
    ])
  })

  it('texts the same words when the email provider fails, and records both attempts', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500: internal server error' } as never)
    const db = buildDb(SARAH)

    const outcome = await cancel(db)

    expect(outcome).toEqual({ status: 'sent', channel: 'sms', fallbackUsed: true, error: null })
    expect(sendSMS).toHaveBeenCalledTimes(1)
    const [to, body, options] = vi.mocked(sendSMS).mock.calls[0]
    expect(to).toBe('+447700900123')
    expect(body).toBe(LEGACY_FULL_REFUND_TEXT)
    // The booking id now rides along, so the log row links to the booking and duplicate
    // protection is per booking rather than per guest per day.
    expect(options?.metadata).toEqual({
      booking_reference: 'TB-A1B2',
      table_booking_id: 'booking-1',
      template_key: 'table_booking_cancelled',
    })

    expect(attemptRows(db)).toEqual([
      expect.objectContaining({ channel: 'email', status: 'failed', error: 'Resend 500: internal server error' }),
      expect.objectContaining({ channel: 'sms', status: 'sent' }),
    ])
  })

  it.each([
    ['no email address', { email: null }],
    ['a bounced address', { email_status: 'bounced' }],
    ['a deactivated address', { email_deactivated_at: '2026-08-01T00:00:00Z' }],
  ])('texts a guest with %s, as today', async (_label, change) => {
    const db = buildDb({ ...SARAH, ...change })

    const outcome = await cancel(db)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(vi.mocked(sendSMS).mock.calls[0][1]).toBe(LEGACY_FULL_REFUND_TEXT)
    expect(outcome?.channel).toBe('sms')
  })

  it('texts a guest whose address is on the suppression list', async () => {
    vi.mocked(isEmailSuppressed).mockResolvedValue(true)
    const db = buildDb(SARAH)

    await cancel(db)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('now tells a guest who has an email address but no mobile, who used to hear nothing', async () => {
    const db = buildDb({ ...SARAH, mobile_number: null, mobile_e164: null, sms_status: null })

    const outcome = await cancel(db)

    expect(outcome?.status).toBe('sent')
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('writes the failure audit row and returns a failure staff will see when both channels fail', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500' } as never)
    vi.mocked(sendSMS).mockResolvedValue({ success: false, error: 'Twilio 21211 invalid number', code: '21211' } as never)
    const db = buildDb(SARAH)

    const outcome = await cancel(db)

    expect(outcome?.status).toBe('failed')
    expect(outcome?.error).toBe('Twilio 21211 invalid number')
    expect(attemptRows(db)).toHaveLength(2)
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        operation_type: 'table_booking.notification_failed',
        resource_type: 'table_booking',
        resource_id: 'booking-1',
        operation_status: 'failure',
        error_message: 'Twilio 21211 invalid number',
        additional_info: expect.objectContaining({
          comm_type: 'table_booking_cancelled',
          outcome: 'failed',
          email_error: 'Resend 500',
          sms_code: '21211',
        }),
      }),
    ])
    expect(describeGuestNotificationProblem(outcome, 'about the cancellation')).toBe(
      'We could not reach the guest about the cancellation by email or text. Please contact them.'
    )
  })

  it('says so when the guest has neither a usable address nor a mobile', async () => {
    const db = buildDb({ ...SARAH, email: null, mobile_number: null, mobile_e164: null })
    vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: false } as never)

    const outcome = await cancel(db)

    expect(outcome?.status).toBe('no_channel')
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
    expect(auditCalls()[0]).toEqual(expect.objectContaining({ operation_type: 'table_booking.notification_failed' }))
  })

  it('hands the failure to the cancel routes through refundAndNotifyOnCancel', async () => {
    vi.mocked(refundTableBookingDeposit).mockResolvedValue({ refunded: false, reason: 'no_deposit' } as never)
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500' } as never)
    vi.mocked(sendSMS).mockResolvedValue({ success: false, error: 'blocked' } as never)
    const db = buildDb(SARAH)
    vi.mocked(createAdminClient).mockReturnValue(db.client as never)

    const result = await refundAndNotifyOnCancel(db.client as never, {
      bookingId: 'booking-1',
      bookingReference: 'TB-A1B2',
      bookingDate: '2026-09-12',
      customerId: 'cust-1',
      source: 'foh_cancel',
    })

    expect(result.notification?.status).toBe('failed')
  })

  it('sends two notices for two bookings cancelled on the same day', async () => {
    const noEmail = { ...SARAH, email: null }
    await cancel(buildDb(noEmail), { tableBookingId: 'booking-1', bookingReference: 'TB-1' })
    await cancel(buildDb(noEmail, { ...BOOKING, id: 'booking-2' }), { tableBookingId: 'booking-2', bookingReference: 'TB-2' })

    expect(sendSMS).toHaveBeenCalledTimes(2)
    const dedupeKeys = vi.mocked(sendSMS).mock.calls.map(([to, body, options]) =>
      buildSmsDedupContext({ to, body, customerId: 'cust-1', metadata: options?.metadata ?? null })?.key
    )
    // Distinct duplicate-protection keys: the second text is not swallowed as a repeat of the first.
    expect(new Set(dedupeKeys).size).toBe(2)
  })
})

describe('one cancellation email key per cancellation', () => {
  function sentKey(): string {
    const calls = vi.mocked(sendEmail).mock.calls
    return String(calls[calls.length - 1][0].idempotencyKey)
  }

  it('keys the email on the cancellation, read from the booking row', async () => {
    const db = buildDb(SARAH, { ...BOOKING, cancelled_at: '2026-09-11T14:03:22.123+00:00' })

    await cancel(db)

    expect(sentKey()).toBe('table_booking_cancelled:booking-1:2026-09-11T14:03:22.123Z')
    const bookingQuery = db.queries.find((query) => query.table === 'table_bookings')!
    expect(String(argsOf(bookingQuery, 'select')[0][0])).toContain('cancelled_at')
  })

  it('a retry of the same cancellation reuses the key, so the provider sends it once', async () => {
    const cancelled = { ...BOOKING, cancelled_at: '2026-09-11T14:03:22.123+00:00' }
    await cancel(buildDb(SARAH, cancelled))
    const first = sentKey()
    await cancel(buildDb(SARAH, cancelled))

    expect(sentKey()).toBe(first)
  })

  it('cancelled, re-confirmed and cancelled again within the day: a new key, so the guest gets the second email', async () => {
    await cancel(buildDb(SARAH, { ...BOOKING, cancelled_at: '2026-09-11T14:03:22.123+00:00' }))
    const first = sentKey()
    await cancel(buildDb(SARAH, { ...BOOKING, cancelled_at: '2026-09-11T16:45:00.000+00:00' }))

    expect(sentKey()).not.toBe(first)
    expect(sentKey()).toBe('table_booking_cancelled:booking-1:2026-09-11T16:45:00.000Z')
  })

  it('falls back to the booking alone when the cancellation time cannot be read', () => {
    expect(tableBookingCancelledEmailKey('booking-1', null)).toBe('table_booking_cancelled:booking-1')
    expect(tableBookingCancelledEmailKey('booking-1', 'not a date')).toBe('table_booking_cancelled:booking-1')
  })

  it('the bounce fallback still finds the delivery by its template key, whatever the email key', async () => {
    const db = buildDb(SARAH, { ...BOOKING, cancelled_at: '2026-09-11T14:03:22.123+00:00' })

    await cancel(db)

    const deliveryInsert = db.queries.find((query) => query.table === 'notification_deliveries' && called(query, 'insert'))!
    expect(argsOf(deliveryInsert, 'insert')[0][0]).toMatchObject({
      template_key: 'table_booking_cancelled',
      delayed_fallback_allowed: true,
      metadata: expect.objectContaining({ table_booking_id: 'booking-1', fallback_message: 'cancellation' }),
    })
  })
})

describe('cancellation notice with the flag off: exactly today', () => {
  beforeEach(() => {
    vi.mocked(isMessagingFlagOn).mockResolvedValue(false)
  })

  it('sends the same text with the same metadata and no email', async () => {
    const db = buildDb(SARAH)

    const outcome = await cancel(db)

    expect(outcome).toBeNull()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendSMS).mock.calls[0]).toEqual([
      '+447700900123',
      LEGACY_FULL_REFUND_TEXT,
      { customerId: 'cust-1', metadata: { booking_reference: 'TB-A1B2', template_key: 'table_booking_cancelled' } },
    ])
    // Today's narrow customer read, and today's audit row.
    const customerQuery = db.queries.find((query) => query.table === 'customers')!
    expect(argsOf(customerQuery, 'select')[0]).toEqual(['id, first_name, mobile_number, sms_status'])
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        operation_type: 'table_booking.sms_sent',
        additional_info: expect.objectContaining({ sms_type: 'table_booking_cancelled' }),
      }),
    ])
    expect(db.queries.some((query) => query.table === 'notification_deliveries')).toBe(false)
  })

  it('still says nothing to a guest without an active mobile', async () => {
    const db = buildDb({ ...SARAH, sms_status: 'opted_out' })

    await cancel(db)

    expect(sendSMS).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Fixture renders. Run in both the London and the UTC suite.
// ---------------------------------------------------------------------------

const REFUND_VARIANTS: Array<[string, TableBookingCancellationRefundResult]> = [
  ['full refund', { refunded: true, amountPence: 15000, tier: 'full' }],
  ['half refund', { refunded: true, amountPence: 7500, tier: 'half' }],
  ['inside three days', { refunded: false, reason: 'zero_tier' }],
  ['refund failed, amount known', { refunded: false, reason: 'refund_failed', depositOwed: true, amountOwedPence: 15000 }],
  ['refund failed, amount unknown', { refunded: false, reason: 'refund_failed', depositOwed: true }],
  ['terms unreadable', { refunded: false, reason: 'terms_unreadable' }],
  ['no deposit', { refunded: false, reason: 'no_deposit' }],
]

describe('cancellation email renders', () => {
  it.each(REFUND_VARIANTS)('%s: every fact the text carries, and no broken values', (_label, refundResult) => {
    const refundSentence = describeTableBookingCancellationRefund(refundResult)
    const email = buildTableBookingCancelledEmail({
      firstName: 'Sarah',
      bookingReference: 'TB-A1B2',
      bookingDate: '2026-09-12',
      bookingTime: '19:30:00',
      startDateTime: '2026-09-12T18:30:00Z',
      partySize: 4,
      refundSentence,
    })

    assertCleanRender(email)
    // 12 September 2026 is a Saturday.
    expect(expectedLongDate('2026-09-12')).toBe('Saturday 12 September 2026')
    expect(email.text).toContain('Hi Sarah, your booking on Saturday 12 September 2026 has been cancelled.')
    expect(email.text).toContain('Reference: TB-A1B2')
    expect(email.text).toContain('Time: 7:30pm')
    expect(email.text).toContain('Party size: 4 people')
    // The refund words are the text's words, character for character.
    expect(email.text).toContain(refundSentence)
    expect(email.html).toContain(refundSentence.replaceAll("'", '&#39;'))
  })

  it.each([
    ['2026-10-25', '12:00:00', 'the autumn clock change'],
    ['2026-03-29', '13:00:00', 'the spring clock change'],
    ['2027-01-01', '00:30:00', 'a past-midnight time on New Year'],
  ])('puts the right weekday on %s at %s (%s)', (bookingDate, bookingTime) => {
    const email = buildTableBookingCancelledEmail({
      firstName: 'Sarah',
      bookingReference: 'TB-A1B2',
      bookingDate,
      bookingTime,
      partySize: 1,
      refundSentence: 'Hope to see you again soon!',
    })

    assertCleanRender(email)
    expect(email.text).toContain(`Date: ${expectedLongDate(bookingDate)}`)
    expect(email.text).toContain('Party size: 1 person')
  })

  it('leaves out, rather than inventing, a time and party size it does not have', () => {
    const email = buildTableBookingCancelledEmail({
      firstName: 'there',
      bookingReference: 'TB-A1B2',
      bookingDate: '2026-09-12',
      refundSentence: 'Hope to see you again soon!',
    })

    assertCleanRender(email)
    expect(email.text).not.toContain('Time:')
    expect(email.text).not.toContain('Party size:')
  })
})
