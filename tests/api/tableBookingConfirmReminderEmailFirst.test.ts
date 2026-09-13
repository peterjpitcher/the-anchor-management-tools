import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The "are you still coming?" sweep under the messaging flag table_confirm_reminder_email_first
 * (owner decision, 11 September 2026). With the flag on the reminder goes by email first, with
 * one short link shared by the email and a fallback text, and guests with only an email address
 * are asked too. The short link is minted for real here, through buildGuestShortLink, so the
 * test sees where it points.
 */

vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email/logging', () => ({ isEmailSuppressed: vi.fn() }))
vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
  sendWhatsApp: vi.fn(),
  isCustomerSmsSendAllowed: vi.fn(),
  isCustomerWhatsAppSendAllowed: vi.fn(),
}))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: vi.fn() } }))
vi.mock('@/lib/unified-job-queue', () => ({ jobQueue: { enqueue: vi.fn() } }))
const CONFIRM_PAGE_URL = 'https://management.example.com/g/conf-token/confirm-booking'
vi.mock('@/lib/table-bookings/manage-booking', () => ({
  createBookingConfirmToken: vi.fn(async () => ({ url: CONFIRM_PAGE_URL, rawToken: 'conf-token', expiresAt: '2026-09-12T18:30:00Z' })),
}))
const createShortLinkInternal = vi.hoisted(() => vi.fn())
vi.mock('@/services/short-links', () => ({ ShortLinkService: { createShortLinkInternal } }))

import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { sendEmail } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import { isCustomerSmsSendAllowed, sendSMS } from '@/lib/twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuditService } from '@/services/audit'
import { jobQueue } from '@/lib/unified-job-queue'
import { GET } from '@/app/api/cron/table-booking-confirm/route'
import { buildTableBookingConfirmReminderEmail } from '@/lib/table-bookings/guest-emails'
import { argsOf, called, createRecordingSupabase } from '../mocks/recordingSupabase'
import { assertCleanRender, assertCleanText, expectedLongDate } from '../mocks/emailRenderChecks'

const SHORT = 'https://l.the-anchor.pub/cf1'

const JANE = {
  id: 'cust-1',
  first_name: 'Jane',
  mobile_e164: '+447700900001',
  mobile_number: '07700900001',
  sms_status: 'active',
  sms_opt_in: true,
  email: 'jane@example.com',
  email_status: 'valid',
  email_deactivated_at: null,
}

function bookingRow(customer: Record<string, unknown> | null = JANE) {
  return {
    id: 'tb-1',
    booking_reference: 'TB-0001',
    booking_date: '2026-09-12',
    booking_time: '19:30:00',
    party_size: 4,
    status: 'confirmed',
    guest_confirmed_at: null,
    customer_id: 'cust-1',
    customers: customer,
  }
}

function buildDb(customer: Record<string, unknown> | null = JANE) {
  const db = createRecordingSupabase({
    tables: {
      table_bookings: () => ({ data: [bookingRow(customer)], error: null }),
      table_booking_confirm_reminders: (query) => (called(query, 'insert') ? { error: null } : { data: [], error: null }),
      notification_deliveries: (query) =>
        called(query, 'insert') ? { data: { id: 'delivery-1' }, error: null } : { data: null, error: null },
      notification_attempts: () => ({ data: null, error: null }),
    },
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return db
}

async function sweep() {
  const response = await GET(new Request('http://localhost/api/cron/table-booking-confirm') as never)
  return response.json()
}

const TEXT = 'The Anchor: Jane, your table for 4 is Saturday 12 September at 7:30pm. Still coming? Tap to confirm or cancel: '

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  // Friday 11 September 2026, 11:00 BST, when the sweep runs; the bookings are for tomorrow.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-11T10:00:00Z'))
  vi.mocked(isMessagingFlagOn).mockImplementation(async (key) => key === 'table_confirm_reminder_email_first')
  vi.mocked(isEmailSuppressed).mockResolvedValue(false)
  vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: true } as never)
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 're_conf' } as never)
  vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM1' } as never)
  vi.mocked(jobQueue.enqueue).mockResolvedValue({ success: true, jobId: 'job-1' } as never)
  createShortLinkInternal.mockResolvedValue({ short_code: 'cf1', full_url: SHORT, already_exists: false })
})

describe('tap-to-confirm reminder, email first (flag on)', () => {
  it('emails a guest with a usable address, with the short link to the page that only asks', async () => {
    buildDb()

    const payload = await sweep()

    expect(payload).toEqual(expect.objectContaining({ success: true, sent: 1, failed: 0 }))
    expect(jobQueue.enqueue).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
    const email = vi.mocked(sendEmail).mock.calls[0][0]
    expect(email).toEqual(
      expect.objectContaining({
        to: 'jane@example.com',
        subject: 'Are you still coming? Your table at The Anchor on Saturday 12 September 2026',
        commType: 'table_booking_confirm_reminder',
        idempotencyKey: 'table_booking_confirm_reminder:tb-1',
        tableBookingId: 'tb-1',
      })
    )
    expect(email.text).toContain(`Confirm or cancel your booking: ${SHORT}`)
    // The short link resolves to the existing GET page, never to the POST that answers.
    expect(createShortLinkInternal).toHaveBeenCalledTimes(1)
    expect(createShortLinkInternal.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        destination_url: CONFIRM_PAGE_URL,
        metadata: expect.objectContaining({ guest_link_kind: 'booking_confirm', table_booking_id: 'tb-1' }),
      })
    )
  })

  it('texts the same question with the same short link when the email fails, and records both attempts', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500' } as never)
    const db = buildDb()

    const payload = await sweep()

    expect(payload.sent).toBe(1)
    const [to, body, options] = vi.mocked(sendSMS).mock.calls[0]
    expect(to).toBe('+447700900001')
    expect(body).toBe(`${TEXT}${SHORT}`)
    assertCleanText(body)
    expect(options?.metadata).toEqual({ table_booking_id: 'tb-1', template_key: 'table_booking_confirm_reminder' })
    const attempts = db.queries
      .filter((query) => query.table === 'notification_attempts' && called(query, 'insert'))
      .map((query) => argsOf(query, 'insert')[0][0] as Record<string, unknown>)
    expect(attempts.map((row) => [row.channel, row.status])).toEqual([
      ['email', 'failed'],
      ['sms', 'sent'],
    ])
  })

  it('now asks a guest who has an email address and no mobile', async () => {
    buildDb({ ...JANE, mobile_e164: null, mobile_number: null, sms_status: null })

    const payload = await sweep()

    expect(payload).toEqual(expect.objectContaining({ sent: 1, skipped: 0 }))
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('texts a guest whose address has bounced, as today', async () => {
    buildDb({ ...JANE, email_status: 'bounced' })

    await sweep()

    expect(sendEmail).not.toHaveBeenCalled()
    expect(vi.mocked(sendSMS).mock.calls[0][1]).toBe(`${TEXT}${SHORT}`)
  })

  it('counts a reminder that reached nobody as failed and writes the audit row', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500' } as never)
    vi.mocked(sendSMS).mockResolvedValue({ success: false, error: 'Twilio 21211' } as never)
    buildDb()

    const payload = await sweep()

    expect(payload).toEqual(expect.objectContaining({ sent: 0, failed: 1 }))
    expect(vi.mocked(AuditService.logAuditEvent).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        operation_type: 'table_booking.notification_failed',
        resource_id: 'tb-1',
        additional_info: expect.objectContaining({ comm_type: 'table_booking_confirm_reminder' }),
      })
    )
  })
})

describe('tap-to-confirm reminder with the flag off: exactly today', () => {
  beforeEach(() => {
    vi.mocked(isMessagingFlagOn).mockResolvedValue(false)
  })

  it('queues the text with the long link, reads no email fields and sends no email', async () => {
    const db = buildDb()

    const payload = await sweep()

    expect(payload).toEqual(expect.objectContaining({ sent: 1 }))
    expect(jobQueue.enqueue).toHaveBeenCalledWith('send_sms', {
      to: '+447700900001',
      message: `${TEXT}${CONFIRM_PAGE_URL}`,
      customer_id: 'cust-1',
      booking_id: 'tb-1',
      metadata: { table_booking_id: 'tb-1', template_key: 'table_booking_confirm_reminder' },
    })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(createShortLinkInternal).not.toHaveBeenCalled()
    const bookingsQuery = db.queries.find((query) => query.table === 'table_bookings')!
    expect(String(argsOf(bookingsQuery, 'select')[0][0])).toContain('customers(id, first_name, mobile_e164, mobile_number, sms_status)')
  })

  it('still skips a guest with no mobile', async () => {
    buildDb({ ...JANE, mobile_e164: null, mobile_number: null })

    const payload = await sweep()

    expect(payload).toEqual(expect.objectContaining({ sent: 0, skipped: 1, skipReasons: { no_mobile: 1 } }))
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('tap-to-confirm email renders', () => {
  it.each([
    ['2026-09-12', '19:30:00', '7:30pm', '4 people'],
    ['2026-10-25', '12:00:00', '12pm', '1 person'],
  ])('booking %s at %s: the question, the link, the right weekday, no broken values', (bookingDate, bookingTime, time, party) => {
    const email = buildTableBookingConfirmReminderEmail({
      firstName: 'Jane',
      bookingReference: 'TB-0001',
      bookingDate,
      bookingTime,
      partySize: party === '1 person' ? 1 : 4,
      confirmUrl: SHORT,
    })

    assertCleanRender(email)
    expect(email.subject).toBe(`Are you still coming? Your table at The Anchor on ${expectedLongDate(bookingDate)}`)
    expect(email.text).toContain(`Hi Jane, your table for ${party} is booked for ${expectedLongDate(bookingDate)} at ${time}.`)
    expect(email.text).toContain('Still coming? Tap the link to confirm or cancel.')
    expect(email.html).toContain(`href="${SHORT}"`)
  })
})
