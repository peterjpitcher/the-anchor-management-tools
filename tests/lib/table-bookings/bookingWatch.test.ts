import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '../../helpers/fakeSupabaseDb'

/**
 * The table booking watch (owner decisions, 22 November 2026): the manager is told, once, when
 * website table bookings stop for three days, when the website stops reaching this app, and when
 * the booking routes keep failing. These tests pin each decision, that one spell is one email,
 * and that a booking or a call arriving ends the spell so the next one is reported afresh.
 *
 * Every time is built from a London date and clock time, so the suite reads the same under
 * Europe/London and under UTC.
 */

// The claims the real table would hold, so "already sent" is decided the way production decides it.
const claims = new Map<string, 'processing' | 'emailed'>()

vi.mock('@/lib/api/idempotency', () => ({
  computeIdempotencyRequestHash: (payload: unknown) => JSON.stringify(payload),
  claimIdempotencyKey: vi.fn(async (_supabase: unknown, key: string) => {
    if (claims.has(key)) return { state: 'replay', response: {} }
    claims.set(key, 'processing')
    return { state: 'claimed' }
  }),
  persistIdempotencyResponse: vi.fn(async (_supabase: unknown, key: string) => {
    claims.set(key, 'emailed')
  }),
  releaseIdempotencyClaim: vi.fn(async (_supabase: unknown, key: string) => {
    claims.delete(key)
  }),
}))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { whenLondonClockReaches } from '@/lib/dateUtils'
import { sendEmail } from '@/lib/email/emailService'
import { MANAGER_ALERT_RECIPIENT } from '@/lib/money-alerts'
import {
  BOOKING_API_ERROR_THRESHOLD,
  bookingApiErrorsAlert,
  buildWatchEmail,
  quietBookingsAlert,
  runTableBookingWatch,
  websiteSilentAlert,
} from '@/lib/table-bookings/booking-watch'

const HOUR = 3_600_000

/** An instant from a London date and clock time. */
function london(date: string, time: string): Date {
  const instant = whenLondonClockReaches(date, time)
  if (!instant) throw new Error(`Not a London time: ${date} ${time}`)
  return instant
}

function hoursAfter(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * HOUR)
}

// Sunday 22 November 2026, 16:00 in the pub.
const NOW = london('2026-11-22', '16:00')
const WEBSITE_KEY = 'key-website'
const PREVIEW_KEY = 'key-preview'

const API_KEYS = [
  { id: WEBSITE_KEY, permissions: ['read:events', 'create:bookings'] },
  { id: PREVIEW_KEY, permissions: ['read:events'] },
]

function websiteBooking(id: string, createdAt: Date, source = 'brand_site') {
  return { id, source, created_at: createdAt.toISOString() }
}

function call(endpoint: string, at: Date, statusCode = 200, apiKeyId = WEBSITE_KEY) {
  return { api_key_id: apiKeyId, endpoint, method: 'GET', status_code: statusCode, created_at: at.toISOString() }
}

/** A website that is working: a booking this morning and a call a few minutes ago. */
function healthyDb(now: Date = NOW) {
  return createFakeDb({
    api_keys: API_KEYS,
    table_bookings: [websiteBooking('booking-1', hoursAfter(now, -7))],
    api_usage: [call('/api/table-bookings/periods', hoursAfter(now, -0.2))],
  })
}

function emailsSent() {
  return vi.mocked(sendEmail).mock.calls.map(([options]) => options)
}

beforeEach(() => {
  claims.clear()
  vi.mocked(sendEmail).mockReset()
  vi.mocked(sendEmail).mockResolvedValue({ success: true } as never)
})

describe('quietBookingsAlert: no website table booking for three days', () => {
  const lastBooking = { id: 'booking-1', createdAt: london('2026-11-19', '09:31').toISOString() }

  it('says nothing while the last website booking is under 72 hours old', () => {
    expect(quietBookingsAlert(lastBooking, hoursAfter(new Date(lastBooking.createdAt), 71.9))).toBeNull()
  })

  it('alerts from 72 hours, saying when the last booking was and what to check', () => {
    const alert = quietBookingsAlert(lastBooking, hoursAfter(new Date(lastBooking.createdAt), 72))
    expect(alert).not.toBeNull()
    expect(alert!.subject).toBe('[TABLE BOOKINGS] No website table bookings for 3 days')
    // 19 November 2026 is a Thursday.
    expect(alert!.intro).toContain('Thursday 19 November at 09:31')
    expect(alert!.intro).toContain('3 days ago')
    expect(alert!.action).toContain('make a test booking')
  })

  it('keeps the same once-only key for as long as the same booking is the last one', () => {
    const first = quietBookingsAlert(lastBooking, hoursAfter(new Date(lastBooking.createdAt), 73))
    const dayLater = quietBookingsAlert(lastBooking, hoursAfter(new Date(lastBooking.createdAt), 97))
    expect(dayLater!.onceKey).toBe(first!.onceKey)
  })

  it('makes a new key once a newer booking has arrived and it has gone quiet again', () => {
    const newer = { id: 'booking-2', createdAt: london('2026-11-23', '12:00').toISOString() }
    expect(quietBookingsAlert(newer, hoursAfter(new Date(newer.createdAt), 5))).toBeNull()
    const again = quietBookingsAlert(newer, hoursAfter(new Date(newer.createdAt), 80))
    expect(again!.onceKey).not.toBe(quietBookingsAlert(lastBooking, NOW)!.onceKey)
  })

  it('alerts when there has never been a website booking', () => {
    const alert = quietBookingsAlert(null, NOW)
    expect(alert!.onceKey).toBe('table-booking-watch:quiet-bookings:none')
    expect(alert!.intro).toContain('No table booking made on the website could be found')
  })
})

describe('websiteSilentAlert: the website has stopped asking for times and tables', () => {
  const lastCall = london('2026-11-22', '09:00').toISOString()

  it('says nothing under six hours and alerts from six', () => {
    expect(websiteSilentAlert(lastCall, hoursAfter(new Date(lastCall), 5.9))).toBeNull()
    const alert = websiteSilentAlert(lastCall, hoursAfter(new Date(lastCall), 7))
    expect(alert!.intro).toContain('Sunday 22 November at 09:00')
    expect(alert!.intro).toContain('7 hours ago')
    expect(alert!.action).toContain('API key')
  })

  it('is keyed on the last call, so one silence is one alert and a new call starts a new one', () => {
    const one = websiteSilentAlert(lastCall, hoursAfter(new Date(lastCall), 7))
    const two = websiteSilentAlert(lastCall, hoursAfter(new Date(lastCall), 30))
    expect(two!.onceKey).toBe(one!.onceKey)
    const laterCall = london('2026-11-24', '10:00').toISOString()
    expect(websiteSilentAlert(laterCall, hoursAfter(new Date(laterCall), 8))!.onceKey).not.toBe(one!.onceKey)
  })

  it('alerts when no call was found at all', () => {
    expect(websiteSilentAlert(null, NOW)!.onceKey).toBe('table-booking-watch:website-silent:none')
  })
})

describe('bookingApiErrorsAlert: the booking routes keep failing', () => {
  const error = (endpoint: string, minutesAgo: number, now: Date = NOW) => ({
    endpoint,
    statusCode: 500,
    at: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  })

  it('says nothing below the threshold', () => {
    const few = Array.from({ length: BOOKING_API_ERROR_THRESHOLD - 1 }, (_, index) => error('/api/table-bookings', index + 1))
    expect(bookingApiErrorsAlert(few, NOW)).toBeNull()
  })

  it('alerts at the threshold, counting each route in plain words', () => {
    const alert = bookingApiErrorsAlert(
      [error('/api/table-bookings', 50), error('/api/table-bookings/load', 20), error('/api/table-bookings', 5)],
      NOW,
    )
    expect(alert!.subject).toContain('failed 3 website requests')
    expect(alert!.lines).toEqual(['Making a booking: failed 2 times.', 'Checking for free tables: failed 1 time.'])
    expect(alert!.intro).toContain('Sunday 22 November at 15:10')
    expect(alert!.intro).toContain('Sunday 22 November at 15:55')
  })

  it('is keyed on the London day, also just after midnight in summer time', () => {
    // 00:30 in the pub on 1 July is 23:30 on 30 June in UTC.
    const justAfterMidnight = london('2026-07-01', '00:30')
    const alert = bookingApiErrorsAlert(
      [1, 2, 3].map((minutes) => error('/api/table-bookings', minutes, justAfterMidnight)),
      justAfterMidnight,
    )
    expect(alert!.onceKey).toBe('table-booking-watch:booking-api-errors:2026-07-01')
  })
})

describe('buildWatchEmail', () => {
  it('renders the alert with no blanks, and escapes it', () => {
    const alert = quietBookingsAlert({ id: 'b', createdAt: london('2026-11-19', '09:31').toISOString() }, NOW)!
    const email = buildWatchEmail(alert)
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(/undefined|Invalid Date|NaN/)
    }
    expect(email.text).toContain('This is the only email about this.')
    expect(email.html).toContain('website&#39;s book a table page')
  })
})

describe('runTableBookingWatch', () => {
  it('sends nothing when bookings and calls are arriving', async () => {
    const db = healthyDb()
    const outcomes = await runTableBookingWatch(db.client as never, NOW)
    expect(outcomes.map((outcome) => outcome.alert)).toEqual(['not_needed', 'not_needed', 'not_needed'])
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('emails the manager once for a quiet spell, however many times it runs', async () => {
    const db = createFakeDb({
      api_keys: API_KEYS,
      // Staff and walk-in bookings keep arriving; only the website has gone quiet.
      table_bookings: [websiteBooking('booking-1', hoursAfter(NOW, -80)), websiteBooking('walk-in-1', hoursAfter(NOW, -1), 'walk-in')],
      api_usage: [call('/api/table-bookings/load', hoursAfter(NOW, -1))],
    })

    const first = await runTableBookingWatch(db.client as never, NOW)
    const second = await runTableBookingWatch(db.client as never, hoursAfter(NOW, 1))
    const nextDay = await runTableBookingWatch(db.client as never, hoursAfter(NOW, 24))

    expect(first.find((outcome) => outcome.kind === 'quiet_bookings')!.alert).toBe('sent')
    expect(second.find((outcome) => outcome.kind === 'quiet_bookings')!.alert).toBe('already_sent')
    expect(nextDay.find((outcome) => outcome.kind === 'quiet_bookings')!.alert).toBe('already_sent')
    const quietEmails = emailsSent().filter((email) => email.subject.includes('No website table bookings'))
    expect(quietEmails).toHaveLength(1)
    expect(quietEmails[0].to).toBe(MANAGER_ALERT_RECIPIENT)
  })

  it('a website booking ends the spell, and the next quiet spell is reported afresh', async () => {
    const db = createFakeDb({
      api_keys: API_KEYS,
      table_bookings: [websiteBooking('booking-1', hoursAfter(NOW, -80))],
      api_usage: [],
    })
    // The website keeps calling throughout, so only the quiet-bookings check is in play.
    const run = async (at: Date) => {
      db.rows('api_usage').push(call('/api/table-bookings/periods', hoursAfter(at, -0.5)))
      const outcomes = await runTableBookingWatch(db.client as never, at)
      return outcomes.find((outcome) => outcome.kind === 'quiet_bookings')!.alert
    }

    expect(await run(NOW)).toBe('sent')

    db.rows('table_bookings').push(websiteBooking('booking-2', hoursAfter(NOW, 2)))
    expect(await run(hoursAfter(NOW, 3))).toBe('not_needed')
    expect(await run(hoursAfter(NOW, 2 + 71))).toBe('not_needed')

    expect(await run(hoursAfter(NOW, 2 + 73))).toBe('sent')
    expect(await run(hoursAfter(NOW, 2 + 74))).toBe('already_sent')
    expect(emailsSent()).toHaveLength(2)
  })

  it('reports the website going silent once, and only counts calls made with a key that can book', async () => {
    const db = createFakeDb({
      api_keys: API_KEYS,
      table_bookings: [websiteBooking('booking-1', hoursAfter(NOW, -10))],
      api_usage: [
        call('/api/table-bookings/periods', hoursAfter(NOW, -8)),
        // A preview key still calling, and a call that was refused, do not hide the silence.
        call('/api/table-bookings/periods', hoursAfter(NOW, -1), 200, PREVIEW_KEY),
        call('/api/table-bookings/load', hoursAfter(NOW, -1), 400),
      ],
    })

    const first = await runTableBookingWatch(db.client as never, NOW)
    const second = await runTableBookingWatch(db.client as never, hoursAfter(NOW, 1))
    expect(first.find((outcome) => outcome.kind === 'website_silent')!.alert).toBe('sent')
    expect(second.find((outcome) => outcome.kind === 'website_silent')!.alert).toBe('already_sent')
    expect(emailsSent()).toHaveLength(1)
    expect(emailsSent()[0].subject).toContain('has not reached the booking system')

    // The website comes back: nothing more to say.
    db.rows('api_usage').push(call('/api/table-bookings/load', hoursAfter(NOW, 1.5)))
    const third = await runTableBookingWatch(db.client as never, hoursAfter(NOW, 2))
    expect(third.find((outcome) => outcome.kind === 'website_silent')!.alert).toBe('not_needed')
  })

  it('reports a burst of server errors from the booking routes once a day, and ignores refusals', async () => {
    const db = healthyDb()
    db.rows('api_usage').push(
      call('/api/table-bookings', hoursAfter(NOW, -2), 500),
      call('/api/table-bookings', hoursAfter(NOW, -1), 500),
      call('/api/table-bookings/load', hoursAfter(NOW, -0.5), 500),
      // A guest asked to correct a detail, an old error and another route's error are not counted.
      call('/api/table-bookings', hoursAfter(NOW, -0.4), 400),
      call('/api/table-bookings', hoursAfter(NOW, -5), 500),
      call('/api/event-bookings', hoursAfter(NOW, -0.3), 500),
    )

    const first = await runTableBookingWatch(db.client as never, NOW)
    const second = await runTableBookingWatch(db.client as never, hoursAfter(NOW, 1))
    expect(first.find((outcome) => outcome.kind === 'booking_api_errors')!.alert).toBe('sent')
    expect(second.find((outcome) => outcome.kind === 'booking_api_errors')!.alert).not.toBe('sent')
    expect(emailsSent()).toHaveLength(1)
    expect(emailsSent()[0].subject).toContain('failed 3 website requests')
  })

  it('tries again next time when the alert email could not be sent', async () => {
    const db = createFakeDb({
      api_keys: API_KEYS,
      table_bookings: [websiteBooking('booking-1', hoursAfter(NOW, -80))],
      api_usage: [call('/api/table-bookings/load', hoursAfter(NOW, -1))],
    })
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: 'provider down' } as never)

    const first = await runTableBookingWatch(db.client as never, NOW)
    expect(first.find((outcome) => outcome.kind === 'quiet_bookings')).toMatchObject({ alert: 'failed' })

    db.rows('api_usage').push(call('/api/table-bookings/load', hoursAfter(NOW, 0.9)))
    const second = await runTableBookingWatch(db.client as never, hoursAfter(NOW, 1))
    expect(second.find((outcome) => outcome.kind === 'quiet_bookings')!.alert).toBe('sent')
  })

  it('never reads a failed lookup as "no bookings": the check fails and the others still run', async () => {
    const db = healthyDb()
    db.failNext({ table: 'table_bookings', operation: 'select', message: 'connection refused', times: 1 })

    const outcomes = await runTableBookingWatch(db.client as never, NOW)
    expect(outcomes.find((outcome) => outcome.kind === 'quiet_bookings')).toMatchObject({
      alert: 'failed',
      error: expect.stringContaining('connection refused'),
    })
    expect(outcomes.find((outcome) => outcome.kind === 'website_silent')!.alert).toBe('not_needed')
    expect(outcomes.find((outcome) => outcome.kind === 'booking_api_errors')!.alert).toBe('not_needed')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('fails the website checks rather than guessing when no key that can book is found', async () => {
    const db = createFakeDb({
      api_keys: [{ id: PREVIEW_KEY, permissions: ['read:events'] }],
      table_bookings: [websiteBooking('booking-1', hoursAfter(NOW, -1))],
      api_usage: [],
    })
    const outcomes = await runTableBookingWatch(db.client as never, NOW)
    expect(outcomes.map((outcome) => outcome.alert)).toEqual(['not_needed', 'failed', 'failed'])
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
