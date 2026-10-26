import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * Review BK-005: a paid deposit that could not confirm the booking (no room, too many guests, a
 * clash or a risk review) left it a draft, and the monitor's balance, day-before and outcome
 * passes read confirmed bookings only. The guest had paid and the event was going ahead, but got
 * no balance reminder and no reminder the day before, and the manager got no outcome email.
 *
 * The fake's `or()` filters nothing, so each test also checks the filter the pass sent: confirmed
 * bookings, and drafts with their deposit paid, and nothing else.
 */

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn(async () => undefined) }))
vi.mock('@/lib/cron-run-results', () => ({
  persistCronRunResult: vi.fn().mockResolvedValue(undefined),
  recoverCronRunLock: vi.fn().mockResolvedValue({ result: 'already_running', runId: 'run-1' }),
}))
vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendPrivateBookingOutcomeEmail: vi.fn(async () => ({ success: true, tokenIds: [] })),
}))
vi.mock('@/lib/sms/review-once', () => ({
  getFirstVisitReviewEligibleCandidateKeys: vi.fn(async () => new Set()),
  reviewVisitCandidateKey: vi.fn(() => 'key'),
}))
vi.mock('@/lib/events/review-link', () => ({ getGoogleReviewLink: vi.fn(async () => 'https://g.page/r/test') }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
// The daily manager email has its own tests (tests/services/privateHireAttention.test.ts).
vi.mock('@/services/private-bookings/attention', () => ({
  runHireAttentionCheck: vi.fn(async () => ({ listed: 0, emailed: false })),
}))
vi.mock('@/services/sms-queue', async () => {
  const actual = await vi.importActual<typeof import('@/services/sms-queue')>('@/services/sms-queue')
  return {
    shouldAutoSendPrivateBookingSms: actual.shouldAutoSendPrivateBookingSms,
    SmsQueueService: { queueAndSend: vi.fn() },
  }
})

import { SmsQueueService } from '@/services/sms-queue'
import { sendPrivateBookingOutcomeEmail } from '@/lib/private-bookings/manager-notifications'
import { GET } from '@/app/api/cron/private-booking-monitor/route'

const mockedQueueAndSend = SmsQueueService.queueAndSend as unknown as Mock
const mockedOutcomeEmail = sendPrivateBookingOutcomeEmail as unknown as Mock

// 10:00 in London on Sunday 20 September 2026: tomorrow is the 21st, yesterday the 19th.
const NOW = new Date('2026-09-20T09:00:00.000Z')
const LIVE_FILTER = 'status.eq.confirmed,and(status.eq.draft,deposit_paid_date.not.is.null)'

function paidDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-paid-draft',
    status: 'draft',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900123',
    contact_email: null,
    hold_expiry: null,
    event_date: '2026-09-21',
    event_type: 'Birthday party',
    start_time: '19:00:00',
    end_time: '23:00:00',
    end_time_next_day: false,
    guest_count: 70,
    deposit_amount: 250,
    deposit_paid_date: '2026-09-10T12:00:00.000Z',
    internal_notes: null,
    date_tbd: false,
    post_event_outcome: 'pending',
    outcome_email_sent_at: null,
    review_sms_sent_at: null,
    review_processed_at: null,
    ...overrides,
  }
}

function seed(tables: { private_bookings?: Record<string, unknown>[]; private_bookings_with_details?: Record<string, unknown>[] }) {
  state.db = createFakeSupabase(
    {
      cron_job_runs: [],
      messages: [],
      private_bookings: tables.private_bookings ?? [],
      private_bookings_with_details: tables.private_bookings_with_details ?? [],
      private_booking_sms_queue: [],
      private_booking_send_idempotency: [],
      customers: [{ id: 'customer-1', email: null, email_status: null, email_deactivated_at: null, mobile_number: '+447700900123' }],
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

/** Records every `.or()` filter, by table and by the columns selected. */
function recordOrFilters(): Array<{ table: string; columns: string; filter: string }> {
  const calls: Array<{ table: string; columns: string; filter: string }> = []
  const originalFrom = state.db.from
  state.db.from = (table: string) => {
    const builder = originalFrom(table)
    let columns = ''
    const originalSelect = builder.select
    const originalOr = builder.or
    builder.select = (selected?: string) => {
      columns = selected ?? ''
      return originalSelect(selected)
    }
    builder.or = (filter: string) => {
      calls.push({ table, columns, filter })
      return originalOr(filter)
    }
    return builder
  }
  return calls
}

async function runMonitor() {
  const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor'))
  return { status: response.status, body: await response.json() }
}

describe('private booking monitor: paid drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    mockedQueueAndSend.mockResolvedValue({ success: true, sent: true, queueId: 'queue-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the reminder the day before to a paid draft', async () => {
    seed({ private_bookings: [paidDraft()] })
    const filters = recordOrFilters()

    const result = await runMonitor()

    expect(result.status).toBe(200)
    expect(mockedQueueAndSend).toHaveBeenCalledWith(
      expect.objectContaining({ booking_id: 'booking-paid-draft', trigger_type: 'event_reminder_1d' }),
    )
    expect(filters).toContainEqual(expect.objectContaining({ table: 'private_bookings', filter: LIVE_FILTER }))
  })

  it('emails the manager the outcome links the morning after a paid draft', async () => {
    seed({ private_bookings: [paidDraft({ event_date: '2026-09-19' })] })
    const filters = recordOrFilters()

    await runMonitor()

    expect(mockedOutcomeEmail).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'booking-paid-draft' }))
    expect(filters.some((call) => call.columns.includes('outcome_email_sent_at') && call.filter === LIVE_FILTER)).toBe(true)
  })

  it('sends the balance reminder to a paid draft', async () => {
    seed({
      private_bookings_with_details: [
        {
          ...paidDraft({ event_date: '2026-10-11' }),
          customer_mobile: '+447700900123',
          balance_due_date: '2026-09-27',
          total_amount: 900,
          calculated_total: 900,
          gross_total: 1080,
          balance_remaining: 1080,
          total_balance_paid: 0,
          final_payment_date: null,
        },
      ],
    })
    const filters = recordOrFilters()

    await runMonitor()

    expect(mockedQueueAndSend).toHaveBeenCalledWith(
      expect.objectContaining({ booking_id: 'booking-paid-draft', trigger_type: 'balance_reminder_21day' }),
    )
    expect(filters).toContainEqual(expect.objectContaining({ table: 'private_bookings_with_details', filter: LIVE_FILTER }))
  })
})
