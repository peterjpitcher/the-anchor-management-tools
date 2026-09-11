import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The seasonal pre-order booker reminder under the messaging flag table_preorder_email_first.
 * Today it sends a text (through the jobs queue) AND an email with no comm type and no address
 * health check. With the flag on it sends one message: email first, text as the fallback.
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
vi.mock('@/lib/table-bookings/manage-booking', () => ({
  createTableManageToken: vi.fn(async () => ({ url: 'https://management.example.com/g/tok-1/table-manage' })),
}))
vi.mock('@/lib/guest/guest-short-link', () => ({
  buildGuestShortLink: vi.fn(async () => ({ url: 'https://l.the-anchor.pub/food1', shortened: true })),
}))
vi.mock('@/lib/table-bookings/preorder', () => ({
  PREORDER_BOOKER_REMINDER_DAYS: 10,
  isPreorderEnabled: vi.fn(async () => true),
  decidePreorderChases: vi.fn(() => ['booker_reminder']),
  describePreorderGaps: vi.fn(() => '2 main courses'),
  getPreorderCompleteness: vi.fn(() => ({ complete: false })),
  getPreorderCutoff: vi.fn(() => ({ closed: false })),
  loadPreorderOrder: vi.fn(async () => ({ requiresPreorder: true })),
}))

import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { sendEmail } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import { isCustomerSmsSendAllowed, sendSMS } from '@/lib/twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuditService } from '@/services/audit'
import { jobQueue } from '@/lib/unified-job-queue'
import { GET } from '@/app/api/cron/preorder-reminders/route'
import { buildTableBookingPreorderReminderEmail } from '@/lib/table-bookings/guest-emails'
import { argsOf, called, createRecordingSupabase } from '../mocks/recordingSupabase'
import { assertCleanRender, assertCleanText, expectedLongDate } from '../mocks/emailRenderChecks'

const BOOKING = {
  id: 'xmas-1',
  booking_reference: 'TB-XMAS1',
  booking_date: '2026-12-12',
  booking_time: '19:00:00',
  party_size: 6,
  customer_id: 'cust-7',
  booking_period_id: 'period-xmas',
  booking_period_name: 'Christmas 2026',
}

const ALEX = {
  id: 'cust-7',
  first_name: 'Alex',
  last_name: 'Guest',
  mobile_e164: '+447700900777',
  mobile_number: '07700900777',
  email: 'alex@example.com',
  sms_status: 'active',
  sms_opt_in: true,
  email_status: 'valid',
  email_deactivated_at: null,
}

function buildDb(customer: Record<string, unknown> = ALEX) {
  const db = createRecordingSupabase({
    tables: {
      booking_periods: () => ({ data: [{ id: 'period-xmas', preorder_cutoff_days: 7 }], error: null }),
      table_bookings: () => ({ data: [BOOKING], error: null }),
      booking_preorder_reminders: (query) => (called(query, 'insert') ? { error: null } : { data: [], error: null }),
      customers: () => ({ data: customer, error: null }),
      notification_deliveries: (query) =>
        called(query, 'insert') ? { data: { id: 'delivery-1' }, error: null } : { data: null, error: null },
      notification_attempts: () => ({ data: null, error: null }),
    },
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return db
}

async function runSweep() {
  const response = await GET(new Request('http://localhost/api/cron/preorder-reminders') as never)
  return response.json()
}

const TODAYS_TEXT_START = 'The Anchor: Alex, we still need the food choices for your booking on '

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  // Saturday 5 December 2026, noon: the sweep's own seven-day chase window, pinned so the test
  // does not depend on the day it runs.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-12-05T12:00:00Z'))
  vi.mocked(isMessagingFlagOn).mockImplementation(async (key) => key === 'table_preorder_email_first')
  vi.mocked(isEmailSuppressed).mockResolvedValue(false)
  vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: true } as never)
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 're_food' } as never)
  vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM7' } as never)
  vi.mocked(jobQueue.enqueue).mockResolvedValue({ success: true, jobId: 'job-1' } as never)
})

describe('pre-order booker reminder, email first (flag on)', () => {
  it('emails a booker with a usable address and sends no text', async () => {
    buildDb()

    const payload = await runSweep()

    expect(payload.result.bookerReminders).toBe(1)
    expect(payload.result.failed).toBe(0)
    expect(jobQueue.enqueue).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const email = vi.mocked(sendEmail).mock.calls[0][0]
    expect(email).toEqual(
      expect.objectContaining({
        to: 'alex@example.com',
        subject: 'Your food choices for TB-XMAS1',
        // Both missing from the old direct email.
        commType: 'table_booking_preorder_reminder',
        idempotencyKey: 'table_booking_preorder_reminder:xmas-1',
        tableBookingId: 'xmas-1',
      })
    )
    expect(email.text).toContain('Choose your food here: https://l.the-anchor.pub/food1')
  })

  it('texts today\'s words when the email fails, and records both attempts', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500' } as never)
    const db = buildDb()

    const payload = await runSweep()

    expect(payload.result.bookerReminders).toBe(1)
    const [to, body, options] = vi.mocked(sendSMS).mock.calls[0]
    expect(to).toBe('+447700900777')
    expect(body.startsWith(TODAYS_TEXT_START)).toBe(true)
    expect(body).toContain('Saturday 12 December at 7pm. Every guest needs a main course. Choose here: https://l.the-anchor.pub/food1')
    assertCleanText(body)
    expect(options?.metadata).toEqual({ table_booking_id: 'xmas-1', template_key: 'table_booking_preorder_reminder' })
    const attempts = db.queries
      .filter((query) => query.table === 'notification_attempts' && called(query, 'insert'))
      .map((query) => argsOf(query, 'insert')[0][0] as Record<string, unknown>)
    expect(attempts.map((row) => [row.channel, row.status])).toEqual([
      ['email', 'failed'],
      ['sms', 'sent'],
    ])
  })

  it('texts a booker with a bounced address, as today', async () => {
    buildDb({ ...ALEX, email_status: 'bounced' })

    await runSweep()

    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('counts a reminder that reached nobody as failed and writes the audit row', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500' } as never)
    vi.mocked(sendSMS).mockResolvedValue({ success: false, error: 'Twilio down' } as never)
    buildDb()

    const payload = await runSweep()

    expect(payload.result.failed).toBe(1)
    expect(payload.result.bookerReminders).toBe(0)
    expect(vi.mocked(AuditService.logAuditEvent).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        operation_type: 'table_booking.notification_failed',
        resource_id: 'xmas-1',
        additional_info: expect.objectContaining({ comm_type: 'table_booking_preorder_reminder' }),
      })
    )
  })
})

describe('pre-order booker reminder with the flag off: exactly today', () => {
  it('queues the text and sends the old email alongside it', async () => {
    vi.mocked(isMessagingFlagOn).mockResolvedValue(false)
    buildDb()

    const payload = await runSweep()

    expect(payload.result.bookerReminders).toBe(1)
    expect(jobQueue.enqueue).toHaveBeenCalledWith('send_sms', {
      to: '+447700900777',
      message: `${TODAYS_TEXT_START}Saturday 12 December at 7pm. Every guest needs a main course. Choose here: https://l.the-anchor.pub/food1`,
      customer_id: 'cust-7',
      booking_id: 'xmas-1',
      metadata: { table_booking_id: 'xmas-1', template_key: 'table_booking_preorder_reminder' },
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const email = vi.mocked(sendEmail).mock.calls[0][0]
    expect(email.subject).toBe('Your food choices for TB-XMAS1')
    expect(email.commType).toBeUndefined()
    expect(sendSMS).not.toHaveBeenCalled()
  })
})

describe('pre-order reminder email renders', () => {
  it.each([
    ['2026-12-12', '19:00:00', '7pm'],
    ['2026-11-10', '12:30:00', '12:30pm'],
  ])('booking %s at %s: every fact of the text, the right weekday, no broken values', (bookingDate, bookingTime, time) => {
    const email = buildTableBookingPreorderReminderEmail({
      firstName: 'Alex',
      bookingReference: 'TB-XMAS1',
      bookingDate,
      bookingTime,
      partySize: 6,
      manageLink: 'https://l.the-anchor.pub/food1',
    })

    assertCleanRender(email)
    expect(email.text).toContain(
      `Hi Alex, we still need the food choices for your booking at The Anchor on ${expectedLongDate(bookingDate)} at ${time} (reference TB-XMAS1).`
    )
    expect(email.text).toContain('Every guest needs to choose a main course.')
    expect(email.text).toContain('Party size: 6 people')
    expect(email.text).toContain('Prefer to do it over the telephone? Ring us on 01753 682707.')
    expect(email.html).toContain('href="https://l.the-anchor.pub/food1"')
  })
})
