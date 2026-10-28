import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/cron-run-results', () => ({
  persistCronRunResult: vi.fn().mockResolvedValue(undefined),
  recoverCronRunLock: vi.fn().mockResolvedValue({ result: 'already_running', runId: 'run-1' }),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true, sid: 'SM1' }),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/messaging/flags', () => ({
  readMessagingFlagState: vi.fn().mockResolvedValue({ state: 'off' }),
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn().mockResolvedValue({ url: 'https://l.the-anchor.pub/abc123' }),
}))

vi.mock('@/lib/sms/review-once', () => ({
  hasCustomerReviewed: vi.fn().mockResolvedValue(new Set<string>()),
  getFirstVisitReviewEligibleCandidateKeys: vi.fn(),
  reviewVisitCandidateKey: (candidate: { channel: string; bookingId: string }) =>
    `${candidate.channel}:${candidate.bookingId}`,
}))

vi.mock('@/lib/sms/cross-promo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms/cross-promo')>()
  return {
    ...actual,
    sendCrossPromoForEvent: vi.fn().mockResolvedValue({ sent: 0, skipped: 0, errors: 0 }),
    sendFollowUpForEvent: vi.fn().mockResolvedValue({ sent: 0, skipped: 0, errors: 0 }),
    hasReachedDailyPromoLimit: vi.fn().mockResolvedValue(false),
  }
})

const emails = vi.hoisted(() => ({ sendEventReminderEmail: vi.fn() }))
vi.mock('@/lib/email/event-ticket-emails', () => ({ sendEventReminderEmail: emails.sendEventReminderEmail }))

vi.mock('@/lib/guest/tokens', () => ({
  createGuestToken: vi.fn().mockResolvedValue({ rawToken: 'raw', hashedToken: 'hashed' }),
}))
vi.mock('@/lib/guest/review-short-link', () => ({
  buildGuestReviewUrl: vi.fn().mockResolvedValue({ url: 'https://l.the-anchor.pub/rev123', shortened: true }),
}))
vi.mock('@/lib/events/review-link', () => ({
  getGoogleReviewLink: vi.fn().mockResolvedValue('https://g.page/r/review'),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { getFirstVisitReviewEligibleCandidateKeys } from '@/lib/sms/review-once'
import { GET } from '@/app/api/cron/event-guest-engagement/route'
import { called, createRecordingSupabase, inValues } from '../mocks/recordingSupabase'

/**
 * Release 17 of the customer bookings review (24 October 2026):
 *  - BK-086, owner decision D14: the day-before reminder goes by email first, a text only when no
 *    email could go, and it still goes on nights with promotional texts switched off.
 *  - BK-087: one review ask per night; on a night that used check-in only guests who checked in
 *    are asked, and the ask names the event's day rather than always "last night".
 */

type Row = Record<string, unknown>

function booking(overrides: { id?: string; customer?: Row; event?: Row } & Row = {}): Row {
  const { customer, event, ...rest } = overrides
  return {
    id: 'booking-1',
    created_at: '2026-09-01T10:00:00Z',
    customer_id: 'customer-1',
    event_id: 'event-1',
    seats: 2,
    is_reminder_only: false,
    status: 'confirmed',
    review_sms_sent_at: null,
    review_window_closes_at: null,
    review_suppressed_at: null,
    event_seating_type: 'seated',
    event: {
      id: 'event-1',
      name: 'Music Bingo',
      start_datetime: '2026-09-16T18:30:00Z',
      date: null,
      time: null,
      event_status: 'scheduled',
      promo_sms_enabled: true,
      booking_mode: 'communal',
      payment_mode: 'cash_only',
      price: 5,
      price_per_seat: null,
      is_free: false,
      doors_time: null,
      ...(event ?? {}),
    },
    customer: {
      id: 'customer-1',
      first_name: 'Sam',
      mobile_number: '+447700900123',
      email: 'sam@example.com',
      sms_status: 'active',
      email_status: null,
      email_deactivated_at: null,
      ...(customer ?? {}),
    },
    ...rest,
  }
}

async function runCronAt(instant: string, bookings: Row[], checkIns: Row[] = []) {
  vi.setSystemTime(new Date(instant))

  const db = createRecordingSupabase({
    tables: {
      cron_job_runs: (query) => {
        if (called(query, 'insert')) return { data: { id: 'run-1' }, error: null }
        return { data: null, error: null }
      },
      messages: () => ({ data: [], count: 0, error: null }),
      events: () => ({ data: [], error: null }),
      event_check_ins: () => ({ data: checkIns, error: null }),
      bookings: (query) =>
        !called(query, 'update') && inValues(query, 'status').includes('confirmed')
          ? { data: bookings, error: null }
          : { data: [], error: null },
    },
    defaultAnswer: () => ({ data: [], count: 0, error: null }),
    rpc: () => ({ data: [], error: null }),
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)

  const request = new Request('http://localhost/api/cron/event-guest-engagement') as never as Parameters<typeof GET>[0]
  ;(request as unknown as { nextUrl: URL }).nextUrl = new URL('http://localhost')

  const response = await GET(request)
  return { payload: await response.json(), db }
}

function textsFor(templateKey: string): string[] {
  return vi
    .mocked(sendSMS)
    .mock.calls.filter(([, , options]) => options?.metadata?.template_key === templateKey)
    .map(([, body]) => body)
}

describe('day-before reminder: email first (BK-086, D14)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(getFirstVisitReviewEligibleCandidateKeys).mockResolvedValue(new Set<string>())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emails a guest with a usable address and sends no text', async () => {
    emails.sendEventReminderEmail.mockResolvedValue({ success: true, messageId: 'email-1' })

    const { payload } = await runCronAt('2026-09-15T18:30:00Z', [booking()])

    expect(emails.sendEventReminderEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bookingId: 'booking-1',
      reminderDay: 'tomorrow',
    }))
    expect(textsFor('event_reminder_1d')).toEqual([])
    expect(payload.reminders).toEqual(expect.objectContaining({ sent1d: 1, emailed1d: 1 }))
  })

  it('texts, in the wording for the night, when no email could go', async () => {
    emails.sendEventReminderEmail.mockResolvedValue({ success: false, skipped: true })

    await runCronAt('2026-09-15T18:30:00Z', [booking({ customer: { email: null } })])

    expect(textsFor('event_reminder_1d')).toEqual([
      'The Anchor: Sam, Music Bingo is tomorrow, Wed 16 Sept, 7:30 pm. Your 2 places are booked. Seating is shared on the night. Bring cash: £5 each. Come a bit early tomorrow if you fancy a drink. Change: https://l.the-anchor.pub/abc123',
    ])
  })

  it('texts when the email send fails', async () => {
    emails.sendEventReminderEmail.mockResolvedValue({ success: false, error: 'provider down' })

    await runCronAt('2026-09-15T18:30:00Z', [booking()])

    expect(textsFor('event_reminder_1d')).toHaveLength(1)
  })

  it('sends no text either when the email log cannot be read, so the next run tries again', async () => {
    emails.sendEventReminderEmail.mockResolvedValue({ success: false, skipped: true, deferred: true })

    const { payload } = await runCronAt('2026-09-15T18:30:00Z', [booking()])

    expect(textsFor('event_reminder_1d')).toEqual([])
    expect(payload.reminders).toEqual(expect.objectContaining({ sent1d: 0, emailed1d: 0 }))
  })

  it('emails a guest with no active mobile, who used to get nothing', async () => {
    emails.sendEventReminderEmail.mockResolvedValue({ success: true })

    const { payload } = await runCronAt('2026-09-15T18:30:00Z', [
      booking({ customer: { mobile_number: null, sms_status: 'opted_out' } }),
    ])

    expect(emails.sendEventReminderEmail).toHaveBeenCalledOnce()
    expect(payload.reminders).toEqual(expect.objectContaining({ sent1d: 1 }))
  })

  it('still reminds on a night with promotional texts switched off', async () => {
    emails.sendEventReminderEmail.mockResolvedValue({ success: false, skipped: true })

    await runCronAt('2026-09-15T18:30:00Z', [booking({ event: { promo_sms_enabled: false } })])

    expect(textsFor('event_reminder_1d')).toHaveLength(1)
  })

  it('sends nothing to a guest with neither a usable email nor an active mobile', async () => {
    emails.sendEventReminderEmail.mockResolvedValue({ success: false, skipped: true })

    const { payload } = await runCronAt('2026-09-15T18:30:00Z', [
      booking({ customer: { email: null, mobile_number: null, sms_status: null } }),
    ])

    expect(textsFor('event_reminder_1d')).toEqual([])
    expect(payload.reminders).toEqual(expect.objectContaining({ sent1d: 0, skipped: 1 }))
  })

  it('names the event day in the email when the cron runs on the day itself', async () => {
    emails.sendEventReminderEmail.mockResolvedValue({ success: true })

    // 08:30 BST on Wednesday 16 September for a 19:30 start the same day (a late run).
    await runCronAt('2026-09-16T07:30:00Z', [booking()])

    expect(emails.sendEventReminderEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      reminderDay: 'today',
    }))
  })
})

describe('event review ask: one per night (BK-087)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    emails.sendEventReminderEmail.mockResolvedValue({ success: false, skipped: true })
    vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM1' } as never)
    vi.mocked(getFirstVisitReviewEligibleCandidateKeys).mockImplementation(async (candidates: any[]) =>
      new Set(candidates.map((candidate) => `${candidate.channel}:${candidate.bookingId}`))
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // 10:00 BST on Thursday 17 September, the morning after a 19:30 start.
  const MORNING_AFTER = '2026-09-17T09:00:00Z'

  it('asks a checked-in guest once, and says last night after an evening event', async () => {
    const { payload } = await runCronAt(MORNING_AFTER, [booking()], [
      { event_id: 'event-1', booking_id: 'booking-1', customer_id: 'customer-1' },
    ])

    expect(textsFor('event_review_followup')).toEqual([
      "The Anchor: Sam! Hope you had a belter at Music Bingo last night. Got 30 seconds? We'd love to know how we did: https://l.the-anchor.pub/rev123",
    ])
    expect(payload.reviews).toEqual(expect.objectContaining({ sent: 1 }))
  })

  it('does not ask a guest who did not check in on a night that used check-in', async () => {
    const { payload, db } = await runCronAt(MORNING_AFTER, [booking()], [
      { event_id: 'event-1', booking_id: 'someone-else', customer_id: 'customer-9' },
    ])

    expect(textsFor('event_review_followup')).toEqual([])
    expect(payload.reviews).toEqual(expect.objectContaining({ sent: 0, suppressed: 1 }))
    const suppression = db.queries.find((q) => q.table === 'bookings' && called(q, 'update'))
    expect(suppression).toBeDefined()
  })

  it('asks as before on a night that did not use check-in', async () => {
    await runCronAt(MORNING_AFTER, [booking()], [])

    expect(textsFor('event_review_followup')).toHaveLength(1)
  })

  it('says yesterday after an afternoon event', async () => {
    await runCronAt(MORNING_AFTER, [booking({ event: { start_datetime: '2026-09-16T13:00:00Z' } })])

    expect(textsFor('event_review_followup')[0]).toContain('at Music Bingo yesterday.')
  })

  it('names the weekday when the ask goes out later than the next day', async () => {
    // Saturday 19 September for the Wednesday night.
    await runCronAt('2026-09-19T09:00:00Z', [booking()])

    expect(textsFor('event_review_followup')[0]).toContain('at Music Bingo on Wednesday.')
  })
})
