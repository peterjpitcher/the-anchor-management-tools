import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, flagOn: true }))

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))

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

vi.mock('@/lib/cron-run-results', () => ({
  persistCronRunResult: vi.fn().mockResolvedValue(undefined),
  recoverCronRunLock: vi.fn().mockResolvedValue({ result: 'already_running', runId: 'run-1' }),
}))

vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendPrivateBookingOutcomeEmail: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/lib/sms/review-once', () => ({
  getFirstVisitReviewEligibleCandidateKeys: vi.fn(async () => new Set()),
  reviewVisitCandidateKey: vi.fn(() => 'key'),
}))

vi.mock('@/lib/events/review-link', () => ({
  getGoogleReviewLink: vi.fn(async () => 'https://g.page/r/test'),
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
import { SmsQueueService } from '@/services/sms-queue'
import { GET } from '@/app/api/cron/private-booking-monitor/route'

const mockedSendEmail = sendEmail as unknown as Mock
const mockedQueueAndSend = SmsQueueService.queueAndSend as unknown as Mock

// 10:00 in London on Sunday 20 September 2026. The hold below expires in 5.6 days: the 7-day window.
const NOW = new Date('2026-09-20T09:00:00.000Z')

function seed(booking: Record<string, unknown>) {
  state.db = createFakeSupabase(
    {
      cron_job_runs: [],
      messages: [],
      private_bookings: [booking],
      private_bookings_with_details: [],
      private_booking_sms_queue: [],
      private_booking_send_idempotency: [],
      customers: [{ id: 'customer-1', email: null, email_status: null, email_deactivated_at: null, mobile_number: null }],
      email_suppressions: [],
      notification_deliveries: [],
      notification_attempts: [],
      private_booking_audit: [],
    },
    {
      unique: {
        cron_job_runs: (row) => `${row.job_name}:${row.run_key}`,
        private_booking_send_idempotency: (row) => row.idempotency_key,
      },
    }
  )
}

function draftWithEmailOnly(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'draft',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_name: 'Alex Smith',
    contact_phone: null,
    contact_email: 'host@example.com',
    hold_expiry: '2026-09-25T22:30:00.000Z',
    event_date: '2026-10-03',
    event_type: 'Birthday party',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 40,
    deposit_amount: 250,
    internal_notes: null,
    date_tbd: false,
    deposit_paid_date: null,
    ...overrides,
  }
}

async function runMonitor() {
  const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor'))
  return { status: response.status, body: await response.json() }
}

describe('private booking monitor, email first', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    state.flagOn = true
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
    mockedQueueAndSend.mockResolvedValue({ success: true, sent: true, queueId: 'queue-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reminds a guest with only an email address, by email, and a re-run sends nothing more', async () => {
    seed(draftWithEmailOnly())

    const first = await runMonitor()

    expect(first.status).toBe(200)
    expect(first.body.stats.remindersSent).toBe(1)
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.to).toBe('host@example.com')
    expect(email.commType).toBe('private_booking_deposit_reminder_7day')
    expect(email.text).toContain('expires in 6 days, on 25 September 2026')
    expect(email.text).toContain('Pay the £250 deposit')

    // The next day's run: the day's lock is new, but the send reservation for this hold window
    // is not, so nothing else goes.
    state.db.tables.cron_job_runs.length = 0
    const second = await runMonitor()
    expect(second.status).toBe(200)
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
  })

  it('with the flag off, a guest with no number is skipped exactly as today', async () => {
    state.flagOn = false
    seed(draftWithEmailOnly())

    const result = await runMonitor()

    expect(result.status).toBe(200)
    expect(result.body.stats.remindersSent).toBe(0)
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
  })

  it('reads the flag once for the run, so a booking it chose for email is sent by email', async () => {
    seed(draftWithEmailOnly())
    // The run's read says on; any later read in the same run would have failed and said off, and
    // this guest has no number, so a second read would have left them with nothing.
    const flagMock = vi.mocked(isMessagingFlagOn)
    const original = flagMock.getMockImplementation()!
    let emailFirstReads = 0
    flagMock.mockImplementation(async (key) => {
      if (key !== 'private_booking_email_first') return false
      emailFirstReads += 1
      return emailFirstReads === 1
    })

    try {
      const result = await runMonitor()

      expect(result.body.stats.remindersSent).toBe(1)
      expect(mockedSendEmail).toHaveBeenCalledTimes(1)
      expect(mockedQueueAndSend).not.toHaveBeenCalled()
      expect(emailFirstReads).toBe(1)
    } finally {
      flagMock.mockImplementation(original)
    }
  })

  it('a guest with a number but no usable email still gets the text', async () => {
    seed(draftWithEmailOnly({ contact_phone: '+447700900123', contact_email: null }))

    const result = await runMonitor()

    expect(result.body.stats.remindersSent).toBe(1)
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledWith(expect.objectContaining({ trigger_type: 'deposit_reminder_7day' }))
  })
})
