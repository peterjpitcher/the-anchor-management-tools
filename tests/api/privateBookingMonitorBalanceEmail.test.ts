import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, flags: {} as Record<string, boolean> }))

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))

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
import { SmsQueueService } from '@/services/sms-queue'
import { logger } from '@/lib/logger'
import { GET } from '@/app/api/cron/private-booking-monitor/route'

const mockedSendEmail = sendEmail as unknown as Mock
const mockedQueueAndSend = SmsQueueService.queueAndSend as unknown as Mock

// 10:00 in London on Sunday 20 September 2026. A balance due on Saturday 26 September is six days
// away: the first reminder ("due by"). Nothing is on a draft hold, so pass 1 sends nothing.
const NOW = new Date('2026-09-20T09:00:00.000Z')

function confirmedBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'confirmed',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900123',
    customer_mobile: '+447700900123',
    contact_email: 'host@example.com',
    event_date: '2026-10-10',
    event_type: 'Birthday party',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    total_amount: 0,
    calculated_total: 1000,
    gross_total: 1200,
    balance_remaining: 900,
    total_balance_paid: 300,
    deposit_amount: 250,
    balance_due_date: '2026-09-26',
    final_payment_date: null,
    ...overrides,
  }
}

function seed(options: {
  booking?: Record<string, unknown>
  deposit?: Record<string, unknown>
  payments?: Record<string, unknown>[]
  queue?: Record<string, unknown>[]
  customer?: Record<string, unknown>
} = {}) {
  const booking = confirmedBooking(options.booking)
  state.db = createFakeSupabase(
    {
      cron_job_runs: [],
      messages: [],
      private_bookings: [
        {
          id: booking.id,
          status: booking.status,
          invoice_id: null,
          invoice_deposit_treatment: null,
          deposit_amount: 250,
          deposit_paid_date: '2026-08-12T10:00:00.000Z',
          deposit_payment_method: 'paypal',
          ...options.deposit,
        },
      ],
      private_bookings_with_details: [booking],
      private_booking_payments: options.payments ?? [
        { id: 'pay-1', booking_id: 'booking-1', amount: 300, method: 'cash', created_at: '2026-09-01T18:00:00.000Z' },
      ],
      private_booking_sms_queue: options.queue ?? [],
      private_booking_send_idempotency: [],
      customers: [{ id: 'customer-1', email: null, email_status: null, email_deactivated_at: null, mobile_number: '+447700900123', ...options.customer }],
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

async function runMonitor() {
  const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor'))
  return { status: response.status, body: await response.json() }
}

describe('balance reminders by email, with the payments made', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    state.flags = { private_booking_balance_email_auto: true }
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
    mockedQueueAndSend.mockResolvedValue({ success: true, requiresApproval: true, queueId: 'queue-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emails straight away, with no approval step, listing each payment and how the balance is reached', async () => {
    seed()

    const first = await runMonitor()

    expect(first.status).toBe(200)
    expect(first.body.stats.balanceRemindersSent).toBe(1)
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.to).toBe('host@example.com')
    expect(email.commType).toBe('private_booking_balance_reminder_21day')
    expect(email.text).toContain('Your £900 balance and your final details (numbers, menus, suppliers) are due by 26 September 2026')
    expect(email.text).toContain('Event total: £1200')
    expect(email.text).toContain('Paid towards your bill so far: £300')
    expect(email.text).toContain('Balance due: £900')
    expect(email.text).toContain('Payments received\n12 August 2026: Deposit by PayPal, £250 (held separately from your bill)\n1 September 2026: Payment by cash, £300')
    expect(email.text).toContain('Date: Saturday, 10 October 2026')

    // The next day's run finds the reservation for this deadline and stage, and sends nothing more.
    state.db.tables.cron_job_runs.length = 0
    await runMonitor()
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
  })

  it('with no usable email, queues the text for approval as today, marked as queued after the switch', async () => {
    seed({ booking: { contact_email: null } })

    const result = await runMonitor()

    expect(result.body.stats.balanceRemindersSent).toBe(0)
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend.mock.calls[0][0]).toMatchObject({
      trigger_type: 'balance_reminder_21day',
      metadata: { balance_due_date: '2026-09-26', balance_email_auto: true },
    })
  })

  it('reminds a booking with only an email address, which before had no reminder at all', async () => {
    seed({ booking: { contact_phone: null, customer_mobile: null } })

    const result = await runMonitor()

    expect(result.body.stats.balanceRemindersSent).toBe(1)
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
  })

  it('never sends a reminder queued before the switch: a pending one for this stage blocks the email', async () => {
    seed({
      queue: [
        {
          id: 'old-1',
          booking_id: 'booking-1',
          trigger_type: 'balance_reminder_21day',
          status: 'pending',
          metadata: { balance_due_date: '2026-09-26' },
          created_at: '2026-09-19T09:00:00.000Z',
        },
      ],
    })

    const result = await runMonitor()

    expect(result.body.stats.balanceRemindersSent).toBe(0)
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
  })

  it('does not backfill: a deadline that has passed gets nothing, whatever stages were missed', async () => {
    seed({ booking: { balance_due_date: '2026-09-19' } })

    await runMonitor()

    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
  })

  it('a statement that does not add up sends no email; the text waits for approval instead', async () => {
    // The view says £850 is owed, but the ledger leaves £900: an email would show two balances.
    seed({ booking: { balance_remaining: 850 } })

    await runMonitor()

    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      'Balance reminder: payment statement does not add up, so no email goes with it',
      expect.objectContaining({ metadata: expect.objectContaining({ problem: 'balance_does_not_match' }) })
    )
  })

  it('a statement that does not add up, for a booking with no number, is left for the next run', async () => {
    seed({ booking: { balance_remaining: 850, contact_phone: null, customer_mobile: null } })

    await runMonitor()

    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
    expect(state.db.tables.private_booking_send_idempotency).toHaveLength(0)
  })

  it('when the email fails, the text is queued for approval, and nothing is lost', async () => {
    seed()
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })

    await runMonitor()

    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend.mock.calls[0][0].metadata).toMatchObject({ balance_email_auto: true })
  })

  it('with the flag off, exactly as today: the text waits for approval and carries no marker', async () => {
    state.flags = {}
    seed()

    await runMonitor()

    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).toHaveBeenCalledTimes(1)
    expect(mockedQueueAndSend.mock.calls[0][0].metadata).toEqual({ balance_due_date: '2026-09-26' })
  })

  it('with the flag off, a booking with no number is skipped as today', async () => {
    state.flags = {}
    seed({ booking: { contact_phone: null, customer_mobile: null } })

    await runMonitor()

    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedQueueAndSend).not.toHaveBeenCalled()
  })
})

describe('PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED still switches the balance pass off', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.resetModules()
  })

  it('sends no balance reminder by any channel when it is false', async () => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.stubEnv('PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED', 'false')
    vi.resetModules()
    state.flags = { private_booking_balance_email_auto: true }
    const { GET: gatedGet } = await import('@/app/api/cron/private-booking-monitor/route')
    const { sendEmail: gatedSendEmail } = await import('@/lib/email/emailService')
    seed()

    const response = await gatedGet(new Request('http://localhost/api/cron/private-booking-monitor'))

    expect(response.status).toBe(200)
    expect(gatedSendEmail).not.toHaveBeenCalled()
  })
})
