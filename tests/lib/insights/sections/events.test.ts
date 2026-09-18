import { describe, expect, it } from 'vitest'
import { buildInsightsReport } from '@/lib/insights/engine'
import { buildEventsSection, eventsSection } from '@/lib/insights/sections/events'
import { dedupeByEntity } from '@/lib/insights/signals'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { makeContext, TEST_APP_URL } from '../helpers/context'

// Default report instant: Friday 25 Sep 2026, 06:00 London (05:00 UTC).
// Next 7 days: Fri 25 Sep to Thu 1 Oct. Next 14 days: to Thu 8 Oct.
// Net seats cover the 7 days to now: Fri 18 Sep 06:00 London (2026-09-18T05:00Z) onwards.

type Row = Record<string, unknown>

let sequence = 0
const nextId = (prefix: string): string => `${prefix}-${String((sequence += 1)).padStart(4, '0')}`

function event(overrides: Row = {}): Row {
  return {
    id: nextId('event'),
    name: 'Quiz Night',
    date: '2026-10-06',
    time: '19:00:00',
    capacity: 60,
    booking_mode: 'table',
    seated_capacity: null,
    standing_capacity: null,
    event_status: 'scheduled',
    bookings_enabled: true,
    event_type: 'quiz',
    category_id: 'cat-quiz',
    ...overrides,
  }
}

function booking(eventRow: Row, seats: number, createdAt: string, overrides: Row = {}): Row {
  return {
    id: nextId('booking'),
    event_id: eventRow.id,
    seats,
    status: 'confirmed',
    is_reminder_only: false,
    hold_expires_at: null,
    created_at: createdAt,
    cancelled_at: null,
    // Personal data the section must never read into its text.
    customer: { first_name: 'Janet', last_name: 'Privateperson' },
    ...overrides,
  }
}

const EARLY = '2026-08-01T10:00:00Z'
const THIS_WEEK = '2026-09-20T12:00:00Z'

async function build(events: Row[], bookings: Row[] = [], now?: Date): Promise<{ result: SectionBuildResult; db: FakeDb }> {
  const db = new FakeDb({ events, bookings })
  const result = await buildEventsSection(makeContext(db, now))
  return { result, db }
}

function keys(signals: InsightSignal[]): string[] {
  return signals.map((signal) => signal.key)
}

function find(result: SectionBuildResult, key: string): InsightSignal {
  const signal = result.signals.find((item) => item.key === key)
  if (!signal) throw new Error(`No signal ${key}; have ${keys(result.signals).join(', ')}`)
  return signal
}

function expectPrintable(result: SectionBuildResult): void {
  const json = JSON.stringify(result)
  expect(json).not.toMatch(/undefined|NaN|Invalid Date|Infinity/)
  expect(json).not.toContain(String.fromCharCode(0x2014))
  expect(json).not.toMatch(/Janet|Privateperson/)
  expect(json).not.toContain('!')
}

describe('hosted events section', () => {
  it('is registered as the events section', () => {
    expect(eventsSection).toMatchObject({ key: 'events', title: 'Hosted events', path: '/events' })
    expect(eventsSection.build).toBe(buildEventsSection)
  })

  it('raises one amber list action when nothing is listed in the next fortnight', async () => {
    const { result, db } = await build([])
    expect(result.headline).toBe('No hosted events in the next 14 days.')
    expect(result.signals).toEqual([{
      key: 'events.none_listed',
      rag: 'amber',
      kind: 'issue',
      text: 'No hosted events in the next fortnight.',
      emailSafe: true,
      action: { text: 'List hosted events for the next fortnight', href: `${TEST_APP_URL}/events`, target: 'list', impact: 'money' },
    }])
    expect(result.metrics[0]).toEqual({ label: 'Events in the next 14 days', value: '0', comparison: '0 in the next 7 days' })
    expect(result.upcoming).toEqual([])
    expect(result.lists[0]).toMatchObject({ title: 'Next 14 days', items: [], emptyText: 'No hosted events in the next 14 days.' })
    // No events means no bookings read at all.
    expect(db.calls.map((call) => call.table)).toEqual(['events'])
    expectPrintable(result)
  })

  it('leaves out cancelled, draft and bookings-off events, so an otherwise empty fortnight is flagged', async () => {
    const cancelled = event({ date: '2026-09-28', event_status: 'cancelled' })
    const draft = event({ date: '2026-09-29', event_status: 'draft' })
    const bookingsOff = event({ date: '2026-09-30', bookings_enabled: false })
    const later = event({ date: '2026-10-09' })
    const { result } = await build([cancelled, draft, bookingsOff, later], [booking(cancelled, 10, EARLY)])
    expect(keys(result.signals)).toEqual(['events.none_listed'])
    expect(result.lists[0].items).toEqual([])
  })

  it('reds an event in the next 7 days that is under 25% booked, with a record action due that day', async () => {
    const quiz = event({ name: 'Quiz Night', date: '2026-09-29' })
    const { result } = await build([quiz], [booking(quiz, 5, EARLY), booking(quiz, 2, THIS_WEEK)])
    const signal = find(result, `events.low_fill.${quiz.id}`)
    expect(signal).toEqual({
      key: `events.low_fill.${quiz.id}`,
      entity: `event:${quiz.id}`,
      rag: 'red',
      kind: 'issue',
      text: 'Quiz Night (Tue 29 Sep) is 11% booked with 53 seats left.',
      emailSafe: true,
      action: {
        text: 'Promote Quiz Night (Tue 29 Sep): 11% booked, 53 seats left',
        href: `${TEST_APP_URL}/events/${quiz.id}`,
        target: 'record',
        dueDate: '2026-09-29',
        impact: 'money',
      },
    })
    expect(result.upcoming).toEqual([{
      date: '2026-09-29',
      text: 'Quiz Night, Tue 29 Sep: 11% booked',
      hasIssue: true,
      href: `${TEST_APP_URL}/events/${quiz.id}`,
    }])
    expect(result.headline).toBe('1 event in the next 14 days, 7 seats booked (11% of capacity). 1 needs attention.')
    expectPrintable(result)
  })

  it('never rounds a fill across the red threshold', async () => {
    // 24.6% must read as 24%, not 25%, next to a rule that says "under 25%".
    const quiz = event({ date: '2026-09-29', capacity: 61 })
    const { result } = await build([quiz], [booking(quiz, 15, EARLY)])
    expect(find(result, `events.low_fill.${quiz.id}`).text).toBe('Quiz Night (Tue 29 Sep) is 24% booked with 46 seats left.')
  })

  it('is not red at 25% or more, or when the event is more than 7 days away', async () => {
    const quarter = event({ date: '2026-09-29', capacity: 60 })
    const farLowFill = event({ date: '2026-10-02', capacity: 60 })
    const { result } = await build([quarter, farLowFill], [booking(quarter, 15, EARLY), booking(farLowFill, 2, THIS_WEEK)])
    expect(result.signals.filter((signal) => signal.rag === 'red')).toEqual([])
  })

  it('counts an event today', async () => {
    const tonight = event({ name: 'Karaoke', date: '2026-09-25', time: '20:00' })
    const { result } = await build([tonight], [booking(tonight, 3, EARLY)])
    expect(find(result, `events.low_fill.${tonight.id}`).action?.dueDate).toBe('2026-09-25')
    expect(result.upcoming?.[0]).toMatchObject({ date: '2026-09-25', text: 'Karaoke, Fri 25 Sep: 5% booked' })
    expect(result.lists[0].items[0].text).toBe('Karaoke, Fri 25 Sep 20:00: 3 of 60 booked (5%), 57 left. Net 0 in the last 7 days. Usually at this point: not enough history. Scheduled.')
  })

  it('ambers an event in the next 14 days with no seats booked', async () => {
    const quiz = event({ date: '2026-10-06' })
    const { result } = await build([quiz])
    expect(keys(result.signals)).toEqual([`events.no_seats.${quiz.id}`])
    expect(find(result, `events.no_seats.${quiz.id}`)).toMatchObject({
      rag: 'amber',
      text: 'Quiz Night (Tue 6 Oct) has no seats booked yet.',
      action: { text: 'Start promoting Quiz Night (Tue 6 Oct): no seats booked yet', target: 'record', dueDate: '2026-10-06' },
    })
    // Stalled needs sales to have started; zero seats is covered by the rule above.
    expect(keys(result.signals)).not.toContain(`events.stalled.${quiz.id}`)
    // Outside the next 7 days, so not in "coming up".
    expect(result.upcoming).toEqual([])
  })

  it('keeps every fact but only the red action when several rules fire for one event', async () => {
    const quiz = event({ date: '2026-09-27' })
    const { result } = await build([quiz])
    expect(keys(result.signals)).toEqual([`events.low_fill.${quiz.id}`, `events.no_seats.${quiz.id}`])
    const deduped = dedupeByEntity(result.signals)
    expect(deduped.filter((signal) => signal.action).map((signal) => signal.key)).toEqual([`events.low_fill.${quiz.id}`])
    expect(deduped.map((signal) => signal.text)).toHaveLength(2)
  })

  it('ambers sales that stalled: no net seats in 7 days and under 75% booked', async () => {
    const quiz = event({ date: '2026-10-03', capacity: 60 })
    const { result } = await build([quiz], [
      booking(quiz, 20, EARLY),
      // Booked and cancelled inside the week: net zero.
      booking(quiz, 4, '2026-09-19T10:00:00Z', { status: 'cancelled', cancelled_at: '2026-09-21T10:00:00Z' }),
    ])
    expect(keys(result.signals)).toEqual([`events.stalled.${quiz.id}`])
    expect(find(result, `events.stalled.${quiz.id}`)).toMatchObject({
      rag: 'amber',
      text: 'Sales have stalled for Quiz Night (Sat 3 Oct): no net seats booked in the last 7 days, 33% booked.',
      action: { text: 'Promote Quiz Night (Sat 3 Oct): sales have stalled at 33% booked' },
    })
    expect(result.metrics.find((metric) => metric.label === 'Net seats booked in the last 7 days')?.value).toBe('0')
  })

  it('works out net seats as new seats less cancellations and lapsed holds over the 7 days to now', async () => {
    // The 7 days run from Fri 18 Sep 06:00 London (05:00 UTC) to now, Fri 25 Sep 06:00.
    const quiz = event({ date: '2026-10-03', capacity: 100 })
    const { result } = await build([quiz], [
      booking(quiz, 30, EARLY),
      // Fri 18 Sep 05:30 London: the right day but before the same clock time, so not new.
      booking(quiz, 3, '2026-09-18T04:30:00Z'),
      // Fri 18 Sep 06:30 London: inside the 7 days.
      booking(quiz, 2, '2026-09-18T05:30:00Z'),
      booking(quiz, 6, THIS_WEEK),
      // Booked before the 7 days, cancelled during them.
      booking(quiz, 9, EARLY, { status: 'cancelled', cancelled_at: THIS_WEEK }),
      // Booked before the 7 days, cancelled early this morning: still inside them.
      booking(quiz, 2, EARLY, { status: 'cancelled', cancelled_at: '2026-09-25T01:00:00Z' }),
      // A hold taken and lapsed inside the 7 days: never a net seat.
      booking(quiz, 5, '2026-09-19T10:00:00Z', { status: 'expired', hold_expires_at: '2026-09-19T10:30:00Z' }),
      // Booked at 05:00 this morning: before now, so a new seat like any other.
      booking(quiz, 1, '2026-09-25T04:00:00Z'),
      // Booked after now: not on the books yet.
      booking(quiz, 4, '2026-09-25T05:30:00Z'),
    ])
    // Booked: 30 + 3 + 2 + 6 + 1. Net: 2 + 6 - 9 - 2 + 1.
    expect(result.lists[0].items[0].text).toContain('42 of 100 booked (42%), 58 left. Net -2 in the last 7 days.')
    expect(result.metrics.find((metric) => metric.label === 'Net seats booked in the last 7 days')?.value).toBe('-2')
    expect(keys(result.signals)).toEqual([`events.stalled.${quiz.id}`])
  })

  it('counts seats booked earlier today when the page is opened mid-day, so it does not call sales stalled', async () => {
    // Tue 22 Sep 2026, 15:00 London: the 7 days run from Tue 15 Sep 15:00 London.
    const now = new Date('2026-09-22T14:00:00Z')
    const quiz = event({ date: '2026-10-03', capacity: 60 })
    const { result } = await build([quiz], [
      booking(quiz, 20, EARLY),
      // 10:00 London today.
      booking(quiz, 10, '2026-09-22T09:00:00Z'),
    ], now)
    expect(keys(result.signals)).not.toContain(`events.stalled.${quiz.id}`)
    expect(result.lists[0].items[0].text).toContain('30 of 60 booked (50%), 30 left. Net +10 in the last 7 days.')
    expect(result.metrics.find((metric) => metric.label === 'Net seats booked in the last 7 days')?.value).toBe('+10')
  })

  it('calls an event stalled mid-day when its only recent seats were booked just over 7 days ago', async () => {
    // Tue 22 Sep 2026, 15:00 London. Tue 15 Sep 14:30 London is outside the 7 days;
    // 15:30 London that day is inside them.
    const now = new Date('2026-09-22T14:00:00Z')
    const outside = event({ date: '2026-10-03', capacity: 60 })
    const inside = event({ date: '2026-10-04', capacity: 60 })
    const { result } = await build([outside, inside], [
      booking(outside, 20, EARLY),
      booking(outside, 5, '2026-09-15T13:30:00Z'),
      booking(inside, 20, EARLY),
      booking(inside, 5, '2026-09-15T14:30:00Z'),
    ], now)
    expect(keys(result.signals)).toEqual([`events.stalled.${outside.id}`])
    expect(result.lists[0].items.map((item) => item.text.match(/Net [^ ]+/)?.[0])).toEqual(['Net 0', 'Net +5'])
  })

  it('measures the 7 days to the same London clock time across a clock change', async () => {
    // Fri 30 Oct 2026, 06:00 GMT. The 7 days start at Fri 23 Oct 06:00 London, which was
    // 05:00 UTC in summer time. Going back 7 x 24 hours would start at 07:00 London instead.
    const now = new Date('2026-10-30T06:00:00Z')
    const quiz = event({ date: '2026-11-07', capacity: 60 })
    const { result } = await build([quiz], [
      booking(quiz, 20, '2026-09-01T10:00:00Z'),
      // 06:30 London on Fri 23 Oct.
      booking(quiz, 5, '2026-10-23T05:30:00Z'),
    ], now)
    expect(result.lists[0].items[0].text).toContain('Net +5 in the last 7 days.')
    expect(keys(result.signals)).not.toContain(`events.stalled.${quiz.id}`)
  })

  it('counts confirmed and attended seats and unexpired holds, never lapsed holds, cancellations or reminder-only rows', async () => {
    const quiz = event({ date: '2026-10-03', capacity: 100 })
    const { result } = await build([quiz], [
      booking(quiz, 10, EARLY),
      booking(quiz, 3, EARLY, { status: 'visited_waiting_for_review' }),
      booking(quiz, 2, EARLY, { status: 'completed' }),
      booking(quiz, 1, EARLY, { status: 'review_clicked' }),
      booking(quiz, 4, '2026-09-25T04:30:00Z', { status: 'pending_payment', hold_expires_at: '2026-09-25T05:15:00Z' }),
      booking(quiz, 7, '2026-09-25T03:00:00Z', { status: 'pending_payment', hold_expires_at: '2026-09-25T04:00:00Z' }),
      booking(quiz, 8, EARLY, { status: 'expired', hold_expires_at: '2026-08-01T10:15:00Z' }),
      booking(quiz, 5, EARLY, { status: 'cancelled', cancelled_at: '2026-08-02T10:00:00Z' }),
      booking(quiz, 50, EARLY, { is_reminder_only: true }),
    ])
    // 10 + 3 + 2 + 1 + 4 (unexpired hold).
    expect(result.metrics.find((metric) => metric.label === 'Seats booked')?.value).toBe('20')
  })

  describe('usually at this point', () => {
    // Upcoming Thu 1 Oct is 6 days out. Past nights on Thu 24, 17 and 10 Sep are measured
    // at 06:00 London 6 days before each: 18 Sep, 11 Sep and 4 Sep (05:00 UTC in summer).
    function paceFixture(): { events: Row[]; bookings: Row[]; upcoming: Row } {
      const upcoming = event({ name: 'Bingo Night', date: '2026-10-01', capacity: 20, event_type: 'bingo', category_id: 'cat-games' })
      const a = event({ name: 'Bingo Night', date: '2026-09-24', event_type: 'bingo', category_id: 'cat-games' })
      const b = event({ name: 'Bingo Night', date: '2026-09-17', event_type: 'bingo', category_id: 'cat-games' })
      const c = event({ name: 'Bingo Night', date: '2026-09-10', event_type: 'bingo', category_id: 'cat-games' })
      // Not comparable: cancelled, draft, postponed or bookings off, however recent.
      const cancelledNight = event({ date: '2026-09-23', event_type: 'bingo', event_status: 'cancelled' })
      const draftNight = event({ date: '2026-09-22', event_type: 'bingo', event_status: 'draft' })
      const postponedNight = event({ date: '2026-09-21', event_type: 'bingo', event_status: 'postponed' })
      const offNight = event({ date: '2026-09-20', event_type: 'bingo', bookings_enabled: false })
      const bookings = [
        booking(upcoming, 8, THIS_WEEK),
        // a: 20 on the books on 18 Sep 06:00.
        booking(a, 20, EARLY),
        booking(a, 10, '2026-09-20T10:00:00Z'), // booked after the as-of moment
        booking(a, 4, EARLY, { status: 'cancelled', cancelled_at: '2026-09-15T10:00:00Z' }), // cancelled before it
        // b: 17 + 3 cancelled only after 11 Sep 06:00, so still on the books then.
        booking(b, 17, EARLY),
        booking(b, 3, EARLY, { status: 'cancelled', cancelled_at: '2026-09-12T10:00:00Z' }),
        // c: 16 + a 4-seat hold still live on 4 Sep 06:00; a lapsed hold does not count.
        booking(c, 16, EARLY),
        booking(c, 4, '2026-09-03T10:00:00Z', { status: 'expired', hold_expires_at: '2026-09-05T00:00:00Z' }),
        booking(c, 5, '2026-09-01T10:00:00Z', { status: 'expired', hold_expires_at: '2026-09-02T00:00:00Z' }),
        booking(c, 30, EARLY, { is_reminder_only: true }),
        // Walk-ins added after the night: created after the as-of moment.
        booking(a, 12, '2026-10-01T10:00:00Z', { booking_source: 'bulk_add' }),
        booking(cancelledNight, 100, EARLY),
        booking(draftNight, 100, EARLY),
        booking(postponedNight, 100, EARLY),
        booking(offNight, 100, EARLY),
      ]
      return { events: [upcoming, a, b, c, cancelledNight, draftNight, postponedNight, offNight], bookings, upcoming }
    }

    it('ambers an event under 60% of comparable nights by at least 5 seats, using the as-of rule', async () => {
      const { events, bookings, upcoming } = paceFixture()
      const { result } = await build(events, bookings)
      expect(keys(result.signals)).toEqual([`events.behind_usual.${upcoming.id}`])
      expect(find(result, `events.behind_usual.${upcoming.id}`)).toMatchObject({
        rag: 'amber',
        kind: 'issue',
        text: 'Bingo Night (Thu 1 Oct) is behind comparable nights: 8 seats booked against 20 usually at this point.',
        emailSafe: true,
        action: {
          text: 'Promote Bingo Night (Thu 1 Oct): behind comparable nights, 8 seats vs 20 usually',
          target: 'record',
          dueDate: '2026-10-01',
          impact: 'money',
        },
      })
      expect(result.lists[0].items[0].text).toBe('Bingo Night, Thu 1 Oct 19:00: 8 of 20 booked (40%), 12 left. Net +8 in the last 7 days. Usually 20 at this point. Scheduled.')
      expect(result.metrics.find((metric) => metric.label === 'Against comparable nights')).toEqual({
        label: 'Against comparable nights',
        value: '8 seats vs 20 usually',
        comparison: 'down 60% on comparable nights, across 1 event',
      })
      expect(result.notes).toEqual([])
    })

    it('does not flag a gap under 5 seats', async () => {
      const upcoming = event({ date: '2026-10-01', capacity: 10, event_type: 'bingo' })
      const past = ['2026-09-24', '2026-09-17', '2026-09-10'].map((date) => event({ date, event_type: 'bingo' }))
      const bookings = [booking(upcoming, 3, THIS_WEEK), ...past.map((row) => booking(row, 6, EARLY))]
      const { result } = await build([upcoming, ...past], bookings)
      // 3 is under 60% of 6, but only 3 seats behind.
      expect(keys(result.signals)).toEqual([])
    })

    it('uses the 6 most recent comparable nights only', async () => {
      const upcoming = event({ date: '2026-10-06', capacity: 100, event_type: 'quiz' })
      const dates = ['2026-09-22', '2026-09-15', '2026-09-08', '2026-09-01', '2026-08-25', '2026-08-18', '2026-08-11']
      const past = dates.map((date) => event({ date, event_type: 'quiz' }))
      const bookings = [
        booking(upcoming, 30, THIS_WEEK),
        ...past.slice(0, 6).map((row) => booking(row, 12, '2026-06-01T10:00:00Z')),
        // The seventh-most-recent night would drag the average up if it were used.
        booking(past[6], 600, '2026-06-01T10:00:00Z'),
      ]
      const { result } = await build([upcoming, ...past], bookings)
      expect(result.lists[0].items[0].text).toContain('Usually 12 at this point.')
      // 30 against 12 usually: at least 25% and 5 seats ahead.
      expect(find(result, `events.win.${upcoming.id}`).text).toBe('Quiz Night (Tue 6 Oct) is ahead of comparable nights: 30 seats booked against 12 usually at this point.')
    })

    it('ignores past nights older than 26 weeks', async () => {
      const upcoming = event({ date: '2026-10-06', event_type: 'quiz' })
      // 26 weeks before Fri 25 Sep is Fri 27 Mar: one night inside, two before it.
      const past = ['2026-03-27', '2026-03-26', '2026-03-19'].map((date) => event({ date, event_type: 'quiz' }))
      const bookings = [booking(upcoming, 10, THIS_WEEK), ...past.map((row) => booking(row, 5, '2026-01-01T10:00:00Z'))]
      const { result } = await build([upcoming, ...past], bookings)
      expect(result.lists[0].items[0].text).toContain('Usually at this point: not enough history.')
    })

    it('falls back to the same category when the series has fewer than 3 past nights', async () => {
      const upcoming = event({ name: 'Karaoke', date: '2026-10-06', capacity: 60, event_type: 'karaoke', category_id: 'cat-music' })
      const pastKaraoke = event({ date: '2026-09-15', event_type: 'karaoke', category_id: 'cat-music' })
      const others = ['2026-09-12', '2026-09-05'].map((date) => event({ date, event_type: 'live-music', category_id: 'cat-music' }))
      const bookings = [booking(upcoming, 20, THIS_WEEK), ...[pastKaraoke, ...others].map((row) => booking(row, 10, EARLY))]
      const { result } = await build([upcoming, pastKaraoke, ...others], bookings)
      expect(result.lists[0].items[0].text).toContain('Usually 10 at this point (same category).')
      expect(result.notes).toEqual(['Where a series has fewer than 3 past nights, events in the same category are the comparison.'])
    })

    it('shows "not enough history" and raises no pace signal with fewer than 3 comparable nights', async () => {
      const upcoming = event({ name: 'Tasting', date: '2026-10-06', capacity: 30, event_type: 'tasting', category_id: 'cat-food' })
      const past = ['2026-09-15', '2026-09-08'].map((date) => event({ date, event_type: 'tasting', category_id: 'cat-food' }))
      // Past nights were busy; with only two, no comparison is made.
      const bookings = [booking(upcoming, 8, THIS_WEEK), ...past.map((row) => booking(row, 30, EARLY))]
      const { result } = await build([upcoming, ...past], bookings)
      expect(keys(result.signals)).toEqual([])
      expect(result.lists[0].items[0].text).toContain('Usually at this point: not enough history.')
      expect(result.notes).toEqual(['Not enough history yet to compare 1 event with past nights: "usually at this point" needs 3 comparable events in the last 26 weeks.'])
      expect(result.metrics.map((metric) => metric.label)).not.toContain('Against comparable nights')
    })

    it('measures past nights at the same London clock time across a clock change', async () => {
      // Fri 30 Oct 2026 06:00 GMT. Sun 1 Nov is 2 days out, so past Fridays 23, 16 and 9 Oct
      // are measured at 06:00 London on 21, 14 and 7 Oct: 05:00 UTC, in summer time.
      const now = new Date('2026-10-30T06:00:00Z')
      const upcoming = event({ date: '2026-11-01', capacity: 100, event_type: 'quiz' })
      const past = ['2026-10-23', '2026-10-16', '2026-10-09'].map((date) => event({ date, event_type: 'quiz' }))
      const bookings = [
        booking(upcoming, 40, '2026-10-26T10:00:00Z'),
        ...past.map((row) => booking(row, 10, '2026-09-01T10:00:00Z')),
        // 06:30 London on 21 Oct: after the as-of moment. Subtracting 9 x 24 hours from
        // 06:00 GMT would wrongly land at 07:00 London and count it.
        booking(past[0], 30, '2026-10-21T05:30:00Z'),
      ]
      const { result } = await build([upcoming, ...past], bookings, now)
      expect(result.lists[0].items[0].text).toContain('Usually 10 at this point.')
    })
  })

  it('ambers an event with no capacity set and makes no fill claims for it', async () => {
    const quiz = event({ name: 'Open Mic', date: '2026-10-02', capacity: null })
    const withCapacity = event({ date: '2026-10-05', capacity: 50 })
    const { result } = await build([quiz, withCapacity], [booking(quiz, 10, THIS_WEEK), booking(withCapacity, 40, THIS_WEEK)])
    expect(find(result, `events.no_capacity.${quiz.id}`)).toMatchObject({
      rag: 'amber',
      text: 'Open Mic (Fri 2 Oct) has no capacity set, so its fill cannot be tracked.',
      action: { text: 'Set a capacity for Open Mic (Fri 2 Oct) so fill can be tracked', target: 'record', impact: 'housekeeping' },
    })
    expect(result.signals.filter((signal) => signal.entity === `event:${quiz.id}`).map((signal) => signal.key)).toEqual([`events.no_capacity.${quiz.id}`])
    expect(result.lists[0].items[0].text).toContain('Open Mic, Fri 2 Oct 19:00: 10 booked, no capacity set.')
    expect(result.metrics.find((metric) => metric.label === 'Seats booked')).toEqual({
      label: 'Seats booked',
      value: '50',
      comparison: '80% of 50 seats on the 1 event with a capacity',
    })
    expect(result.headline).toBe('2 events in the next 14 days, 50 seats booked. 1 needs attention.')
    expectPrintable(result)
  })

  it('uses the seated and standing split for communal events, as /events does', async () => {
    const communal = event({ date: '2026-10-05', capacity: null, booking_mode: 'communal', seated_capacity: 30, standing_capacity: 10 })
    const { result } = await build([communal], [booking(communal, 30, THIS_WEEK)])
    expect(keys(result.signals)).toEqual([`events.win.${communal.id}`])
    expect(result.lists[0].items[0].text).toContain('30 of 40 booked (75%), 10 left.')
  })

  it('does not list a postponed event but asks for a new date or a cancellation', async () => {
    const postponed = event({ name: 'Music Bingo', date: '2026-09-30', event_status: 'postponed' })
    const listed = event({ date: '2026-10-06' })
    const { result } = await build([postponed, listed], [booking(postponed, 6, EARLY), booking(listed, 30, THIS_WEEK)])
    expect(find(result, `events.postponed.${postponed.id}`)).toEqual({
      key: `events.postponed.${postponed.id}`,
      entity: `event:${postponed.id}`,
      rag: 'amber',
      kind: 'issue',
      text: 'Postponed: Music Bingo (Wed 30 Sep) needs a new date or cancelling; 6 seats booked.',
      emailSafe: true,
      action: {
        text: 'Give Music Bingo (Wed 30 Sep) a new date or cancel it',
        href: `${TEST_APP_URL}/events/${postponed.id}`,
        target: 'record',
        dueDate: '2026-09-30',
        impact: 'customer',
      },
    })
    expect(result.lists[0].items.map((item) => item.href)).toEqual([`${TEST_APP_URL}/events/${listed.id}`])
    expect(result.lists[1]).toEqual({
      title: 'Postponed',
      items: [{ text: 'Music Bingo, was Wed 30 Sep: 6 seats booked. Needs a new date or cancelling.', href: `${TEST_APP_URL}/events/${postponed.id}`, rag: 'amber' }],
    })
    expect(result.upcoming).toEqual([])
  })

  it('counts only listed events as needing attention and names postponed ones on their own', async () => {
    const postponed = event({ name: 'Music Bingo', date: '2026-09-30', event_status: 'postponed' })
    const onTrack = event({ name: 'Live Music', date: '2026-10-05' })
    const { result } = await build([postponed, onTrack], [booking(onTrack, 50, THIS_WEEK)])
    expect(find(result, `events.win.${onTrack.id}`).kind).toBe('win')
    // The one listed event is fine, so nothing reads as if it needs attention.
    expect(result.headline).toBe('1 event in the next 14 days, 50 seats booked (83% of capacity). 1 postponed event needs a new date.')
    expect(result.metrics).toContainEqual({ label: 'Events needing attention', value: '0' })
    expect(result.metrics).toContainEqual({ label: 'Postponed in the next 14 days', value: '1' })

    const noCapacity = event({ name: 'Open Mic', date: '2026-10-07', capacity: null })
    const two = await build([postponed, onTrack, noCapacity], [booking(onTrack, 50, THIS_WEEK), booking(noCapacity, 10, THIS_WEEK)])
    expect(two.result.headline).toBe('2 events in the next 14 days, 60 seats booked. 1 needs attention. 1 postponed event needs a new date.')
    expect(two.result.metrics).toContainEqual({ label: 'Events needing attention', value: '1' })
    expectPrintable(two.result)
  })

  it('still flags an empty fortnight when the only event in it is postponed', async () => {
    const postponed = event({ date: '2026-09-30', event_status: 'postponed' })
    const { result } = await build([postponed])
    expect(keys(result.signals)).toEqual([`events.postponed.${postponed.id}`, 'events.none_listed'])
    expect(result.headline).toBe('No hosted events in the next 14 days; 1 postponed event needs a new date.')
  })

  it('lists a rescheduled event once, on its current date', async () => {
    const moved = event({ name: 'Live Music', date: '2026-10-05', event_status: 'rescheduled' })
    const { result } = await build([moved], [booking(moved, 50, EARLY)])
    expect(result.lists[0].items).toHaveLength(1)
    expect(result.lists[0].items[0].text).toBe('Live Music, Mon 5 Oct 19:00: 50 of 60 booked (83%), 10 left. Net 0 in the last 7 days. Usually at this point: not enough history. Rescheduled.')
  })

  describe('wins', () => {
    it('shows a sold-out status as a visible win and never asks to promote it', async () => {
      const soldOut = event({ name: 'Comedy', date: '2026-09-27', event_status: 'sold_out' })
      const { result } = await build([soldOut], [booking(soldOut, 10, EARLY)])
      expect(result.signals).toEqual([{
        key: `events.win.${soldOut.id}`,
        entity: `event:${soldOut.id}`,
        rag: 'green',
        kind: 'win',
        text: 'Comedy (Sun 27 Sep) is sold out.',
        emailSafe: true,
      }])
      expect(result.upcoming).toEqual([{ date: '2026-09-27', text: 'Comedy, Sun 27 Sep: sold out', hasIssue: false, href: `${TEST_APP_URL}/events/${soldOut.id}` }])
      expect(result.lists[0].items[0]).toMatchObject({ rag: 'green' })
      expect(result.lists[0].items[0].text).toMatch(/Sold out\.$/)
      expect(result.headline).toBe('1 event in the next 14 days, 10 seats booked (16% of capacity). All on track.')
    })

    it('treats no seats remaining as sold out', async () => {
      const full = event({ date: '2026-10-04', capacity: 40 })
      const { result } = await build([full], [booking(full, 42, EARLY)])
      expect(find(result, `events.win.${full.id}`).text).toBe('Quiz Night (Sun 4 Oct) is sold out.')
      expect(result.lists[0].items[0].text).toContain('42 of 40 booked (105%), 0 left.')
    })

    it('calls 75% or more booked a win', async () => {
      const busy = event({ date: '2026-10-04', capacity: 60 })
      const { result } = await build([busy], [booking(busy, 45, EARLY)])
      expect(result.signals.map((signal) => [signal.key, signal.kind, signal.text])).toEqual([
        [`events.win.${busy.id}`, 'win', 'Quiz Night (Sun 4 Oct) is 75% booked.'],
      ])
    })
  })

  it('reads only events and bookings, once each, with no names in any text', async () => {
    const quiz = event({ date: '2026-09-29' })
    const { result, db } = await build([quiz], [booking(quiz, 5, EARLY)])
    expect(db.calls.map((call) => call.table)).toEqual(['events', 'bookings'])
    expect(result.signals.every((signal) => signal.emailSafe)).toBe(true)
    expectPrintable(result)
  })

  it('splits a long list of event ids across bookings reads', async () => {
    const many = Array.from({ length: 120 }, (_, index) => event({ date: index % 2 ? '2026-10-06' : '2026-10-07' }))
    const { result, db } = await build(many, many.map((row) => booking(row, 1, EARLY)))
    expect(db.calls.filter((call) => call.table === 'bookings')).toHaveLength(2)
    expect(result.metrics.find((metric) => metric.label === 'Seats booked')?.value).toBe('120')
  })

  it('throws when bookings cannot be read, so the engine marks the section not checked', async () => {
    const quiz = event({ date: '2026-09-29' })
    const db = new FakeDb({ events: [quiz], bookings: [] }).fail('bookings')
    await expect(buildEventsSection(makeContext(db))).rejects.toThrow('insights event bookings failed')

    const report = await buildInsightsReport({
      createDb: () => db.asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: TEST_APP_URL,
      sections: [eventsSection],
      logFailure: () => undefined,
    })
    expect(report.sections[0].status).toBe('not_checked')
  })

  it('gives the engine one primary action per event and a red section for a weak night this week', async () => {
    const weak = event({ name: 'Quiz Night', date: '2026-09-28' })
    const unsized = event({ name: 'Open Mic', date: '2026-10-06', capacity: null })
    const soldOut = event({ name: 'Comedy', date: '2026-09-26', event_status: 'sold_out' })
    const db = new FakeDb({ events: [weak, unsized, soldOut], bookings: [booking(soldOut, 60, EARLY)] })
    const report = await buildInsightsReport({
      createDb: () => db.asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: TEST_APP_URL,
      sections: [eventsSection],
      logFailure: () => undefined,
    })
    const section = report.sections[0]
    expect(section.status).toBe('red')
    expect(section.signals.filter((signal) => signal.action).map((signal) => signal.key)).toEqual([
      `events.low_fill.${weak.id}`,
      `events.no_seats.${unsized.id}`,
    ])
    expect(report.actions.map((action) => action.text)).toEqual([
      'Promote Quiz Night (Mon 28 Sep): 0% booked, 60 seats left',
      'Start promoting Open Mic (Tue 6 Oct): no seats booked yet',
    ])
    // A win in a red section is not the headline good news.
    expect(report.summary.biggestWin).toBeNull()
    expect(report.summary.comingUp).toMatchObject({ date: '2026-09-28', text: 'Quiz Night, Mon 28 Sep: 0% booked', hasIssue: true })
  })
})
