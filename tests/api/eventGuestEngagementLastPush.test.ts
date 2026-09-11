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
  isMessagingFlagOn: vi.fn(),
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
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { sendCrossPromoForEvent, sendFollowUpForEvent } from '@/lib/sms/cross-promo'
import { GET } from '@/app/api/cron/event-guest-engagement/route'
import { argsOf, called, createRecordingSupabase } from '../mocks/recordingSupabase'

// Tuesday 15 September 2026, 09:00 BST.
const NOW = new Date('2026-09-15T08:00:00.000Z')

const EVENTS = [
  { id: 'tonight', name: 'Music Bingo', date: '2026-09-15', time: '19:00:00', start_datetime: '2026-09-15T18:00:00Z' },
  { id: 'started-this-morning', name: 'Coffee Morning', date: '2026-09-15', time: '08:00:00', start_datetime: '2026-09-15T07:00:00Z' },
  { id: 'tomorrow', name: 'Quiz Night', date: '2026-09-16', time: '19:00:00', start_datetime: '2026-09-16T18:00:00Z' },
  { id: 'friday', name: 'Karaoke', date: '2026-09-18', time: '20:00:00', start_datetime: '2026-09-18T19:00:00Z' },
  { id: 'saturday', name: 'Cash Bingo', date: '2026-09-19', time: '19:00:00', start_datetime: '2026-09-19T18:00:00Z' },
].map((event) => ({ ...event, price: 3, payment_mode: 'cash_only', category_id: 'cat-1' }))

function buildDatabase() {
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
    },
    defaultAnswer: () => ({ data: [], count: 0, error: null }),
    rpc: () => ({ data: [], error: null }),
  })
}

async function runCron(flags: { lastPush: boolean; introForGuestsWithoutEmail: boolean }) {
  vi.mocked(isMessagingFlagOn).mockImplementation(async (key) => {
    if (key === 'event_promo_last_push') return flags.lastPush
    if (key === 'event_promo_intro_sms_no_email') return flags.introForGuestsWithoutEmail
    return false
  })

  const db = buildDatabase()
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
})
