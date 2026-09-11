import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The event guest engagement cron's promotion stage under the messaging flags of
 * 11 September 2026.
 *
 * Flag off: the 24-hour follow-up and the 7-day intro run exactly as before.
 * `event_promo_last_push` on: neither runs; the only promotion is the last push, for events
 * 0 to 3 London days away that have not started. With `event_promo_intro_sms_no_email` on as
 * well, the intro runs again for guests without a usable email (the per-event sender applies
 * that filter; see src/lib/sms/__tests__/event-last-push.test.ts).
 * Flags row unreadable: no promotion text at all in that run; every other stage runs as before.
 */

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
  readMessagingFlagState: vi.fn(),
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/sms/review-once', () => ({
  hasCustomerReviewed: vi.fn().mockResolvedValue(new Set<string>()),
  getFirstVisitReviewEligibleCandidateKeys: vi.fn().mockResolvedValue(new Set<string>()),
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

import { createAdminClient } from '@/lib/supabase/admin'
import { readMessagingFlagState } from '@/lib/messaging/flags'
import { reportCronFailure } from '@/lib/cron/alerting'
import { persistCronRunResult } from '@/lib/cron-run-results'
import { logger } from '@/lib/logger'
import { sendSMS } from '@/lib/twilio'
import { sendCrossPromoForEvent, sendFollowUpForEvent } from '@/lib/sms/cross-promo'
import { GET } from '@/app/api/cron/event-guest-engagement/route'
import { argsOf, called, createRecordingSupabase, inValues } from '../mocks/recordingSupabase'

// Tuesday 15 September 2026, 09:00 BST.
const NOW = new Date('2026-09-15T08:00:00.000Z')

const EVENTS = [
  { id: 'tonight', name: 'Music Bingo', date: '2026-09-15', time: '19:00:00', start_datetime: '2026-09-15T18:00:00Z' },
  { id: 'started-this-morning', name: 'Coffee Morning', date: '2026-09-15', time: '08:00:00', start_datetime: '2026-09-15T07:00:00Z' },
  { id: 'tomorrow', name: 'Quiz Night', date: '2026-09-16', time: '19:00:00', start_datetime: '2026-09-16T18:00:00Z' },
  { id: 'friday', name: 'Karaoke', date: '2026-09-18', time: '20:00:00', start_datetime: '2026-09-18T19:00:00Z' },
  { id: 'saturday', name: 'Cash Bingo', date: '2026-09-19', time: '19:00:00', start_datetime: '2026-09-19T18:00:00Z' },
].map((event) => ({ ...event, price: 3, payment_mode: 'cash_only', category_id: 'cat-1' }))

/**
 * A confirmed booking for an event starting at 08:00 BST tomorrow, so its one-day reminder is due
 * at NOW. Used to show the reminder stage runs whatever happens to the promotion flags.
 */
const DUE_REMINDER_BOOKING = {
  id: 'booking-due-reminder',
  created_at: '2026-09-01T10:00:00Z',
  customer_id: 'customer-booked',
  event_id: 'breakfast',
  seats: 2,
  is_reminder_only: false,
  status: 'confirmed',
  review_sms_sent_at: null,
  review_window_closes_at: null,
  review_suppressed_at: null,
  event: {
    id: 'breakfast',
    name: 'Coffee Morning',
    start_datetime: '2026-09-16T07:00:00Z',
    date: '2026-09-16',
    time: '08:00:00',
    event_status: 'scheduled',
    promo_sms_enabled: true,
  },
  customer: {
    id: 'customer-booked',
    first_name: 'Sam',
    mobile_number: '+447700900123',
    email: null,
    sms_status: 'active',
    email_status: null,
    email_deactivated_at: null,
  },
}

function buildDatabase(options: { bookings?: unknown[] } = {}) {
  return createRecordingSupabase({
    tables: {
      cron_job_runs: (query) => {
        if (called(query, 'insert')) return { data: { id: 'run-1' }, error: null }
        if (called(query, 'update')) return { data: null, error: null }
        return { data: null, error: null }
      },
      // The mock does not filter by date, so every events query sees all five nights: the
      // last-push timing check in the route has to do the filtering itself.
      events: () => ({ data: EVENTS, error: null }),
      messages: () => ({ data: [], count: 0, error: null }),
      // Only the engagement load asks for confirmed bookings; everything else sees none.
      bookings: (query) =>
        !called(query, 'update') && inValues(query, 'status').includes('confirmed')
          ? { data: options.bookings ?? [], error: null }
          : { data: [], error: null },
    },
    defaultAnswer: () => ({ data: [], count: 0, error: null }),
    rpc: () => ({ data: [], error: null }),
  })
}

type CronFlags = { lastPush: boolean; introForGuestsWithoutEmail: boolean } | 'unreadable'

const READ_FAILURE = { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null }

async function runCron(flags: CronFlags, options: { bookings?: unknown[] } = {}) {
  vi.mocked(readMessagingFlagState).mockImplementation(async (key) => {
    if (flags === 'unreadable') return { state: 'unknown', failure: READ_FAILURE }
    const on =
      (key === 'event_promo_last_push' && flags.lastPush) ||
      (key === 'event_promo_intro_sms_no_email' && flags.introForGuestsWithoutEmail)
    return { state: on ? 'on' : 'off' }
  })

  const db = buildDatabase(options)
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)

  const request = new Request('http://localhost/api/cron/event-guest-engagement') as never as Parameters<typeof GET>[0]
  ;(request as unknown as { nextUrl: URL }).nextUrl = new URL('http://localhost')

  const response = await GET(request)
  return { db, payload: await response.json() }
}

function promoCalls() {
  return vi.mocked(sendCrossPromoForEvent).mock.calls.map(([event, options]) => ({
    eventId: event.id,
    mode: (options as { mode?: string } | undefined)?.mode,
    hasModeKey: Boolean(options && 'mode' in options),
  }))
}

function cleanupCutoff(db: ReturnType<typeof buildDatabase>): string | undefined {
  const cleanup = db.queries.find((query) => query.table === 'sms_promo_context' && called(query, 'delete'))
  return cleanup ? (argsOf(cleanup, 'lt')[0]?.[1] as string) : undefined
}

describe('event promotion stage and the messaging flags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('with the flag off, runs the 24-hour follow-up and the 7-day intro exactly as before', async () => {
    const { db, payload } = await runCron({ lastPush: false, introForGuestsWithoutEmail: false })

    expect(payload.success).toBe(true)
    expect(db.rpc).toHaveBeenCalledWith('get_follow_up_recipients', expect.objectContaining({ p_touch_type: '24h' }))
    const calls = promoCalls()
    expect(calls.map((call) => call.eventId)).toEqual(EVENTS.map((event) => event.id))
    // The intro call carries no mode at all, as it did before the flag existed.
    expect(calls.every((call) => !call.hasModeKey)).toBe(true)
    expect(payload.lastPush).toBeUndefined()
    expect(payload.followUp24h.disabled).toBeUndefined()
    // Reply windows are still cleared at 30 days.
    expect(cleanupCutoff(db)).toBe('2026-08-16T08:00:00.000Z')
  })

  it('ignores the no-email intro flag while the last push is off', async () => {
    const { db } = await runCron({ lastPush: false, introForGuestsWithoutEmail: true })

    expect(db.rpc).toHaveBeenCalledWith('get_follow_up_recipients', expect.anything())
    expect(promoCalls().every((call) => !call.hasModeKey)).toBe(true)
  })

  it('with the flag on, sends no intro and no follow-up, only a last push inside the window', async () => {
    const { db, payload } = await runCron({ lastPush: true, introForGuestsWithoutEmail: false })

    expect(payload.success).toBe(true)
    // The 24-hour stage is not even asked for recipients.
    expect(db.rpc).not.toHaveBeenCalledWith('get_follow_up_recipients', expect.anything())
    expect(sendFollowUpForEvent).not.toHaveBeenCalled()

    // Tonight (not started), tomorrow and Friday (D+3). Not the event that began at 08:00
    // today, and not Saturday (D+4).
    expect(promoCalls()).toEqual([
      { eventId: 'tonight', mode: 'last_push', hasModeKey: true },
      { eventId: 'tomorrow', mode: 'last_push', hasModeKey: true },
      { eventId: 'friday', mode: 'last_push', hasModeKey: true },
    ])

    // The events query asks for today to today + 3 on the London calendar.
    const lastPushQuery = db.queries.find(
      (query) => query.table === 'events' && String(argsOf(query, 'select')[0]?.[0]).includes('start_datetime')
    )!
    expect(argsOf(lastPushQuery, 'gte')).toContainEqual(['date', '2026-09-15'])
    expect(argsOf(lastPushQuery, 'lte')).toContainEqual(['date', '2026-09-18'])

    expect(payload.followUp24h).toEqual(expect.objectContaining({ disabled: true, sent: 0 }))
    expect(payload.crossPromo).toEqual(expect.objectContaining({ disabled: true, sent: 0 }))
    expect(payload.lastPush).toEqual(expect.objectContaining({ eventsProcessed: 3 }))
    // Reply-window rows are kept 45 days so the 30-day cap never loses one it needs.
    expect(cleanupCutoff(db)).toBe('2026-08-01T08:00:00.000Z')
  })

  it('with both flags on, adds today\'s intro for guests without email after the last push', async () => {
    const { db, payload } = await runCron({ lastPush: true, introForGuestsWithoutEmail: true })

    expect(db.rpc).not.toHaveBeenCalledWith('get_follow_up_recipients', expect.anything())
    const calls = promoCalls()
    expect(calls.filter((call) => call.mode === 'last_push').map((call) => call.eventId)).toEqual([
      'tonight',
      'tomorrow',
      'friday',
    ])
    // The intro stage keeps its own window (the mock returns every event; the real query asks
    // for D+1 to D+7) and runs second, so a guest already pushed for a night is excluded.
    const introCalls = calls.filter((call) => call.mode === 'intro_no_email')
    expect(introCalls).toHaveLength(EVENTS.length)
    expect(calls.findIndex((call) => call.mode === 'intro_no_email')).toBeGreaterThan(
      calls.findLastIndex((call) => call.mode === 'last_push')
    )
    expect(payload.crossPromo.disabled).toBeUndefined()
  })

  it('when the flags row cannot be read, sends no promotion text at all, not the old intro and follow-up', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})

    const { db, payload } = await runCron('unreadable')

    expect(payload.success).toBe(true)
    // Nothing from any promotion stage: no follow-up recipients asked for, no event promoted.
    expect(db.rpc).not.toHaveBeenCalledWith('get_follow_up_recipients', expect.anything())
    expect(sendFollowUpForEvent).not.toHaveBeenCalled()
    expect(sendCrossPromoForEvent).not.toHaveBeenCalled()
    expect(db.queries.some((query) => query.table === 'events')).toBe(false)
    for (const stage of [payload.followUp24h, payload.crossPromo, payload.lastPush]) {
      expect(stage).toEqual(expect.objectContaining({ sent: 0, disabled: true, reason: 'messaging_flags_unreadable' }))
    }

    // Said once in the log and once through the cron failure alert.
    const heldLines = errorSpy.mock.calls.filter(([message]) => String(message).includes('Event promotion texts held'))
    expect(heldLines).toHaveLength(1)
    expect(heldLines[0][1]).toEqual({ metadata: expect.objectContaining({ code: '57014' }) })
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    expect(reportCronFailure).toHaveBeenCalledWith(
      'event-guest-engagement',
      expect.any(Error),
      expect.objectContaining({ code: '57014' })
    )

    // The run still completes, and reply-window rows are kept 45 days in case the cap is in force.
    expect(persistCronRunResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'completed' }))
    expect(cleanupCutoff(db)).toBe('2026-08-01T08:00:00.000Z')

    errorSpy.mockRestore()
  })

  it('when the flags row cannot be read, still sends the reminders exactly as with the flags off', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})

    const flagsOff = await runCron({ lastPush: false, introForGuestsWithoutEmail: false }, { bookings: [DUE_REMINDER_BOOKING] })
    const offSends = vi.mocked(sendSMS).mock.calls.map(([to, , options]) => ({ to, templateKey: options?.metadata?.template_key }))

    vi.mocked(sendSMS).mockClear()
    const unreadable = await runCron('unreadable', { bookings: [DUE_REMINDER_BOOKING] })
    const unreadableSends = vi.mocked(sendSMS).mock.calls.map(([to, , options]) => ({ to, templateKey: options?.metadata?.template_key }))

    expect(offSends).toEqual([{ to: '+447700900123', templateKey: 'event_reminder_1d' }])
    expect(unreadableSends).toEqual(offSends)
    for (const stage of ['reminders', 'reviews', 'completion', 'tableReviews', 'tableCompletion'] as const) {
      expect(unreadable.payload[stage]).toEqual(flagsOff.payload[stage])
    }
    expect(unreadable.payload.reminders).toEqual(expect.objectContaining({ sent1d: 1 }))

    errorSpy.mockRestore()
  })
})

/**
 * The follow-up and the intro ask the database for London calendar dates. They used to add 24
 * hours to the clock, which on the night the clocks go back turned "tomorrow" into today.
 */
describe('promotion windows across the clock changes (flags off, as today)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** The follow-up events query runs first, then the intro's. */
  function introAndFollowUpWindows(db: ReturnType<typeof buildDatabase>) {
    const [followUp, intro] = db.queries.filter(
      (query) => query.table === 'events' && !String(argsOf(query, 'select')[0]?.[0]).includes('start_datetime')
    )
    const window = (query: typeof followUp) => ({
      from: argsOf(query, 'gte').find(([column]) => column === 'date')?.[1],
      to: argsOf(query, 'lte').find(([column]) => column === 'date')?.[1],
    })
    return { followUp: window(followUp), intro: window(intro) }
  }

  it.each([
    // 00:00, 00:30 and 00:59 BST on Sunday 25 October 2026, the night the clocks go back.
    ['2026-10-24T23:00:00Z'],
    ['2026-10-24T23:30:00Z'],
    ['2026-10-24T23:59:00Z'],
  ])('at %s, tomorrow is Monday 26 October, not the same Sunday', async (instant) => {
    vi.setSystemTime(new Date(instant))

    const { db } = await runCron({ lastPush: false, introForGuestsWithoutEmail: false })

    const windows = introAndFollowUpWindows(db)
    // The 24-hour follow-up asks about tomorrow only, so it can no longer say "is tomorrow"
    // about a night that is that Sunday evening.
    expect(windows.followUp).toEqual({ from: '2026-10-26', to: '2026-10-26' })
    // The intro window is one to seven days out, so a same-day event is not in it.
    expect(windows.intro).toEqual({ from: '2026-10-26', to: '2026-11-01' })
  })

  it.each([
    // 23:00, 23:30 and 23:59 GMT on Saturday 27 March 2027, the night before the clocks go forward.
    ['2027-03-27T23:00:00Z'],
    ['2027-03-27T23:30:00Z'],
    ['2027-03-27T23:59:00Z'],
  ])('at %s, tomorrow is Sunday 28 March, not Monday 29', async (instant) => {
    vi.setSystemTime(new Date(instant))

    const { db } = await runCron({ lastPush: false, introForGuestsWithoutEmail: false })

    const windows = introAndFollowUpWindows(db)
    expect(windows.followUp).toEqual({ from: '2027-03-28', to: '2027-03-28' })
    expect(windows.intro).toEqual({ from: '2027-03-28', to: '2027-04-03' })
  })

  it('is unchanged on an ordinary day', async () => {
    vi.setSystemTime(NOW)

    const { db } = await runCron({ lastPush: false, introForGuestsWithoutEmail: false })

    expect(introAndFollowUpWindows(db)).toEqual({
      followUp: { from: '2026-09-16', to: '2026-09-16' },
      intro: { from: '2026-09-16', to: '2026-09-22' },
    })
  })
})
