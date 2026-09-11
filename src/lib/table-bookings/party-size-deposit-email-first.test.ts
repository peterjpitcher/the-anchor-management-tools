import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The deposit request staff trigger by growing a party past the threshold, under the messaging
 * flag table_party_size_deposit_email_first. The old path reported "sent by SMS" to staff even
 * when the text failed; the email-first path reports the channel that actually reached the guest,
 * or that none did.
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
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const PAYMENT_URL = 'https://management.example.com/g/pay-token/table-payment'
const HOLD_EXPIRES = '2026-12-04T18:00:00.000Z'
vi.mock('@/lib/table-bookings/bookings', () => ({
  createTablePaymentToken: vi.fn(async () => ({ url: PAYMENT_URL, expiresAt: HOLD_EXPIRES, rawToken: 'pay-token' })),
}))
vi.mock('@/lib/guest/guest-short-link', () => ({
  buildGuestShortLink: vi.fn(async () => ({ url: 'https://l.the-anchor.pub/pay1', shortened: true })),
}))

import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { sendEmail } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import { isCustomerSmsSendAllowed, sendSMS } from '@/lib/twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuditService } from '@/services/audit'
import { applyPartySizeDepositTransition } from './staff-deposit-transitions'
import { buildTableBookingDepositRequestEmail } from './guest-emails'
import { argsOf, called, createRecordingSupabase } from '../../../tests/mocks/recordingSupabase'
import { assertCleanRender, assertCleanText, expectedLongDate } from '../../../tests/mocks/emailRenderChecks'

const GUEST = {
  id: 'cust-2',
  first_name: 'Jo',
  last_name: 'Guest',
  mobile_number: '07700900222',
  mobile_e164: '+447700900222',
  email: 'jo@example.com',
  sms_status: 'active',
  sms_opt_in: true,
  email_status: 'valid',
  email_deactivated_at: null,
}

const BOOKING = {
  id: 'b-2',
  customer_id: 'cust-2',
  party_size: 4,
  status: 'confirmed',
  payment_status: null,
  booking_type: 'regular',
  start_datetime: '2026-12-05T19:00:00.000Z',
  deposit_amount: null,
  deposit_amount_locked: null,
  deposit_waived: false,
  booking_period_id: null,
  booking_period_name: null,
}

function buildDb(customer: Record<string, unknown> = GUEST) {
  const db = createRecordingSupabase({
    tables: {
      customers: () => ({ data: customer, error: null }),
      table_bookings: (query) =>
        called(query, 'update')
          ? { data: null, error: null }
          : {
              data: {
                booking_reference: 'TB-GRP16',
                booking_date: '2026-12-05',
                booking_time: '19:00:00',
                start_datetime: '2026-12-05T19:00:00.000Z',
              },
              error: null,
            },
      notification_deliveries: (query) =>
        called(query, 'insert') ? { data: { id: 'delivery-1' }, error: null } : { data: null, error: null },
      notification_attempts: () => ({ data: null, error: null }),
    },
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return db
}

function grow(db: ReturnType<typeof buildDb>, sendSms = true) {
  return applyPartySizeDepositTransition(db.client as never, {
    booking: BOOKING,
    previousPartySize: 4,
    newPartySize: 16,
    sendSms,
    appBaseUrl: 'https://management.example.com',
  })
}

const TEXT_WITH_SHORT_LINK =
  'The Anchor: Hi Jo, your party size has been updated to 16 people. A table deposit of £160.00 (16 x GBP 10) is now required to secure your booking. Pay now: https://l.the-anchor.pub/pay1'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isMessagingFlagOn).mockImplementation(async (key) => key === 'table_party_size_deposit_email_first')
  vi.mocked(isEmailSuppressed).mockResolvedValue(false)
  vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: true } as never)
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 're_pay' } as never)
  vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM2' } as never)
})

describe('party-size deposit request, email first (flag on)', () => {
  it('emails a guest with a usable address and tells staff it went by email', async () => {
    const db = buildDb()

    const result = await grow(db)

    expect(result).toEqual(
      expect.objectContaining({
        state: 'deposit_required',
        depositAmount: 160,
        smsSent: false,
        notification: { status: 'sent', channel: 'email', fallbackUsed: false, error: null },
      })
    )
    expect(sendSMS).not.toHaveBeenCalled()
    const email = vi.mocked(sendEmail).mock.calls[0][0]
    expect(email).toEqual(
      expect.objectContaining({
        to: 'jo@example.com',
        subject: 'Pay your deposit to secure your booking at The Anchor',
        commType: 'table_booking_pending_payment',
        tableBookingId: 'b-2',
        idempotencyKey: `table_booking_pending_payment:party_size:b-2:${HOLD_EXPIRES}`,
      })
    )
    expect(email.text).toContain(
      'Hi Jo, your party size has been updated to 16 people. A table deposit of £160.00 (16 x GBP 10) is now required to secure your booking.'
    )
    expect(email.text).toContain('Pay your deposit: https://l.the-anchor.pub/pay1')
    // Friday 4 December 2026, 18:00 GMT: when the hold, and so the link, runs out.
    expect(email.text).toContain('This payment link works until Friday 4 December 2026 at 6pm.')
  })

  it('texts the same words when the email fails, records both attempts, and says it went by text', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500' } as never)
    const db = buildDb()

    const result = await grow(db)

    expect(result).toEqual(
      expect.objectContaining({
        smsSent: true,
        notification: { status: 'sent', channel: 'sms', fallbackUsed: true, error: null },
      })
    )
    const [to, body, options] = vi.mocked(sendSMS).mock.calls[0]
    expect(to).toBe('+447700900222')
    expect(body).toBe(TEXT_WITH_SHORT_LINK)
    assertCleanText(body)
    expect(options?.metadata).toEqual({
      trigger: 'party_size_threshold_crossed',
      table_booking_id: 'b-2',
      template_key: 'table_booking_pending_payment',
    })
    const attempts = db.queries
      .filter((query) => query.table === 'notification_attempts' && called(query, 'insert'))
      .map((query) => argsOf(query, 'insert')[0][0] as Record<string, unknown>)
    expect(attempts.map((row) => [row.channel, row.status])).toEqual([
      ['email', 'failed'],
      ['sms', 'sent'],
    ])
  })

  it('texts a guest with no email address, as today', async () => {
    const db = buildDb({ ...GUEST, email: null })

    const result = await grow(db)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ smsSent: true }))
  })

  it('reports that nothing reached the guest, instead of "sent by SMS", when both channels fail', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500' } as never)
    vi.mocked(sendSMS).mockResolvedValue({ success: false, error: 'Twilio 21610 unsubscribed', code: '21610' } as never)
    const db = buildDb()

    const result = await grow(db)

    expect(result).toEqual(
      expect.objectContaining({
        state: 'deposit_required',
        smsSent: false,
        notification: expect.objectContaining({ status: 'failed', channel: null }),
      })
    )
    expect(vi.mocked(AuditService.logAuditEvent).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        operation_type: 'table_booking.notification_failed',
        resource_id: 'b-2',
        operation_status: 'failure',
      })
    )
  })

  it('sends nothing and reads no flag when staff untick "notify guest"', async () => {
    const db = buildDb()

    const result = await grow(db, false)

    expect(isMessagingFlagOn).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ smsSent: false }))
    expect(result).not.toHaveProperty('notification')
  })
})

describe('party-size deposit request with the flag off: exactly today', () => {
  it('sends the same text with the long link and reports as before', async () => {
    vi.mocked(isMessagingFlagOn).mockResolvedValue(false)
    const db = buildDb()

    const result = await grow(db)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(vi.mocked(sendSMS).mock.calls[0]).toEqual([
      '+447700900222',
      TEXT_WITH_SHORT_LINK.replace('https://l.the-anchor.pub/pay1', PAYMENT_URL),
      {
        customerId: 'cust-2',
        metadata: { table_booking_id: 'b-2', template_key: 'table_booking_pending_payment', trigger: 'party_size_threshold_crossed' },
      },
    ])
    expect(result).toEqual(expect.objectContaining({ smsSent: true }))
    expect(result).not.toHaveProperty('notification')
    const customerQuery = db.queries.find((query) => query.table === 'customers')!
    expect(argsOf(customerQuery, 'select')[0]).toEqual(['id, first_name, mobile_number, mobile_e164, sms_status'])
  })
})

describe('deposit request email renders', () => {
  it.each([
    ['2026-12-05', '19:00:00', '2026-12-04T18:00:00.000Z', 'Friday 4 December 2026 at 6pm'],
    // Hold running out during British Summer Time: 17:30 UTC is 6:30pm in London.
    ['2026-09-19', '18:30:00', '2026-09-18T17:30:00.000Z', 'Friday 18 September 2026 at 6:30pm'],
  ])('booking %s at %s: exact amounts, the right weekday, no broken values', (bookingDate, bookingTime, payBy, payByLabel) => {
    const email = buildTableBookingDepositRequestEmail({
      firstName: 'Jo',
      bookingReference: 'TB-GRP16',
      bookingDate,
      bookingTime,
      partySize: 16,
      depositKindLabel: 'Sunday lunch deposit',
      depositLabel: '£160.00',
      breakdownNote: ' (16 x GBP 10)',
      paymentLink: 'https://l.the-anchor.pub/pay1',
      payByIso: payBy,
    })

    assertCleanRender(email)
    expect(email.text).toContain(`Date: ${expectedLongDate(bookingDate)}`)
    expect(email.text).toContain('A Sunday lunch deposit of £160.00 (16 x GBP 10) is now required to secure your booking.')
    expect(email.text).toContain('Deposit: £160.00')
    expect(email.text).toContain('Party size: 16 people')
    expect(email.text).toContain(`This payment link works until ${payByLabel}.`)
    expect(email.html).toContain('href="https://l.the-anchor.pub/pay1"')
  })
})
