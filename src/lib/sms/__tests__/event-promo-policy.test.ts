import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The owner's 11 September 2026 rules for event promotion texts, tested without a cron, a
 * database or Twilio. Runs in both the London and the UTC suite: every instant below is written
 * in UTC and the expected London dates are stated beside it.
 */

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(),
}))

vi.mock('@/lib/email/logging', () => ({
  isEmailSuppressed: vi.fn(),
}))

import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { isEmailSuppressed } from '@/lib/email/logging'
import { resolveSmsSuspensionReason } from '@/lib/sms/suspension'
import { resolveNotificationRoute } from '@/lib/notifications/routing-matrix'
import {
  decideLastPushCapacity,
  decideLastPushTiming,
  EVENT_PROMO_TEMPLATE_KEYS,
  isEventPromoTemplateKey,
  isUnderPromoTextCap,
  loadCustomerIdsWithoutUsableEmail,
  loadPromoTextCounts,
  londonDateDaysAhead,
  PROMOTIONAL_SMS_TEMPLATE_KEYS,
  resolveEventPromoFlags,
  resolveLastPushDateWindow,
} from '../event-promo-policy'
import { argsOf, createRecordingSupabase, inValues } from '../../../../tests/mocks/recordingSupabase'

const mockFlag = vi.mocked(isMessagingFlagOn)
const mockSuppressed = vi.mocked(isEmailSuppressed)

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

/** A snapshot row for `booked` of `capacity`, the way get_event_capacity_snapshot_v05 reports it. */
function snapshot(capacity: number | null, booked: number) {
  return { capacity, seats_remaining: capacity === null ? null : capacity - booked }
}

describe('decideLastPushCapacity: fewer than a quarter booked, strictly', () => {
  it.each([
    [60, 14, true],
    [60, 15, false],
    [150, 37, true],
    [150, 38, false],
    [25, 6, true],
    [25, 7, false],
  ])('capacity %i with %i booked: push allowed is %s', (capacity, booked, allowed) => {
    const decision = decideLastPushCapacity(snapshot(capacity, booked))
    expect(decision.allowed).toBe(allowed)
    if (!decision.allowed) {
      expect(decision.reason).toBe('quarter_or_more_booked')
      expect(decision.booked).toBe(booked)
    }
  })

  it('counts live waitlist holds as booked, because seats_remaining already excludes them', () => {
    // 12 confirmed and 3 held by a live waitlist offer: 15 of 60 are taken, so no push, even
    // though the confirmed seats alone are under a quarter.
    const decision = decideLastPushCapacity({
      capacity: 60,
      seats_remaining: 45,
      confirmed_seats: 12,
      held_seats: 3,
    } as { capacity: number; seats_remaining: number })

    expect(decision).toEqual({ allowed: false, reason: 'quarter_or_more_booked', capacity: 60, booked: 15 })
  })

  it('fails closed when there is no capacity to measure against', () => {
    expect(decideLastPushCapacity(snapshot(null, 0))).toMatchObject({ allowed: false, reason: 'no_capacity' })
    expect(decideLastPushCapacity({ capacity: 0, seats_remaining: 0 })).toMatchObject({
      allowed: false,
      reason: 'no_capacity',
    })
  })

  it('fails closed when the snapshot row is missing', () => {
    expect(decideLastPushCapacity(undefined)).toMatchObject({ allowed: false, reason: 'snapshot_missing' })
    expect(decideLastPushCapacity(null)).toMatchObject({ allowed: false, reason: 'snapshot_missing' })
  })

  it('fails closed when the row has a capacity but no seats remaining figure', () => {
    expect(decideLastPushCapacity({ capacity: 60, seats_remaining: null })).toMatchObject({
      allowed: false,
      reason: 'seats_remaining_unknown',
    })
  })

  it('never pushes a sold-out night', () => {
    expect(decideLastPushCapacity(snapshot(60, 60)).allowed).toBe(false)
  })
})

describe('londonDateDaysAhead: London calendar days, never hours', () => {
  it('counts from the London date, not the UTC one', () => {
    // 23:30 UTC on Friday 11 September is 00:30 on Saturday 12 September in London.
    const londonAfterMidnight = new Date('2026-09-11T23:30:00Z')
    expect(londonDateDaysAhead(0, londonAfterMidnight)).toBe('2026-09-12')
    expect(londonDateDaysAhead(1, londonAfterMidnight)).toBe('2026-09-13')
    expect(londonDateDaysAhead(7, londonAfterMidnight)).toBe('2026-09-19')
  })

  it('keeps tomorrow on Monday through the first hour of Sunday 25 October 2026, when the clocks go back', () => {
    // 00:00, 00:30 and 00:59 BST on Sunday 25 October. Adding 24 hours to any of them lands
    // on Sunday evening GMT, which is how "tomorrow" used to come out as the same Sunday.
    for (const instant of ['2026-10-24T23:00:00Z', '2026-10-24T23:30:00Z', '2026-10-24T23:59:00Z']) {
      const now = new Date(instant)
      expect(londonDateDaysAhead(0, now)).toBe('2026-10-25')
      expect(londonDateDaysAhead(1, now)).toBe('2026-10-26')
      expect(londonDateDaysAhead(7, now)).toBe('2026-11-01')
    }
    // 01:30 BST, then 01:30 GMT an hour later: the same London Sunday both times.
    expect(londonDateDaysAhead(1, new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-26')
    expect(londonDateDaysAhead(1, new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-26')
  })

  it('keeps tomorrow on Sunday through the last hour of Saturday 27 March 2027, before the clocks go forward', () => {
    // 23:00, 23:30 and 23:59 GMT on Saturday 27 March. Adding 24 hours lands after midnight
    // BST on Monday 29 March, a day too far.
    for (const instant of ['2027-03-27T23:00:00Z', '2027-03-27T23:30:00Z', '2027-03-27T23:59:00Z']) {
      const now = new Date(instant)
      expect(londonDateDaysAhead(0, now)).toBe('2027-03-27')
      expect(londonDateDaysAhead(1, now)).toBe('2027-03-28')
      expect(londonDateDaysAhead(7, now)).toBe('2027-04-03')
    }
    // 00:30 GMT on Sunday 28 March, half an hour before the change, and 03:00 BST after it.
    expect(londonDateDaysAhead(1, new Date('2027-03-28T00:30:00Z'))).toBe('2027-03-29')
    expect(londonDateDaysAhead(1, new Date('2027-03-28T02:00:00Z'))).toBe('2027-03-29')
  })

  it('refuses a fractional number of days rather than guessing a date', () => {
    expect(() => londonDateDaysAhead(1.5, new Date('2026-09-15T08:00:00Z'))).toThrow('whole number of days')
  })
})

describe('resolveLastPushDateWindow: London calendar days, never hours', () => {
  it('uses the London date one second before midnight (BST)', () => {
    // 22:59:59 UTC is 23:59:59 on Friday 11 September in London.
    expect(resolveLastPushDateWindow(new Date('2026-09-11T22:59:59Z'))).toEqual({
      from: '2026-09-11',
      to: '2026-09-14',
    })
  })

  it('moves to the next London day at London midnight, an hour before UTC midnight', () => {
    // 23:00 UTC is 00:00 on Saturday 12 September in London.
    expect(resolveLastPushDateWindow(new Date('2026-09-11T23:00:00Z'))).toEqual({
      from: '2026-09-12',
      to: '2026-09-15',
    })
  })

  it('stays three calendar days wide across the spring clock change', () => {
    // Saturday 28 March 2026 at 23:30 GMT. Adding 72 hours would reach 00:30 BST on
    // Wednesday 1 April, the fourth day. The window must stop on Tuesday 31 March.
    expect(resolveLastPushDateWindow(new Date('2026-03-28T23:30:00Z'))).toEqual({
      from: '2026-03-28',
      to: '2026-03-31',
    })
  })

  it('stays three calendar days wide across the autumn clock change', () => {
    // Saturday 24 October 2026 at 23:30 BST, the night the clocks go back.
    expect(resolveLastPushDateWindow(new Date('2026-10-24T22:30:00Z'))).toEqual({
      from: '2026-10-24',
      to: '2026-10-27',
    })
    // 01:30 BST on Sunday 25 October, half an hour before the clocks go back.
    expect(resolveLastPushDateWindow(new Date('2026-10-25T00:30:00Z'))).toEqual({
      from: '2026-10-25',
      to: '2026-10-28',
    })
  })
})

describe('decideLastPushTiming: 0 to 3 days away and not started', () => {
  // Tuesday 15 September 2026, 09:00 BST: outside quiet hours, so a text lands at once.
  const NINE_AM_TUESDAY = new Date('2026-09-15T08:00:00Z')

  function decide(eventDate: string, startUtc: string | null, now: Date = NINE_AM_TUESDAY) {
    return decideLastPushTiming({ eventDate, eventStart: startUtc ? new Date(startUtc) : null, now })
  }

  it('does not push an event four days away', () => {
    expect(decide('2026-09-19', '2026-09-19T18:00:00Z')).toEqual({ eligible: false, reason: 'outside_window' })
  })

  it('pushes an event three days away', () => {
    expect(decide('2026-09-18', '2026-09-18T18:00:00Z')).toEqual({ eligible: true })
  })

  it('pushes an event tomorrow', () => {
    expect(decide('2026-09-16', '2026-09-16T18:00:00Z')).toEqual({ eligible: true })
  })

  it('pushes an event later today that has not started', () => {
    expect(decide('2026-09-15', '2026-09-15T18:00:00Z')).toEqual({ eligible: true })
  })

  it('does not push an event that has already started today', () => {
    expect(decide('2026-09-15', '2026-09-15T07:30:00Z')).toEqual({
      eligible: false,
      reason: 'starts_before_delivery',
    })
  })

  it('does not push an event from yesterday', () => {
    expect(decide('2026-09-14', '2026-09-14T18:00:00Z')).toEqual({ eligible: false, reason: 'outside_window' })
  })

  it('judges "not started" by when a text held by quiet hours would land', () => {
    // 02:00 BST: the text would wait until 09:00, when an 08:00 breakfast event has begun.
    const twoAm = new Date('2026-09-15T01:00:00Z')
    expect(decide('2026-09-15', '2026-09-15T07:00:00Z', twoAm)).toEqual({
      eligible: false,
      reason: 'starts_before_delivery',
    })
    expect(decide('2026-09-15', '2026-09-15T18:00:00Z', twoAm)).toEqual({ eligible: true })
  })

  it('does not push an event whose start cannot be worked out', () => {
    expect(decide('2026-09-16', null)).toEqual({ eligible: false, reason: 'start_unknown' })
  })

  it('crosses London midnight on the London date, not the UTC one', () => {
    // 23:59 BST on Friday 11 September: Tuesday 15th is four days away.
    const beforeMidnight = new Date('2026-09-11T22:59:00Z')
    expect(decide('2026-09-15', '2026-09-15T18:00:00Z', beforeMidnight)).toEqual({
      eligible: false,
      reason: 'outside_window',
    })
    // 00:00 BST on Saturday 12th, which is still 11 September in UTC: now it is three days away.
    const londonMidnight = new Date('2026-09-11T23:00:00Z')
    expect(decide('2026-09-15', '2026-09-15T18:00:00Z', londonMidnight)).toEqual({ eligible: true })
  })

  it('keeps a D+4 event out across the spring clock change', () => {
    const saturdayNight = new Date('2026-03-28T23:30:00Z')
    expect(decide('2026-03-31', '2026-03-31T18:00:00Z', saturdayNight)).toEqual({ eligible: true })
    expect(decide('2026-04-01', '2026-04-01T18:00:00Z', saturdayNight)).toEqual({
      eligible: false,
      reason: 'outside_window',
    })
  })
})

describe('loadPromoTextCounts: promotional texts in the last 30 days', () => {
  const NOW = new Date('2026-09-15T08:00:00Z')

  function build(overrides: { messagesError?: unknown; contextError?: unknown } = {}) {
    return createRecordingSupabase({
      tables: {
        messages: (query) => {
          if (overrides.messagesError) return { data: null, error: overrides.messagesError }
          const ids = inValues(query, 'customer_id')
          const rows = [
            // A: two promos, both logged in messages and in the context ledger.
            { customer_id: 'A', template_key: 'event_last_push' },
            { customer_id: 'A', template_key: 'event_cross_promo_7d' },
            // B: one staff bulk text and one promo.
            { customer_id: 'B', template_key: 'bulk_sms_campaign' },
            { customer_id: 'B', template_key: 'event_last_push_paid' },
          ]
          return { data: rows.filter((row) => ids.includes(row.customer_id)), error: null }
        },
        sms_promo_context: (query) => {
          if (overrides.contextError) return { data: null, error: overrides.contextError }
          const ids = inValues(query, 'customer_id')
          const rows = [
            { customer_id: 'A' },
            { customer_id: 'A' },
            { customer_id: 'B' },
            // C: two promos deferred by quiet hours, so the job queue has not logged them yet.
            { customer_id: 'C' },
            { customer_id: 'C' },
            // D: one.
            { customer_id: 'D' },
          ]
          return { data: rows.filter((row) => ids.includes(row.customer_id)), error: null }
        },
      },
    })
  }

  it('counts each text once, whether it shows in messages, the context ledger or both', async () => {
    const db = build()
    const counts = await loadPromoTextCounts(db.client as never, ['A', 'B', 'C', 'D', 'E'], NOW)

    expect(counts).not.toBeNull()
    expect(counts?.get('A')).toBe(2)
    // The bulk text counts on top of the engine's own promo.
    expect(counts?.get('B')).toBe(2)
    // Deferred promos count before they reach messages.
    expect(counts?.get('C')).toBe(2)
    expect(counts?.get('D')).toBe(1)
    expect(counts?.has('E')).toBe(false)
  })

  it('reads only outbound, delivered-or-pending promotional texts from the last 30 days', async () => {
    const db = build()
    await loadPromoTextCounts(db.client as never, ['A'], NOW)

    const messagesQuery = db.queries.find((query) => query.table === 'messages')!
    expect(argsOf(messagesQuery, 'eq')).toContainEqual(['direction', 'outbound'])
    expect(argsOf(messagesQuery, 'not')).toContainEqual(['status', 'in', '(failed,undelivered)'])
    expect(argsOf(messagesQuery, 'gte')).toContainEqual(['created_at', '2026-08-16T08:00:00.000Z'])

    const keys = inValues(messagesQuery, 'template_key')
    expect(keys).toEqual(expect.arrayContaining(['event_last_push', 'event_last_push_paid', 'bulk_sms_campaign']))
    // Not promotions (owner decision): the email-capture ask and review requests.
    expect(keys).not.toContain('email_capture_ask')
    expect(keys).not.toContain('table_review_followup')
    expect(keys).not.toContain('event_review_followup')

    const contextQuery = db.queries.find((query) => query.table === 'sms_promo_context')!
    expect(argsOf(contextQuery, 'gte')).toContainEqual(['created_at', '2026-08-16T08:00:00.000Z'])
  })

  it('returns null, so nothing is sent, when either read fails', async () => {
    expect(
      await loadPromoTextCounts(build({ messagesError: { message: 'boom' } }).client as never, ['A'], NOW)
    ).toBeNull()
    expect(
      await loadPromoTextCounts(build({ contextError: { message: 'boom' } }).client as never, ['A'], NOW)
    ).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('lets a guest through at one text and stops them at two', () => {
    const counts = new Map([['one', 1], ['two', 2], ['three', 3]])
    expect(isUnderPromoTextCap(counts, 'none')).toBe(true)
    expect(isUnderPromoTextCap(counts, 'one')).toBe(true)
    expect(isUnderPromoTextCap(counts, 'two')).toBe(false)
    expect(isUnderPromoTextCap(counts, 'three')).toBe(false)
  })
})

describe('loadCustomerIdsWithoutUsableEmail', () => {
  it('treats a missing, malformed, bounced, deactivated or suppressed address as no email', async () => {
    const db = createRecordingSupabase({
      tables: {
        customers: () => ({
          data: [
            { id: 'none', email: null, email_status: null, email_deactivated_at: null },
            { id: 'malformed', email: 'not-an-address', email_status: null, email_deactivated_at: null },
            { id: 'bounced', email: 'b@example.com', email_status: 'bounced', email_deactivated_at: null },
            { id: 'deactivated', email: 'd@example.com', email_status: 'valid', email_deactivated_at: '2026-08-01T00:00:00Z' },
            { id: 'suppressed', email: 's@example.com', email_status: 'valid', email_deactivated_at: null },
            { id: 'usable', email: 'u@example.com', email_status: 'valid', email_deactivated_at: null },
          ],
          error: null,
        }),
      },
    })
    mockSuppressed.mockImplementation(async (email: string) => email === 's@example.com')

    const result = await loadCustomerIdsWithoutUsableEmail(db.client as never, [
      'none',
      'malformed',
      'bounced',
      'deactivated',
      'suppressed',
      'usable',
      'not-returned',
    ])

    expect(result).toEqual(new Set(['none', 'malformed', 'bounced', 'deactivated', 'suppressed', 'not-returned']))
  })

  it('returns null, so nothing is sent, when the customer read fails', async () => {
    const db = createRecordingSupabase({
      tables: { customers: () => ({ data: null, error: { message: 'down' } }) },
    })
    expect(await loadCustomerIdsWithoutUsableEmail(db.client as never, ['a'])).toBeNull()
  })
})

describe('resolveEventPromoFlags', () => {
  it('reads as today when the last push is off, without even reading the second flag', async () => {
    mockFlag.mockResolvedValue(false)
    expect(await resolveEventPromoFlags()).toEqual({ lastPush: false, introForGuestsWithoutEmail: false })
    expect(mockFlag).toHaveBeenCalledTimes(1)
    expect(mockFlag).toHaveBeenCalledWith('event_promo_last_push')
  })

  it('ignores the no-email intro flag on its own', async () => {
    mockFlag.mockImplementation(async (key) => key === 'event_promo_intro_sms_no_email')
    expect(await resolveEventPromoFlags()).toEqual({ lastPush: false, introForGuestsWithoutEmail: false })
  })

  it('turns on the no-email intro only with the last push', async () => {
    mockFlag.mockResolvedValue(true)
    expect(await resolveEventPromoFlags()).toEqual({ lastPush: true, introForGuestsWithoutEmail: true })

    mockFlag.mockImplementation(async (key) => key === 'event_promo_last_push')
    expect(await resolveEventPromoFlags()).toEqual({ lastPush: true, introForGuestsWithoutEmail: false })
  })
})

describe('the last-push template keys are wired into everything that reads promo keys', () => {
  it('are event promotion keys and promotional texts', () => {
    expect(EVENT_PROMO_TEMPLATE_KEYS).toContain('event_last_push')
    expect(EVENT_PROMO_TEMPLATE_KEYS).toContain('event_last_push_paid')
    expect(PROMOTIONAL_SMS_TEMPLATE_KEYS).toContain('event_last_push')
    expect(isEventPromoTemplateKey('event_last_push')).toBe(true)
    expect(isEventPromoTemplateKey('event_last_push_paid')).toBe(true)
    expect(isEventPromoTemplateKey('event_general_promo_7d')).toBe(true)
    expect(isEventPromoTemplateKey('event_reminder_promo_7d_paid')).toBe(true)
    expect(isEventPromoTemplateKey('event_reminder_1d')).toBe(false)
    expect(isEventPromoTemplateKey('email_capture_ask')).toBe(false)
    expect(isEventPromoTemplateKey(null)).toBe(false)
  })

  it('are still stopped by SUSPEND_EVENT_SMS', () => {
    for (const key of ['event_last_push', 'event_last_push_paid']) {
      expect(resolveSmsSuspensionReason({ suspendEventSms: 'true', metadata: { template_key: key } })).toBe('event_sms')
    }
  })

  it('route by SMS only', () => {
    for (const key of ['event_last_push', 'event_last_push_paid']) {
      expect(resolveNotificationRoute({ templateKey: key, policy: 'email_first' }).channels).toEqual(['sms'])
    }
  })
})
