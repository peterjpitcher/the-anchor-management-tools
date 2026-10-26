import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-088 (owner decision D16): one reminder before an unpaid table deposit hold runs out, about six
 * hours before it ends, by email first with the text as the fallback, claimed in a ledger so a hold
 * is reminded about once, never overnight, and never on the heels of the request itself.
 */

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
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const PAYMENT_URL = 'https://management.example.com/g/pay-token/table-payment'
vi.mock('@/lib/table-bookings/bookings', () => ({
  createTablePaymentToken: vi.fn(async (_db: unknown, input: { holdExpiresAt: string }) => ({ url: PAYMENT_URL, expiresAt: input.holdExpiresAt, rawToken: 'pay-token' })),
}))
vi.mock('@/lib/guest/guest-short-link', () => ({
  buildGuestShortLink: vi.fn(async () => ({ url: 'https://l.the-anchor.pub/pay1', shortened: true })),
}))

import { sendEmail } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import { isCustomerSmsSendAllowed, sendSMS } from '@/lib/twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { createTablePaymentToken } from '@/lib/table-bookings/bookings'
import {
  decideDepositHoldReminder,
  runDepositHoldReminders,
} from './deposit-hold-reminder'
import { buildTableBookingDepositReminderEmail } from './guest-emails'
import { buildDepositHoldReminderText } from './guest-texts'
import { argsOf, called, createRecordingSupabase } from '../../../tests/mocks/recordingSupabase'
import { assertCleanRender, assertCleanText, expectedLongDate } from '../../../tests/mocks/emailRenderChecks'

const HOUR = 60 * 60 * 1000
// Thursday 3 December 2026, 13:00 GMT: inside the day, outside quiet hours.
const NOW = new Date('2026-12-03T13:00:00Z')
const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR).toISOString()

describe('who gets the one reminder', () => {
  const base = { now: NOW, alreadyReminded: false, depositSettled: false, inQuietHours: false }

  it('reminds a 24-hour hold six hours before it ends', () => {
    expect(decideDepositHoldReminder({ ...base, holdExpiresAt: at(6), createdAt: at(-18) })).toEqual({ send: true })
  })

  it('waits until the hold has six hours or less to run', () => {
    expect(decideDepositHoldReminder({ ...base, holdExpiresAt: at(7), createdAt: at(-17) })).toEqual({ send: false, reason: 'not_due_yet' })
  })

  it('stays quiet with under two hours left, which is too late to help', () => {
    expect(decideDepositHoldReminder({ ...base, holdExpiresAt: at(1.5), createdAt: at(-22.5) })).toEqual({ send: false, reason: 'too_late' })
  })

  it('never reminds within three hours of the request, so a short hold gets none', () => {
    // A booking made an hour ago for four hours' time: its hold is four hours long.
    expect(decideDepositHoldReminder({ ...base, holdExpiresAt: at(3), createdAt: at(-1) })).toEqual({ send: false, reason: 'too_soon_after_request' })
  })

  it('reminds a five-hour hold three hours after the request', () => {
    expect(decideDepositHoldReminder({ ...base, holdExpiresAt: at(2), createdAt: at(-3) })).toEqual({ send: true })
  })

  it('estimates the request from a 24-hour hold when the booking itself is older (a party grown later)', () => {
    // Made a week ago; the deposit was asked for when the party grew, at most 24 hours before the hold ends.
    expect(decideDepositHoldReminder({ ...base, holdExpiresAt: at(6), createdAt: at(-24 * 7) })).toEqual({ send: true })
    expect(decideDepositHoldReminder({ ...base, holdExpiresAt: at(22), createdAt: at(-24 * 7) })).toEqual({ send: false, reason: 'not_due_yet' })
  })

  it('never overnight', () => {
    expect(decideDepositHoldReminder({ ...base, inQuietHours: true, holdExpiresAt: at(6), createdAt: at(-18) })).toEqual({ send: false, reason: 'quiet_hours' })
  })

  it('once per hold', () => {
    expect(decideDepositHoldReminder({ ...base, alreadyReminded: true, holdExpiresAt: at(5), createdAt: at(-19) })).toEqual({ send: false, reason: 'already_reminded' })
  })

  it('not once the deposit is settled', () => {
    expect(decideDepositHoldReminder({ ...base, depositSettled: true, holdExpiresAt: at(5), createdAt: at(-19) })).toEqual({ send: false, reason: 'deposit_settled' })
  })
})

const GUEST = {
  id: 'cust-9',
  first_name: 'Sam',
  last_name: 'Guest',
  mobile_number: '07700900999',
  mobile_e164: '+447700900999',
  email: 'sam@example.com',
  sms_status: 'active',
  sms_opt_in: true,
  email_status: 'valid',
  email_deactivated_at: null,
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tb-9',
    customer_id: 'cust-9',
    booking_reference: 'TB-XMAS9',
    booking_date: '2026-12-05',
    booking_time: '19:00:00',
    start_datetime: '2026-12-05T19:00:00.000Z',
    created_at: at(-18),
    party_size: 6,
    booking_type: 'christmas',
    is_outside_seating: false,
    status: 'pending_payment',
    payment_status: 'pending',
    hold_expires_at: at(6),
    deposit_amount: 60,
    deposit_amount_locked: null,
    deposit_waived: false,
    deposit_refund_cutoff_days: 7,
    paypal_deposit_capture_id: null,
    ...overrides,
  }
}

function buildDb(options: { rows?: Record<string, unknown>[]; ledger?: Record<string, unknown>[]; claimError?: unknown } = {}) {
  const db = createRecordingSupabase({
    tables: {
      table_bookings: () => ({ data: options.rows ?? [booking()], error: null }),
      table_booking_deposit_reminders: (query) =>
        called(query, 'insert')
          ? { data: null, error: options.claimError ?? null }
          : { data: options.ledger ?? [], error: null },
      customers: () => ({ data: GUEST, error: null }),
      notification_deliveries: (query) =>
        called(query, 'insert') ? { data: { id: 'delivery-1' }, error: null } : { data: null, error: null },
      notification_attempts: () => ({ data: null, error: null }),
    },
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(isEmailSuppressed).mockResolvedValue(false)
  vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: true } as never)
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 're_rem' } as never)
  vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM9' } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the reminder sweep', () => {
  it('claims the hold, then emails the guest a fresh payment link and the deadline', async () => {
    const db = buildDb()

    const result = await runDepositHoldReminders(db.client as never, NOW)

    expect(result).toEqual({ considered: 1, sent: 1, failed: 0, skipped: {} })
    const holds = db.queries.find((query) => query.table === 'table_bookings')!
    expect(argsOf(holds, 'gte')).toEqual([['hold_expires_at', at(2)]])
    expect(argsOf(holds, 'lte')).toEqual([['hold_expires_at', at(6)]])
    expect(argsOf(holds, 'eq')).toEqual([['status', 'pending_payment'], ['deposit_waived', false]])

    const claim = db.queries.filter((query) => query.table === 'table_booking_deposit_reminders' && called(query, 'insert'))
    expect(claim).toHaveLength(1)
    expect(argsOf(claim[0], 'insert')[0][0]).toEqual({ table_booking_id: 'tb-9', hold_expires_at: at(6) })
    // The claim is taken before anything is sent.
    expect(db.queries.indexOf(claim[0])).toBeLessThan(db.queries.findIndex((query) => query.table === 'notification_deliveries'))

    expect(createTablePaymentToken).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tableBookingId: 'tb-9', holdExpiresAt: at(6) }))
    expect(sendSMS).not.toHaveBeenCalled()
    const email = vi.mocked(sendEmail).mock.calls[0][0]
    expect(email).toEqual(expect.objectContaining({
      to: 'sam@example.com',
      commType: 'table_booking_deposit_reminder',
      tableBookingId: 'tb-9',
      idempotencyKey: `table_booking_deposit_reminder:tb-9:${at(6)}`,
      subject: 'Your deposit is due by Thursday 3 December 2026 at 7pm',
    }))
    expect(email.text).toContain(
      `Hi Sam, we're still holding your table for 6 people on ${expectedLongDate('2026-12-05')} at 7pm. Pay your deposit of £60.00 by Thursday 3 December 2026 at 7pm to keep it. If it isn't paid by then, the booking is cancelled.`
    )
    expect(email.text).toContain('Pay your deposit: https://l.the-anchor.pub/pay1')
  })

  it('describes a seasonal per-head deposit as the request did, never as the group rule', async () => {
    buildDb({
      rows: [booking({
        booking_type: 'regular',
        party_size: 2,
        deposit_amount: 30,
        deposit_refund_cutoff_days: 3,
        deposit_rule: 'period',
        deposit_basis: 'per_head',
        deposit_rate: 15,
      })],
    })

    await runDepositHoldReminders(createAdminClient() as never, NOW)

    const email = vi.mocked(sendEmail).mock.calls[0][0]
    expect(email.text).toContain("There's a £15 per person deposit, which comes off your bill.")
    expect(email.text).not.toContain('Groups of 15 or more')
  })

  it('never turns a flat per-booking deposit into a per-person rate', async () => {
    buildDb({
      rows: [booking({
        booking_type: 'regular',
        party_size: 2,
        deposit_amount: 30,
        deposit_refund_cutoff_days: 3,
        deposit_rule: 'period',
        deposit_basis: 'per_booking',
        deposit_rate: 30,
      })],
    })

    await runDepositHoldReminders(createAdminClient() as never, NOW)

    const email = vi.mocked(sendEmail).mock.calls[0][0]
    expect(email.text).toContain('The deposit comes off your bill.')
    expect(email.text).not.toContain('per person')
  })

  it('texts the same reminder when the email fails', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500' } as never)
    const db = buildDb()

    const result = await runDepositHoldReminders(db.client as never, NOW)

    expect(result.sent).toBe(1)
    expect(vi.mocked(sendSMS).mock.calls[0][1]).toContain(
      "The Anchor: Sam, we're still holding your table for 6 on Sat 5 Dec, 7:00 pm. Pay the £60.00 deposit by Thu 3 Dec, 7:00 pm to keep it: https://l.the-anchor.pub/pay1"
    )
  })

  it('sends nothing for a hold already reminded about', async () => {
    const db = buildDb({ ledger: [{ table_booking_id: 'tb-9', hold_expires_at: at(6) }] })

    const result = await runDepositHoldReminders(db.client as never, NOW)

    expect(result).toEqual({ considered: 1, sent: 0, failed: 0, skipped: { already_reminded: 1 } })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends nothing when another run claimed the hold first', async () => {
    const db = buildDb({ claimError: { code: '23505', message: 'duplicate key value' } })

    const result = await runDepositHoldReminders(db.client as never, NOW)

    expect(result.skipped).toEqual({ claimed_by_another_run: 1 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends nothing overnight', async () => {
    const overnight = new Date('2026-12-03T22:30:00Z')
    vi.setSystemTime(overnight)
    const db = buildDb({ rows: [booking({ hold_expires_at: new Date(overnight.getTime() + 5 * HOUR).toISOString(), created_at: new Date(overnight.getTime() - 19 * HOUR).toISOString() })] })

    const result = await runDepositHoldReminders(db.client as never, overnight)

    expect(result.skipped).toEqual({ quiet_hours: 1 })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('reminder wording renders', () => {
  it.each([
    ['GMT', '2026-12-05', '19:00:00', '2026-12-05T19:00:00.000Z', '2026-12-04T19:00:00.000Z'],
    ['British Summer Time', '2026-07-11', '19:30:00', '2026-07-11T18:30:00.000Z', '2026-07-10T18:30:00.000Z'],
    ['just after midnight, the clocks gone back', '2026-10-25', '00:15:00', '2026-10-25T00:15:00.000Z', '2026-10-24T22:15:00.000Z'],
  ])('%s', (_label, bookingDate, bookingTime, startDateTime, payByIso) => {
    const email = buildTableBookingDepositReminderEmail({
      firstName: 'Sam',
      bookingReference: 'TB-RENDER',
      bookingDate,
      bookingTime,
      startDateTime,
      partySize: 16,
      depositLabel: '£160.00',
      paymentLink: 'https://l.the-anchor.pub/pay1',
      payByIso,
      isChristmas: false,
      perPersonGbp: 10,
      refundCutoffDays: null,
    })
    assertCleanRender(email)
    expect(email.text).toContain(`Date: ${expectedLongDate(bookingDate)}`)
    expect(email.text).toContain('Groups of 15 or more: a £10 per person deposit, fully deducted from your bill.')

    const text = buildDepositHoldReminderText({
      firstName: 'Sam',
      partySize: 16,
      startDateTime,
      holdExpiresAt: payByIso,
      depositLabel: '£160.00',
      isOutsideSeating: false,
      paymentUrl: 'https://l.the-anchor.pub/pay1',
    })
    assertCleanText(text)
    expect(text).not.toContain('your booking time')
  })
})
