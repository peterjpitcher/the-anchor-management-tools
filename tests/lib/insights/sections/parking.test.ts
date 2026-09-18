import { describe, expect, it } from 'vitest'
import { buildParkingSection, parkingSection } from '@/lib/insights/sections/parking'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { makeContext } from '../helpers/context'

/**
 * Default report instant: Friday 25 Sep 2026 06:00 London (05:00Z).
 *   this week        Fri 18 Sep to Thu 24 Sep
 *   previous 4 weeks Fri 21 Aug to Thu 17 Sep
 *   previous 13 weeks Fri 19 Jun to Thu 17 Sep
 *   next 14 days     Fri 25 Sep to Thu 8 Oct
 * BST until 25 Oct, so a London day starts at 23:00Z the evening before.
 */

type Row = Record<string, unknown>
let sequence = 0

interface BookingInput {
  created?: string
  start: string
  end: string
  status?: 'pending_payment' | 'confirmed' | 'completed' | 'cancelled' | 'expired'
  due?: string | null
}

/** Rows carry personal fields so the tests can prove none of them reach the output. */
function booking(input: BookingInput): Row {
  sequence += 1
  const status = input.status ?? 'confirmed'
  return {
    id: `pb-${String(sequence).padStart(4, '0')}`,
    reference: `PAR-TEST-${sequence}`,
    customer_first_name: 'Harriet',
    customer_last_name: 'Quimby',
    customer_mobile: '+447700900123',
    vehicle_registration: 'AB12 CDE',
    // Default: received long before any report window, so only the fixture's dates count.
    created_at: input.created ?? '2026-01-15T10:00:00.000Z',
    start_at: input.start,
    end_at: input.end,
    status,
    payment_status: status === 'confirmed' || status === 'completed' ? 'paid' : 'pending',
    payment_due_at: input.due === undefined ? null : input.due,
    expires_at: input.due === undefined ? null : input.due,
  }
}

/** Shaped like the live bookings on 18 Sep 2026 (statuses and dates only): the last made on 2 June. */
const HISTORIC: Row[] = [
  booking({ created: '2025-10-12T16:14:33.000Z', start: '2025-11-03T20:00:00.000Z', end: '2025-11-04T05:00:00.000Z' }),
  booking({ created: '2025-10-27T19:14:27.000Z', start: '2025-10-29T15:00:00.000Z', end: '2025-10-29T18:00:00.000Z', status: 'cancelled' }),
  booking({ created: '2026-01-09T18:38:05.000Z', start: '2026-03-11T17:00:00.000Z', end: '2026-03-11T20:00:00.000Z', status: 'expired' }),
  booking({ created: '2026-03-06T23:11:53.000Z', start: '2026-03-29T07:30:00.000Z', end: '2026-03-29T12:00:00.000Z', status: 'cancelled' }),
  booking({ created: '2026-04-20T15:56:03.000Z', start: '2026-05-28T14:00:00.000Z', end: '2026-05-28T18:00:00.000Z', status: 'expired' }),
  booking({ created: '2026-06-02T16:43:56.000Z', start: '2026-06-04T13:00:00.000Z', end: '2026-06-04T17:00:00.000Z' }),
]

const RATE = { id: 'rate-1', effective_from: '2025-10-03T09:50:49.000Z', capacity_override: null }

/** `count` confirmed bookings all parked at once on a London day (12:00 to 15:00 BST). */
function sameTime(date: string, count: number, extra: Partial<BookingInput> = {}): Row[] {
  return Array.from({ length: count }, () => booking({ start: `${date}T11:00:00.000Z`, end: `${date}T14:00:00.000Z`, ...extra }))
}

async function build(tables: Record<string, Row[]>, now?: Date): Promise<{ result: SectionBuildResult; db: FakeDb }> {
  const db = new FakeDb({ parking_rates: [RATE], ...tables })
  const result = await buildParkingSection(makeContext(db, now))
  return { result, db }
}

function signal(result: SectionBuildResult, key: string): InsightSignal | undefined {
  return result.signals.find((item) => item.key === key)
}

function everyText(result: SectionBuildResult): string {
  return JSON.stringify(result)
}

function expectCleanText(result: SectionBuildResult): void {
  const text = everyText(result)
  for (const bad of ['undefined', 'NaN', 'Invalid Date', '!', String.fromCharCode(0x2014)]) {
    expect(text).not.toContain(bad)
  }
  for (const personal of ['Harriet', 'Quimby', '+4477', 'AB12', 'PAR-TEST']) {
    expect(text).not.toContain(personal)
  }
}

describe('parking section', () => {
  it('is registered as the parking section linking to /parking', () => {
    expect(parkingSection).toMatchObject({ key: 'parking', title: 'Parking', path: '/parking' })
  })

  it('prints one green line when parking is dormant, as it is live today', async () => {
    const { result, db } = await build({ parking_bookings: HISTORIC })
    expect(result).toEqual({
      headline: 'No bookings in 13 weeks and none coming up.',
      metrics: [],
      lists: [],
      signals: [],
      notes: [],
    })
    // Two reads: one paged read of bookings and one rate lookup. Nothing else.
    expect(db.calls.map((call) => call.table).sort()).toEqual(['parking_bookings', 'parking_rates'])
  })

  it('prints the same line with no bookings and no rate at all', async () => {
    const db = new FakeDb({ parking_bookings: [], parking_rates: [] })
    const result = await buildParkingSection(makeContext(db))
    expect(result.headline).toBe('No bookings in 13 weeks and none coming up.')
    expect(result.signals).toEqual([])
  })

  it('fails loudly when bookings cannot be read, so the section shows as not checked', async () => {
    const db = new FakeDb({ parking_rates: [RATE] }).fail('parking_bookings')
    await expect(buildParkingSection(makeContext(db))).rejects.toThrow(/insights parking bookings failed/)
  })

  it('fails loudly when the rate cannot be read', async () => {
    const db = new FakeDb({ parking_bookings: [] }).fail('parking_rates')
    await expect(buildParkingSection(makeContext(db))).rejects.toThrow(/insights parking rate failed/)
  })

  it('raises red when a day is at capacity, with a list action on /parking due that day', async () => {
    const { result } = await build({ parking_bookings: sameTime('2026-09-26', 10) })
    const red = signal(result, 'parking.at_capacity.2026-09-26')
    expect(red).toEqual({
      key: 'parking.at_capacity.2026-09-26',
      entity: 'parking_day:2026-09-26',
      rag: 'red',
      kind: 'issue',
      text: 'Parking is full on Sat 26 Sep: all 10 spaces are booked at the busiest time.',
      emailSafe: true,
      action: {
        text: 'Keep all 10 spaces free for booked cars on Sat 26 Sep',
        href: 'https://management.example.test/parking',
        target: 'list',
        dueDate: '2026-09-26',
        impact: 'customer',
      },
    })
    expect(result.headline).toBe(red?.text)
    expectCleanText(result)
  })

  it('raises red with "over capacity" wording when more cars are booked than spaces', async () => {
    const { result } = await build({ parking_bookings: sameTime('2026-09-27', 11) })
    const red = signal(result, 'parking.at_capacity.2026-09-27')
    expect(red?.rag).toBe('red')
    expect(red?.text).toBe('Parking is over capacity on Sun 27 Sep: 11 cars booked at the busiest time for 10 spaces.')
    expect(red?.action?.text).toBe('Sort out parking for Sun 27 Sep: 11 cars booked for 10 spaces')
  })

  it('raises amber at 80% and nothing below it', async () => {
    const { result } = await build({
      parking_bookings: [...sameTime('2026-09-28', 8), ...sameTime('2026-09-30', 7)],
    })
    const amber = signal(result, 'parking.near_capacity.2026-09-28')
    expect(amber).toMatchObject({
      rag: 'amber',
      kind: 'issue',
      entity: 'parking_day:2026-09-28',
      emailSafe: true,
      text: 'Parking is nearly full on Mon 28 Sep: 8 of 10 spaces booked at the busiest time.',
      action: { target: 'list', dueDate: '2026-09-28', impact: 'customer', href: 'https://management.example.test/parking' },
    })
    expect(result.signals.filter((item) => item.kind === 'issue')).toHaveLength(1)
    expect(result.headline).toBe(amber?.text)
    // Both days appear in the page list; only the busy one is marked.
    expect(result.lists[0].items.map((item) => [item.text, item.rag])).toEqual([
      ['Mon 28 Sep: 8 bookings, 8 of 10 spaces at the busiest time', 'amber'],
      ['Wed 30 Sep: 7 bookings, 7 of 10 spaces at the busiest time', undefined],
    ])
  })

  it('uses the capacity override on the rate in force, ignoring a future rate', async () => {
    const { result } = await build({
      parking_rates: [
        RATE,
        { id: 'rate-2', effective_from: '2026-09-01T00:00:00.000Z', capacity_override: 4 },
        { id: 'rate-3', effective_from: '2026-12-01T00:00:00.000Z', capacity_override: 50 },
      ],
      parking_bookings: sameTime('2026-10-01', 4),
    })
    expect(signal(result, 'parking.at_capacity.2026-10-01')?.text).toBe('Parking is full on Thu 1 Oct: all 4 spaces are booked at the busiest time.')
    expect(result.metrics.find((metric) => metric.label === 'Car park spaces')?.value).toBe('4')
  })

  it('counts cars parked at the same moment, not bookings touching the day', async () => {
    // Ten one-hour bookings back to back: each ends as the next starts (half-open), so one space.
    const backToBack = Array.from({ length: 10 }, (_, hour) => booking({
      start: `2026-09-29T${String(8 + hour).padStart(2, '0')}:00:00.000Z`,
      end: `2026-09-29T${String(9 + hour).padStart(2, '0')}:00:00.000Z`,
    }))
    const { result } = await build({ parking_bookings: backToBack })
    expect(result.signals).toEqual([])
    expect(result.lists[0].items[0].text).toBe('Tue 29 Sep: 10 bookings, 1 of 10 spaces at the busiest time')
    expect(result.headline).toContain('10 bookings in the next 14 days, busiest Tue 29 Sep (1 of 10 spaces).')
  })

  it('counts a booking running from before the window on every day it covers', async () => {
    // A long stay started in May and running to 27 Sep, plus 9 cars on Sat 26 Sep.
    const longStay = booking({ created: '2026-05-01T10:00:00.000Z', start: '2026-05-02T10:00:00.000Z', end: '2026-09-27T10:00:00.000Z' })
    const { result } = await build({ parking_bookings: [longStay, ...sameTime('2026-09-26', 9)] })
    expect(signal(result, 'parking.at_capacity.2026-09-26')?.rag).toBe('red')
    expect(result.lists[0].items.map((item) => item.text)).toEqual([
      'Fri 25 Sep: 1 booking, 1 of 10 spaces at the busiest time',
      'Sat 26 Sep: 10 bookings, 10 of 10 spaces at the busiest time',
      'Sun 27 Sep: 1 booking, 1 of 10 spaces at the busiest time',
    ])
  })

  it('ignores stays that have already ended today: an empty car park raises nothing', async () => {
    // Ten cars parked Thu 24 Sep 20:00 to Fri 25 Sep 05:00 London; the report runs at 06:00.
    const overnight = Array.from({ length: 10 }, () => booking({ start: '2026-09-24T19:00:00.000Z', end: '2026-09-25T04:00:00.000Z' }))
    const { result } = await build({ parking_bookings: overnight })
    expect(result.signals).toEqual([])
    expect(result.lists).toEqual([])
    expect(result.metrics.find((metric) => metric.label === 'Booked in the next 14 days')?.value).toBe('0')
    // The stay touched today, so the section is not dormant, but nothing is coming up.
    expect(result.headline).toBe('0 bookings received this week against a 4-week average of 0. Nothing booked in the next 14 days.')

    // Ten cars that left at 10:00 London, with the page opened at 15:00: still nothing.
    const morning = sameTime('2026-09-25', 10).map((row) => ({ ...row, start_at: '2026-09-25T06:00:00.000Z', end_at: '2026-09-25T09:00:00.000Z' }))
    const later = await build({ parking_bookings: morning }, new Date('2026-09-25T14:00:00Z'))
    expect(later.result.signals).toEqual([])
    expect(later.result.lists).toEqual([])
  })

  it('still raises red for today when the cars are parked at the report time', async () => {
    // Ten cars parked Thu 24 Sep 20:00 to Fri 25 Sep 10:00 London; the report runs at 06:00.
    const overnight = Array.from({ length: 10 }, () => booking({ start: '2026-09-24T19:00:00.000Z', end: '2026-09-25T09:00:00.000Z' }))
    const { result } = await build({ parking_bookings: overnight })
    expect(result.signals.map((item) => [item.key, item.rag])).toEqual([['parking.at_capacity.2026-09-25', 'red']])
    expect(result.headline).toBe('Parking is full on Fri 25 Sep: all 10 spaces are booked at the busiest time.')
    expect(result.lists[0].items.map((item) => item.text)).toEqual(['Fri 25 Sep: 10 bookings, 10 of 10 spaces at the busiest time'])
  })

  it('judges the rest of today from the report time, counting only cars still to come or still parked', async () => {
    // Five cars left at 05:00 London; five are parked 08:00 to 12:00. Report at 06:00: peak 5, not 10.
    const gone = Array.from({ length: 5 }, () => booking({ start: '2026-09-24T19:00:00.000Z', end: '2026-09-25T04:00:00.000Z' }))
    const coming = Array.from({ length: 5 }, () => booking({ start: '2026-09-25T07:00:00.000Z', end: '2026-09-25T11:00:00.000Z' }))
    const { result } = await build({ parking_bookings: [...gone, ...coming] })
    expect(result.signals).toEqual([])
    expect(result.lists[0].items.map((item) => item.text)).toEqual(['Fri 25 Sep: 5 bookings, 5 of 10 spaces at the busiest time'])
    expect(result.metrics.find((metric) => metric.label === 'Booked in the next 14 days')?.value).toBe('5')
  })

  it('counts unpaid holds until their deadline, and never cancelled or expired bookings', async () => {
    const day = '2026-10-02'
    const rows = [
      ...sameTime(day, 7),
      // Unpaid, deadline tomorrow: holds a space.
      ...sameTime(day, 1, { status: 'pending_payment', due: '2026-09-26T10:00:00.000Z' }),
      // Unpaid, deadline passed before the report but not yet swept to expired: no space.
      ...sameTime(day, 1, { status: 'pending_payment', due: '2026-09-24T10:00:00.000Z' }),
      ...sameTime(day, 2, { status: 'cancelled' }),
      ...sameTime(day, 2, { status: 'expired' }),
    ]
    const { result } = await build({ parking_bookings: rows })
    const amber = signal(result, 'parking.near_capacity.2026-10-02')
    expect(amber?.text).toContain('8 of 10 spaces')
    expect(result.lists[0].items[0].text).toBe('Fri 2 Oct: 8 bookings, 8 of 10 spaces at the busiest time, 1 awaiting payment')
    expect(result.notes).toContain('The next 14 days include 1 unpaid booking, counted because each holds a space until its payment deadline.')
  })

  it('merges more than two full days into one list action with every day as a member', async () => {
    const rows = ['2026-09-26', '2026-10-03', '2026-09-30'].flatMap((date) => sameTime(date, 10))
    const { result } = await build({ parking_bookings: rows })
    const merged = signal(result, 'parking.at_capacity')
    expect(result.signals.filter((item) => item.rag === 'red')).toHaveLength(1)
    expect(merged).toMatchObject({
      rag: 'red',
      kind: 'issue',
      emailSafe: true,
      text: 'Parking is full or over capacity on 3 days in the next 14 days.',
      action: {
        text: 'Keep spaces free for booked cars on the 3 full days in the next 14 days',
        href: 'https://management.example.test/parking',
        target: 'list',
        dueDate: '2026-09-26',
        impact: 'customer',
        members: [
          'Keep all 10 spaces free for booked cars on Sat 26 Sep',
          'Keep all 10 spaces free for booked cars on Wed 30 Sep',
          'Keep all 10 spaces free for booked cars on Sat 3 Oct',
        ],
      },
    })
    expect(result.headline).toBe('Parking is full or over capacity on 3 days in the next 14 days, the first on Sat 26 Sep.')
  })

  it('keeps two full days as two separate actions', async () => {
    const rows = ['2026-09-26', '2026-09-27'].flatMap((date) => sameTime(date, 10))
    const { result } = await build({ parking_bookings: rows })
    expect(result.signals.map((item) => item.key)).toEqual(['parking.at_capacity.2026-09-26', 'parking.at_capacity.2026-09-27'])
    expect(result.headline).toBe('Parking is full or over capacity on 2 days in the next 14 days, the first on Sat 26 Sep.')
  })

  it('merges more than two nearly full days into one amber list action', async () => {
    const rows = ['2026-09-26', '2026-09-27', '2026-09-28'].flatMap((date) => sameTime(date, 9))
    const { result } = await build({ parking_bookings: rows })
    expect(result.signals).toHaveLength(1)
    expect(result.signals[0]).toMatchObject({
      key: 'parking.near_capacity',
      rag: 'amber',
      text: 'Parking is nearly full on 3 days in the next 14 days.',
      action: { target: 'list', dueDate: '2026-09-26' },
    })
    expect(result.signals[0].action?.members).toHaveLength(3)
  })

  it('ignores days outside the next 14', async () => {
    const { result } = await build({ parking_bookings: sameTime('2026-10-09', 10) })
    expect(result.signals).toEqual([])
    expect(result.lists).toEqual([])
    expect(result.headline).toContain('Nothing booked in the next 14 days; the next booking starts Fri 9 Oct.')
  })

  it('counts bookings received by London date whatever happened to them later', async () => {
    const rows = [
      // Received this week: confirmed, cancelled and expired all count.
      booking({ created: '2026-09-18T09:00:00.000Z', start: '2026-10-20T10:00:00.000Z', end: '2026-10-20T12:00:00.000Z' }),
      booking({ created: '2026-09-20T09:00:00.000Z', start: '2026-10-21T10:00:00.000Z', end: '2026-10-21T12:00:00.000Z', status: 'cancelled' }),
      booking({ created: '2026-09-22T09:00:00.000Z', start: '2026-10-22T10:00:00.000Z', end: '2026-10-22T12:00:00.000Z', status: 'expired' }),
      // 23:30Z on 17 Sep is 00:30 on Fri 18 Sep in London: this week.
      booking({ created: '2026-09-17T23:30:00.000Z', start: '2026-10-23T10:00:00.000Z', end: '2026-10-23T12:00:00.000Z' }),
      // 23:30Z on 24 Sep is 00:30 on Fri 25 Sep in London: today, not this week.
      booking({ created: '2026-09-24T23:30:00.000Z', start: '2026-10-24T10:00:00.000Z', end: '2026-10-24T12:00:00.000Z' }),
    ]
    const { result } = await build({ parking_bookings: rows })
    expect(result.metrics[0]).toMatchObject({ label: 'Bookings received this week', value: '4' })
  })

  it('counts stays by London start date for space holders and completed stays only', async () => {
    const rows = [
      booking({ created: '2026-09-01T09:00:00.000Z', start: '2026-09-19T10:00:00.000Z', end: '2026-09-19T12:00:00.000Z' }),
      booking({ created: '2026-09-01T09:00:00.000Z', start: '2026-09-20T10:00:00.000Z', end: '2026-09-20T12:00:00.000Z', status: 'completed' }),
      booking({ created: '2026-09-01T09:00:00.000Z', start: '2026-09-21T10:00:00.000Z', end: '2026-09-21T12:00:00.000Z', status: 'cancelled' }),
      booking({ created: '2026-09-01T09:00:00.000Z', start: '2026-09-22T10:00:00.000Z', end: '2026-09-22T12:00:00.000Z', status: 'expired' }),
      // Starts 00:30 London on Fri 18 Sep: this week.
      booking({ created: '2026-09-01T09:00:00.000Z', start: '2026-09-17T23:30:00.000Z', end: '2026-09-18T08:00:00.000Z' }),
    ]
    const { result } = await build({ parking_bookings: rows })
    expect(result.metrics[1]).toMatchObject({ label: 'Stays starting this week', value: '3' })
  })

  it('shows this week against the 4-week and 13-week averages', async () => {
    const rows = [
      // Previous 4 weeks: 4 received (1 a week); a further 9 earlier in the 13 weeks.
      ...['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14'].map((date) =>
        booking({ created: `${date}T10:00:00.000Z`, start: `${date}T12:00:00.000Z`, end: `${date}T14:00:00.000Z` })),
      ...Array.from({ length: 9 }, (_, index) => {
        const date = `2026-07-${String(1 + index * 2).padStart(2, '0')}`
        return booking({ created: `${date}T10:00:00.000Z`, start: `${date}T12:00:00.000Z`, end: `${date}T14:00:00.000Z` })
      }),
      // This week: 1.
      booking({ created: '2026-09-21T10:00:00.000Z', start: '2026-09-21T12:00:00.000Z', end: '2026-09-21T14:00:00.000Z' }),
    ]
    const { result } = await build({ parking_bookings: rows })
    expect(result.metrics[0]).toEqual({
      label: 'Bookings received this week',
      value: '1',
      comparison: 'In line with the 4-week average of 1 a week; 13-week average 1 a week',
    })
    expect(result.metrics[1]).toEqual({
      label: 'Stays starting this week',
      value: '1',
      comparison: 'In line with the 4-week average of 1 a week; 13-week average 1 a week',
    })
    expect(result.headline).toBe('1 booking received this week against a 4-week average of 1. Nothing booked in the next 14 days.')
    expect(result.signals).toEqual([])
    expect(result.notes).toEqual([])
    expectCleanText(result)
  })

  it('raises a green win when bookings are growing over 13 weeks', async () => {
    // 20 in the previous 4 weeks (5 a week), none earlier: 4-week 5 against 13-week 1.5.
    const rows = Array.from({ length: 20 }, (_, index) => {
      const date = `2026-${index < 11 ? '08' : '09'}-${String(index < 11 ? 21 + index : index - 10).padStart(2, '0')}`
      return booking({ created: `${date}T10:00:00.000Z`, start: `${date}T12:00:00.000Z`, end: `${date}T13:00:00.000Z` })
    })
    const { result } = await build({ parking_bookings: rows })
    expect(signal(result, 'parking.growth')).toEqual({
      key: 'parking.growth',
      rag: 'green',
      kind: 'win',
      emailSafe: true,
      text: 'Parking bookings are growing: 5 a week over the last 4 weeks against 1.5 a week over 13 weeks.',
    })
    expectCleanText(result)
  })

  it('raises a green win when this week picks up from nothing, above the floor only', async () => {
    const week = (count: number): Row[] => Array.from({ length: count }, (_, index) => booking({
      created: `2026-09-${String(18 + index).padStart(2, '0')}T10:00:00.000Z`,
      start: `2026-11-${String(2 + index).padStart(2, '0')}T12:00:00.000Z`,
      end: `2026-11-${String(2 + index).padStart(2, '0')}T13:00:00.000Z`,
    }))
    const picked = await build({ parking_bookings: week(3) })
    expect(signal(picked.result, 'parking.growth')?.text).toBe('Parking bookings have picked up: 3 bookings received this week after none in the previous 4 weeks.')
    expect(picked.result.metrics[0].comparison).toBe('New activity (none in the previous 4 weeks); 13-week average 0 a week')

    const tooFew = await build({ parking_bookings: week(2) })
    expect(signal(tooFew.result, 'parking.growth')).toBeUndefined()
  })

  it('raises a green win when this week is notably up on the 4-week average', async () => {
    const rows = [
      booking({ created: '2026-09-01T10:00:00.000Z', start: '2026-09-01T12:00:00.000Z', end: '2026-09-01T13:00:00.000Z' }),
      ...Array.from({ length: 5 }, (_, index) => booking({
        created: `2026-09-${String(18 + index).padStart(2, '0')}T10:00:00.000Z`,
        start: `2026-11-${String(2 + index).padStart(2, '0')}T12:00:00.000Z`,
        end: `2026-11-${String(2 + index).padStart(2, '0')}T13:00:00.000Z`,
      })),
    ]
    const { result } = await build({ parking_bookings: rows })
    // One booking in the previous 4 weeks is 0.25 a week; this week is 5.
    expect(signal(result, 'parking.growth')?.text).toBe('Parking bookings are up: 5 bookings received this week against a 4-week average of 0.3.')
  })

  it('says "not enough history yet" and raises no win before 4 weeks of collection', async () => {
    // Fri 14 Nov 2025: the 4-week baseline starts 10 Oct, before the first booking on 12 Oct.
    const rows = Array.from({ length: 5 }, (_, index) => booking({
      created: `2025-11-${String(7 + index).padStart(2, '0')}T10:00:00.000Z`,
      start: `2025-12-${String(1 + index).padStart(2, '0')}T12:00:00.000Z`,
      end: `2025-12-${String(1 + index).padStart(2, '0')}T13:00:00.000Z`,
    }))
    const { result } = await build({ parking_bookings: rows }, new Date('2025-11-14T06:00:00Z'))
    expect(result.signals).toEqual([])
    expect(result.metrics[0]).toEqual({
      label: 'Bookings received this week',
      value: '5',
      comparison: 'Not enough history yet for the 4-week average',
    })
    expect(result.notes).toContain('Not enough parking history yet to compare with the 4-week average.')
    expect(result.headline).toBe('5 bookings received this week. Nothing booked in the next 14 days; the next booking starts Mon 1 Dec.')
    expectCleanText(result)
  })

  it('compares with 4 weeks but not 13 when only 4 weeks of history exist', async () => {
    // Fri 19 Dec 2025: 4-week baseline from 14 Nov (covered), 13-week from 12 Sep (not).
    const rows = Array.from({ length: 6 }, (_, index) => booking({
      created: `2025-12-${String(12 + index).padStart(2, '0')}T10:00:00.000Z`,
      start: `2026-01-${String(5 + index).padStart(2, '0')}T12:00:00.000Z`,
      end: `2026-01-${String(5 + index).padStart(2, '0')}T13:00:00.000Z`,
    }))
    const { result } = await build({ parking_bookings: rows }, new Date('2025-12-19T06:00:00Z'))
    expect(result.notes).toContain('Not enough parking history yet for the 13-week average or trend.')
    expect(result.metrics[0].comparison).toBe('New activity (none in the previous 4 weeks)')
    // The weekly pick-up still counts as growth; the 13-week trend is not judged.
    expect(signal(result, 'parking.growth')?.text).toContain('have picked up')
  })

  it('buckets days by London date across the October clock change', async () => {
    // Fri 23 Oct 2026 06:00 BST. Sun 25 Oct runs 24 Oct 23:00Z to 26 Oct 00:00Z (25 hours).
    // Ten cars 23:15Z to 23:45Z on 25 Oct are late on Sunday in London (GMT), not Monday.
    const rows = Array.from({ length: 10 }, () => booking({
      start: '2026-10-25T23:15:00.000Z',
      end: '2026-10-25T23:45:00.000Z',
    }))
    const { result } = await build({ parking_bookings: rows }, new Date('2026-10-23T05:00:00Z'))
    expect(result.signals.map((item) => item.key)).toEqual(['parking.at_capacity.2026-10-25'])
    expect(result.lists[0].items.map((item) => item.text)).toEqual(['Sun 25 Oct: 10 bookings, 10 of 10 spaces at the busiest time'])
  })

  it('buckets days by London date across the March clock change', async () => {
    // Fri 26 Mar 2027 06:00 GMT. Sun 28 Mar runs 00:00Z to 23:00Z (23 hours).
    // Ten cars 23:15Z to 23:45Z on 28 Mar are early on Monday 29 Mar in London (BST).
    const rows = Array.from({ length: 10 }, () => booking({
      start: '2027-03-28T23:15:00.000Z',
      end: '2027-03-28T23:45:00.000Z',
    }))
    const { result } = await build({ parking_bookings: rows }, new Date('2027-03-26T06:00:00Z'))
    expect(result.signals.map((item) => item.key)).toEqual(['parking.at_capacity.2027-03-29'])
  })

  it('keeps every sentence email safe and free of booking, customer and vehicle details', async () => {
    const rows = [
      ...sameTime('2026-09-26', 11),
      ...sameTime('2026-09-28', 8, { status: 'pending_payment', due: '2026-09-27T10:00:00.000Z' }),
      booking({ created: '2026-09-19T10:00:00.000Z', start: '2026-09-19T12:00:00.000Z', end: '2026-09-19T13:00:00.000Z' }),
    ]
    const { result } = await build({ parking_bookings: rows })
    expect(result.signals.length).toBeGreaterThan(0)
    for (const item of result.signals) {
      expect(item.emailSafe).toBe(true)
      if (item.action) expect(item.action.href).toBe('https://management.example.test/parking')
    }
    expect(result.metrics.length).toBeLessThanOrEqual(4)
    expectCleanText(result)
  })
})
