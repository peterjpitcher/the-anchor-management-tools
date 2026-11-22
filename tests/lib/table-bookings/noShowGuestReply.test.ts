import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fakeSupabase'

/**
 * A guest's reply to the morning-after no-show email (owner decisions of 22 November 2026): the
 * link, "I did come in" (the no-show undone at the booking's own time, audited, the manager told,
 * and never a dead end for the guest) and the optional reason. Run against the in-memory fake
 * database with the real plan builder and the real put-back check. The no-show tally itself is
 * lowered by the database trigger, which scripts/testing/no-show-follow-up-postgres.py covers.
 */

const { logError, audit, alert } = vi.hoisted(() => ({
  logError: vi.fn(),
  audit: vi.fn(async (_params: Record<string, unknown>) => undefined),
  alert: vi.fn(async (_db: unknown, _input: Record<string, unknown>) => ({ sent: true, duplicate: false })),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: audit } }))
vi.mock('@/lib/money-alerts', () => ({ alertMoneyNeedsAPerson: alert, MANAGER_ALERT_RECIPIENT: 'manager@the-anchor.pub' }))

import { hashGuestToken } from '@/lib/guest/tokens'
import {
  lookupNoShowFollowUpToken,
  recordGuestAttended,
  recordGuestCouldNotMakeIt,
  type NoShowReplyBooking,
} from '@/lib/table-bookings/no-show-guest-reply'
import { NO_SHOW_REASONS, describeNoShowGuestReply, formatNoShowReason } from '@/lib/table-bookings/no-show-reasons'
import { buildNoShowAttendedPlan } from '@/lib/table-bookings/staff-status-actions'

const NOW = new Date('2026-11-22T11:30:00Z')
const RAW = 'raw-token-1'

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    customer_id: 'c1',
    booking_reference: 'TB-1001',
    booking_date: '2026-11-21',
    booking_time: '19:00:00',
    start_datetime: '2026-11-21T19:00:00.000Z',
    end_datetime: '2026-11-21T21:00:00.000Z',
    party_size: 4,
    committed_party_size: 4,
    status: 'no_show',
    payment_status: null,
    deposit_waived: false,
    booking_type: 'regular',
    seated_at: null,
    left_at: null,
    no_show_at: '2026-11-22T00:00:05.000Z',
    no_show_marked_at: '2026-11-22T00:00:05.000Z',
    no_show_marked_by: null,
    no_show_guest_response: null,
    no_show_guest_reason: null,
    no_show_guest_responded_at: null,
    ...overrides,
  }
}

function seed(overrides: Record<string, unknown> = {}, extra: Record<string, Array<Record<string, unknown>>> = {}): FakeSupabase {
  return createFakeSupabase({
    customers: [{ id: 'c1', first_name: 'Sam' }],
    table_bookings: [bookingRow(overrides)],
    guest_tokens: [
      {
        id: 't1',
        hashed_token: hashGuestToken(RAW),
        action_type: 'no_show_follow_up',
        table_booking_id: 'b1',
        customer_id: 'c1',
        expires_at: '2026-12-06T10:00:00.000Z',
      },
    ],
    booking_table_assignments: [],
    ...extra,
  })
}

async function load(db: FakeSupabase): Promise<NoShowReplyBooking> {
  const lookup = await lookupNoShowFollowUpToken(db as never, RAW, NOW)
  if (!lookup.ok) throw new Error('link not found')
  return lookup.booking
}

const row = (db: FakeSupabase) => db.tables.table_bookings[0]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the link', () => {
  it('finds its booking and changes nothing by being read', async () => {
    const db = seed()
    const before = JSON.stringify(db.tables)

    const lookup = await lookupNoShowFollowUpToken(db as never, RAW, NOW)

    expect(lookup).toMatchObject({ ok: true, booking: { id: 'b1', status: 'no_show', partySize: 4, customerFirstName: 'Sam', response: null } })
    expect(JSON.stringify(db.tables)).toBe(before)
  })

  it('refuses a wrong link, an expired one and a link of another kind', async () => {
    const db = seed()
    expect(await lookupNoShowFollowUpToken(db as never, 'not-the-token', NOW)).toEqual({ ok: false })
    expect(await lookupNoShowFollowUpToken(db as never, RAW, new Date('2026-12-06T10:00:00.000Z'))).toEqual({ ok: false })
    db.tables.guest_tokens[0].action_type = 'booking_confirm'
    expect(await lookupNoShowFollowUpToken(db as never, RAW, NOW)).toEqual({ ok: false })
  })
})

describe('"I did come in"', () => {
  it('undoes the no-show at the booking\'s own time, audits it and tells the manager', async () => {
    const db = seed()

    const outcome = await recordGuestAttended(db as never, await load(db), NOW)

    expect(outcome).toEqual({ state: 'recorded', putRight: true })
    expect(row(db)).toMatchObject({
      // No longer a no-show, so the database takes it off the customer's tally.
      status: 'confirmed',
      seated_at: '2026-11-21T19:00:00.000Z',
      left_at: '2026-11-21T21:00:00.000Z',
      no_show_at: null,
      no_show_marked_at: null,
      no_show_marked_by: null,
      no_show_guest_response: 'attended',
      no_show_guest_responded_at: NOW.toISOString(),
    })
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit.mock.calls[0][0]).toMatchObject({
      operation_type: 'table_booking.no_show_guest_reply',
      resource_id: 'b1',
      additional_info: { reply: 'attended', put_right: true, status_from: 'no_show', status_to: 'confirmed' },
    })
    expect(alert).toHaveBeenCalledTimes(1)
    const note = alert.mock.calls[0][1]
    expect(note).toMatchObject({ domain: 'table_bookings', bookingId: 'b1', kind: 'no_show_guest_says_attended', subjectTag: 'GUEST REPLY' })
    // Booking facts only: never the guest's name or address.
    expect(JSON.stringify(note)).not.toContain('Sam')
    expect((note.context as Record<string, unknown>)['Booked for']).toBe('Saturday 21 November 2026 at 7pm')
  })

  it('builds the same plan staff moves build: confirmed again, stamped at the booked time', () => {
    const plan = buildNoShowAttendedPlan({
      booking: { status: 'no_show', booking_date: '2026-07-11', booking_time: '19:00:00', start_datetime: null, end_datetime: null },
      nowIso: NOW.toISOString(),
    })
    // No stored start: 19:00 London on a summer date is 18:00 UTC, in either test zone.
    expect(plan).toMatchObject({ ok: true, plan: { update: { status: 'confirmed', seated_at: '2026-07-11T18:00:00.000Z', left_at: '2026-07-11T18:00:00.000Z' } } })
    expect(buildNoShowAttendedPlan({ booking: { status: 'confirmed', booking_date: '2026-07-11', booking_time: '19:00', start_datetime: null }, nowIso: NOW.toISOString() }))
      .toMatchObject({ ok: false, status: 409 })
  })

  it('keeps the guest\'s word and asks the manager when the table has since gone to someone else', async () => {
    const db = seed({}, {
      booking_table_assignments: [
        { id: 'a1', table_booking_id: 'b1', table_id: 'table-1', start_datetime: '2026-11-21T19:00:00.000Z', end_datetime: '2026-11-21T21:00:00.000Z' },
        { id: 'a2', table_booking_id: 'b2', table_id: 'table-1', start_datetime: '2026-11-21T19:30:00.000Z', end_datetime: '2026-11-21T21:30:00.000Z' },
      ],
    })
    db.tables.table_bookings.push(bookingRow({ id: 'b2', booking_reference: 'TB-2002', status: 'confirmed', seated_at: '2026-11-21T19:30:00.000Z', no_show_at: null }))

    const outcome = await recordGuestAttended(db as never, await load(db), NOW)

    // The guest still gets their thank you; the booking is left for a person.
    expect(outcome).toEqual({ state: 'recorded', putRight: false })
    expect(row(db)).toMatchObject({ status: 'no_show', seated_at: null, no_show_guest_response: 'attended' })
    expect(alert.mock.calls[0][1]).toMatchObject({ subjectTag: 'BOOKING ACTION NEEDED' })
    expect(String(alert.mock.calls[0][1].summary)).toContain('NOT been changed')
    expect(audit.mock.calls[0][0]).toMatchObject({ additional_info: { reply: 'attended', put_right: false, status_to: 'no_show' } })
  })

  it('keeps the guest\'s word when the deposit was refunded after the no-show', async () => {
    const db = seed({ party_size: 16, committed_party_size: 16, payment_status: 'refunded' })

    const outcome = await recordGuestAttended(db as never, await load(db), NOW)

    expect(outcome).toEqual({ state: 'recorded', putRight: false })
    expect(row(db).status).toBe('no_show')
  })

  it('takes one answer only, and none once staff have changed the booking', async () => {
    const db = seed()
    const booking = await load(db)
    await recordGuestAttended(db as never, booking, NOW)

    // The same page submitted again, and a second tab with a different answer.
    expect(await recordGuestAttended(db as never, booking, NOW)).toEqual({ state: 'already_answered' })
    expect(await recordGuestCouldNotMakeIt(db as never, await load(db), { code: 'forgot', detail: '' }, NOW)).toEqual({ state: 'already_answered' })
    expect(alert).toHaveBeenCalledTimes(1)

    const sorted = seed({ status: 'confirmed', seated_at: '2026-11-21T19:02:00.000Z', no_show_at: null })
    expect(await recordGuestAttended(sorted as never, await load(sorted), NOW)).toEqual({ state: 'not_no_show' })
    expect(row(sorted).no_show_guest_response).toBeNull()
  })

  it('says so when nothing could be saved', async () => {
    const db = seed()
    const booking = await load(db)
    db.failures.push({ table: 'table_bookings', op: 'update', error: { message: 'boom' } })

    expect(await recordGuestAttended(db as never, booking, NOW)).toEqual({ state: 'failed' })
    expect(alert).not.toHaveBeenCalled()
  })
})

describe('"I couldn\'t make it"', () => {
  it('keeps the reason and the guest\'s words on the booking and changes nothing else', async () => {
    const db = seed()

    const outcome = await recordGuestCouldNotMakeIt(db as never, await load(db), { code: 'could_not_cancel', detail: '  The link   in my text did nothing ' }, NOW)

    expect(outcome).toEqual({ state: 'recorded', putRight: false })
    expect(row(db)).toMatchObject({
      status: 'no_show',
      seated_at: null,
      no_show_guest_response: 'could_not_make_it',
      no_show_guest_reason: 'could_not_cancel: The link in my text did nothing',
      no_show_guest_responded_at: NOW.toISOString(),
    })
    // The code is audited; the guest's own words stay on the booking. Nobody is emailed.
    expect(audit.mock.calls[0][0]).toMatchObject({ additional_info: { reply: 'could_not_make_it', reason_code: 'could_not_cancel' } })
    expect(JSON.stringify(audit.mock.calls[0][0])).not.toContain('did nothing')
    expect(alert).not.toHaveBeenCalled()
  })

  it('never requires a reason', async () => {
    const db = seed()

    const outcome = await recordGuestCouldNotMakeIt(db as never, await load(db), { code: null, detail: null }, NOW)

    expect(outcome).toEqual({ state: 'recorded', putRight: false })
    expect(row(db)).toMatchObject({ no_show_guest_response: 'could_not_make_it', no_show_guest_reason: null })
  })

  it('stores a code, a code with words, or words alone under other', () => {
    expect(formatNoShowReason('forgot', '')).toBe('forgot')
    expect(formatNoShowReason('on_the_day', ' Snow ')).toBe('on_the_day: Snow')
    expect(formatNoShowReason(null, 'Train was cancelled')).toBe('other: Train was cancelled')
    expect(formatNoShowReason('not-a-code', '')).toBeNull()
    expect(formatNoShowReason(undefined, undefined)).toBeNull()
    expect(formatNoShowReason('other', 'x'.repeat(500))).toHaveLength('other: '.length + 300)
    // The owner's list, in the owner's order.
    expect(NO_SHOW_REASONS.map((reason) => reason.label)).toEqual([
      'My plans changed',
      'I forgot',
      "I tried to cancel or change it and couldn't",
      "I didn't know how to cancel",
      'Something came up on the day (illness, travel, weather)',
      'I booked by mistake or booked twice',
      'Other',
    ])
  })

  it('reads back in staff words for the booking page', () => {
    expect(describeNoShowGuestReply({ response: null, reason: null })).toBeNull()
    expect(describeNoShowGuestReply({ response: 'attended', reason: null })).toBe('Said they did come in')
    expect(describeNoShowGuestReply({ response: 'could_not_make_it', reason: null })).toBe("Said they couldn't make it (no reason given)")
    expect(describeNoShowGuestReply({ response: 'could_not_make_it', reason: 'forgot' })).toBe("Couldn't make it: I forgot")
    expect(describeNoShowGuestReply({ response: 'could_not_make_it', reason: 'other: Train was cancelled' })).toBe(
      'Couldn\'t make it: Other. "Train was cancelled"',
    )
  })
})
