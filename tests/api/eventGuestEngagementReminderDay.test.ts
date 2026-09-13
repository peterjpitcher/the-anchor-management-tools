import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The one-day reminder to guests who booked an event, and the day it names.
 *
 * It falls due 24 hours before the start and the cron runs every 15 minutes. When the send
 * falls in quiet hours (21:00 to 09:00 London), sendSMS holds it until 09:00, which for a late
 * event is the event day itself, and the text said "is tomorrow" there. It now names the day
 * the guest reads it on, and it is not sent at all if it could only land after the start.
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
import { sendSMS } from '@/lib/twilio'
import { GET } from '@/app/api/cron/event-guest-engagement/route'
import { called, createRecordingSupabase, inValues } from '../mocks/recordingSupabase'

const LINK = 'https://l.the-anchor.pub/abc123'

/** A confirmed two-seat booking made weeks ahead, so the late-booking rule never applies. */
function bookingFor(eventId: string, name: string, startDatetime: string) {
  return {
    id: `booking-${eventId}`,
    created_at: '2026-09-01T10:00:00Z',
    customer_id: 'customer-1',
    event_id: eventId,
    seats: 2,
    is_reminder_only: false,
    status: 'confirmed',
    review_sms_sent_at: null,
    review_window_closes_at: null,
    review_suppressed_at: null,
    event: {
      id: eventId,
      name,
      start_datetime: startDatetime,
      date: null,
      time: null,
      event_status: 'scheduled',
      promo_sms_enabled: true,
    },
    customer: {
      id: 'customer-1',
      first_name: 'Sam',
      mobile_number: '+447700900123',
      email: null,
      sms_status: 'active',
      email_status: null,
      email_deactivated_at: null,
    },
  }
}

async function runCronAt(instant: string, bookings: unknown[]) {
  vi.setSystemTime(new Date(instant))

  const db = createRecordingSupabase({
    tables: {
      cron_job_runs: (query) => {
        if (called(query, 'insert')) return { data: { id: 'run-1' }, error: null }
        return { data: null, error: null }
      },
      // No reminder has been sent yet, and no event is up for promotion.
      messages: () => ({ data: [], count: 0, error: null }),
      events: () => ({ data: [], error: null }),
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
  return response.json()
}

function reminderTexts(): string[] {
  return vi
    .mocked(sendSMS)
    .mock.calls.filter(([, , options]) => options?.metadata?.template_key === 'event_reminder_1d')
    .map(([, body]) => body)
}

describe('one-day event reminder: the day it names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the wording for an evening event, sent at the same time the evening before', async () => {
    // 19:30 BST on Tuesday 15 September for a 19:30 start on Wednesday 16 September.
    const payload = await runCronAt('2026-09-15T18:30:00Z', [
      bookingFor('quiz', 'Quiz Night', '2026-09-16T18:30:00Z'),
    ])

    expect(payload.reminders).toEqual(expect.objectContaining({ sent1d: 1 }))
    expect(reminderTexts()).toEqual([
      `The Anchor: Sam, Quiz Night is tomorrow, Wed 16 Sept, 7:30 pm. Your 2 seats are ready. Come a bit early tomorrow if you fancy a drink. Change: ${LINK}`,
    ])
  })

  it('keeps the wording for an early start whose reminder is held until 09:00 the day before', async () => {
    // 08:00 BST on Tuesday 15 September, in quiet hours, for an 08:00 start on Wednesday: it
    // lands at 09:00 on the Tuesday, which is still the day before.
    await runCronAt('2026-09-15T07:00:00Z', [
      bookingFor('coffee', 'Coffee Morning', '2026-09-16T07:00:00Z'),
    ])

    expect(reminderTexts()).toEqual([
      `The Anchor: Sam, Coffee Morning is tomorrow, Wed 16 Sept, 8:00 am. Your 2 seats are ready. Come a bit early tomorrow if you fancy a drink. Change: ${LINK}`,
    ])
  })

  describe('Sunday 25 October 2026, the night the clocks go back', () => {
    it.each([
      // Start (GMT, Sunday), the cron run that first finds it due (BST, Saturday), the time shown.
      ['2026-10-25T20:30:00Z', '2026-10-24T20:30:00Z', 'Sun 25 Oct, 8:30 pm'],
      ['2026-10-25T20:00:00Z', '2026-10-24T20:00:00Z', 'Sun 25 Oct, 8:00 pm'],
      // Due at 20:50 BST, so the 20:45 run is too early and the 21:00 run is in quiet hours.
      ['2026-10-25T19:50:00Z', '2026-10-24T20:00:00Z', 'Sun 25 Oct, 7:50 pm'],
    ])('a %s start, first due at the %s run, lands at 09:00 on the Sunday and says today', async (start, run, shown) => {
      await runCronAt(run, [bookingFor('quiz', 'Quiz Night', start)])

      expect(reminderTexts()).toEqual([
        `The Anchor: Sam, Quiz Night is today, ${shown}. Your 2 seats are ready. Come a bit early if you fancy a drink. Change: ${LINK}`,
      ])
    })

    it('a 19:50 start is not yet due at the 20:45 run', async () => {
      const payload = await runCronAt('2026-10-24T19:45:00Z', [
        bookingFor('quiz', 'Quiz Night', '2026-10-25T19:50:00Z'),
      ])

      expect(reminderTexts()).toEqual([])
      expect(payload.reminders).toEqual(expect.objectContaining({ sent1d: 0 }))
    })

    it('a 19:45 start is due at the 20:45 run, before quiet hours, and still says tomorrow', async () => {
      await runCronAt('2026-10-24T19:45:00Z', [bookingFor('quiz', 'Quiz Night', '2026-10-25T19:45:00Z')])

      expect(reminderTexts()).toEqual([
        `The Anchor: Sam, Quiz Night is tomorrow, Sun 25 Oct, 7:45 pm. Your 2 seats are ready. Come a bit early tomorrow if you fancy a drink. Change: ${LINK}`,
      ])
    })
  })

  it('a 21:00 start on an ordinary week is held from 21:00 the night before and says today', async () => {
    // 21:00 BST on Friday 25 September for a 21:00 start on Saturday 26 September.
    await runCronAt('2026-09-25T20:00:00Z', [bookingFor('karaoke', 'Karaoke', '2026-09-26T20:00:00Z')])

    expect(reminderTexts()).toEqual([
      `The Anchor: Sam, Karaoke is today, Sat 26 Sept, 9:00 pm. Your 2 seats are ready. Come a bit early if you fancy a drink. Change: ${LINK}`,
    ])
  })

  describe('Sunday 28 March 2027, the night the clocks go forward', () => {
    it('a 21:00 BST start is due at 20:00 GMT on the Saturday, before quiet hours, and says tomorrow', async () => {
      await runCronAt('2027-03-27T20:00:00Z', [bookingFor('quiz', 'Quiz Night', '2027-03-28T20:00:00Z')])

      expect(reminderTexts()).toEqual([
        `The Anchor: Sam, Quiz Night is tomorrow, Sun 28 Mar, 9:00 pm. Your 2 seats are ready. Come a bit early tomorrow if you fancy a drink. Change: ${LINK}`,
      ])
    })

    it('a 22:00 BST start is due at 21:00 GMT on the Saturday, in quiet hours, and says today', async () => {
      await runCronAt('2027-03-27T21:00:00Z', [bookingFor('quiz', 'Quiz Night', '2027-03-28T21:00:00Z')])

      expect(reminderTexts()).toEqual([
        `The Anchor: Sam, Quiz Night is today, Sun 28 Mar, 10:00 pm. Your 2 seats are ready. Come a bit early if you fancy a drink. Change: ${LINK}`,
      ])
    })
  })

  it('sends nothing when the text could only land after the event has started', async () => {
    // A late run at 02:00 BST on Wednesday 16 September for an 08:00 start that morning: quiet
    // hours would hold it to 09:00, an hour after the start.
    const payload = await runCronAt('2026-09-16T01:00:00Z', [
      bookingFor('coffee', 'Coffee Morning', '2026-09-16T07:00:00Z'),
    ])

    expect(reminderTexts()).toEqual([])
    expect(payload.reminders).toEqual(expect.objectContaining({ sent1d: 0, skipped: 1 }))
  })
})
