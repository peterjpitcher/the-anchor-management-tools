import { describe, expect, it } from 'vitest'
import { buildTableBookingsSection, tableBookingsSection } from '@/lib/insights/sections/table-bookings'
import { dateRange, datesIn } from '@/lib/insights/windows'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { makeContext, TEST_APP_URL } from '../helpers/context'

// Default report instant: Friday 25 Sep 2026, 06:00 London (05:00 UTC).
//   this week          18 Sep to 24 Sep
//   last week          11 Sep to 17 Sep
//   previous 4 weeks   21 Aug to 17 Sep
//   previous 13 weeks  19 Jun to 17 Sep
//   next 7 days        Fri 25 Sep to Thu 1 Oct
// Comparison points for "usual" and last week: the same 06:00 London on 18, 11, 4 Sep and 28 Aug.
const BOH = `${TEST_APP_URL}/table-bookings/boh`
const LONG_DASH = String.fromCharCode(0x2014)
const PERSONAL = ['Zebedee', 'Quartermaine', 'TB-SECRET', 'tb-0', 'zebedee@example.test']

type Row = Record<string, unknown>

let sequence = 0
function booking(overrides: Row = {}): Row {
  sequence += 1
  return {
    id: `tb-${String(sequence).padStart(6, '0')}`,
    created_at: '2026-08-01T10:00:00.000Z',
    booking_date: '2026-08-02',
    booking_time: '19:00:00',
    party_size: 2,
    committed_party_size: 2,
    status: 'confirmed',
    booking_type: 'regular',
    booking_purpose: 'food',
    source: 'brand_site',
    event_id: null,
    hold_expires_at: null,
    payment_status: null,
    cancelled_at: null,
    // Personal fields the section must never read or print.
    booking_reference: `TB-SECRET-${sequence}`,
    customer: { first_name: 'Zebedee', last_name: 'Quartermaine', email: 'zebedee@example.test' },
    special_requirements: 'Zebedee is allergic to nuts',
    ...overrides,
  }
}

/** One booking a day, made on the day itself, so it is never "on the books" ahead of time. */
function daily(start: string, end: string, partySize: number, overrides: Row = {}): Row[] {
  return datesIn(dateRange(start, end)).map((date) =>
    booking({ booking_date: date, created_at: `${date}T10:00:00.000Z`, status: 'completed', party_size: partySize, ...overrides }))
}

function service(starts: string, ends: string, type = 'regular'): Row {
  return { name: 'food service', starts_at: starts, ends_at: ends, capacity: 50, booking_type: type }
}

function hoursFor(versionId: string, day: (weekday: number) => Row): Row[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: `${versionId}-${weekday}`,
    version_id: versionId,
    day_of_week: weekday,
    opens: '12:00:00',
    closes: '23:00:00',
    is_closed: false,
    is_kitchen_closed: false,
    kitchen_opens: null,
    kitchen_closes: null,
    schedule_config: [],
    ...day(weekday),
  }))
}

// The live weekly hours on 18 Sep 2026: a baseline version and the September version.
function baselineDay(weekday: number): Row {
  if (weekday === 0) return { kitchen_opens: '13:00:00', kitchen_closes: '18:00:00', schedule_config: [service('13:00', '18:00', 'sunday_lunch')] }
  if (weekday === 1) return { is_kitchen_closed: true }
  if (weekday === 6) return { kitchen_opens: '12:00:00', kitchen_closes: '19:00:00', schedule_config: [service('12:00', '19:00')] }
  return { kitchen_opens: '16:00:00', kitchen_closes: '21:00:00', schedule_config: [service('16:00', '21:00')] }
}
function septemberDay(weekday: number): Row {
  if (weekday >= 2 && weekday <= 5) {
    return { kitchen_opens: '12:00:00', kitchen_closes: '21:00:00', schedule_config: [service('12:00', '15:00'), service('16:00', '21:00')] }
  }
  return baselineDay(weekday)
}

const VERSIONS: Row[] = [
  { id: 'v-baseline', effective_from: '2000-01-01', status: 'published' },
  { id: 'v-sep', effective_from: '2026-09-01', status: 'published' },
  { id: 'v-draft', effective_from: '2026-09-20', status: 'draft' },
]
const HOURS: Row[] = [
  ...hoursFor('v-baseline', baselineDay),
  ...hoursFor('v-sep', septemberDay),
  ...hoursFor('v-draft', () => ({ is_closed: true })),
]
const SETTINGS: Row[] = [
  { key: 'kitchen_pacing_enabled', value: { value: true } },
  { key: 'kitchen_pacing_window_minutes', value: { value: 30 } },
  { key: 'kitchen_pace_covers_regular', value: { value: 15 } },
  { key: 'kitchen_pace_covers_sunday', value: { value: 15 } },
  { key: 'kitchen_walk_in_reserve_regular', value: { value: 5 } },
  { key: 'kitchen_walk_in_reserve_sunday', value: { value: 5 } },
  { key: 'pacing_window_minutes', value: { value: 60 } },
]

interface Fixture {
  special?: Row[]
  settings?: Row[]
  versions?: Row[]
  hours?: Row[]
}

function makeDb(bookings: Row[], fixture: Fixture = {}): FakeDb {
  return new FakeDb({
    table_bookings: bookings,
    special_hours: fixture.special ?? [],
    system_settings: fixture.settings ?? SETTINGS,
    business_hours_versions: fixture.versions ?? VERSIONS,
    business_hours: fixture.hours ?? HOURS,
  })
}

async function build(bookings: Row[], fixture: Fixture = {}, now?: Date): Promise<SectionBuildResult> {
  return buildTableBookingsSection(makeContext(makeDb(bookings, fixture), now))
}

function metric(result: SectionBuildResult, label: string): { value: string; comparison?: string } {
  const found = result.metrics.find((m) => m.label === label)
  if (!found) throw new Error(`No metric ${label}`)
  return found
}

function list(result: SectionBuildResult, title: string): { text: string; href?: string; rag?: string }[] {
  const found = result.lists.find((l) => l.title === title)
  if (!found) throw new Error(`No list ${title}`)
  return found.items
}

function dayItem(result: SectionBuildResult, label: string): { text: string; href?: string; rag?: string } {
  const found = list(result, 'Next 7 days').find((item) => item.text.startsWith(`${label}:`))
  if (!found) throw new Error(`No day ${label}`)
  return found
}

function signal(result: SectionBuildResult, key: string): InsightSignal | undefined {
  return result.signals.find((s) => s.key === key)
}

function expectCleanText(result: SectionBuildResult): void {
  const text = JSON.stringify(result)
  for (const bad of ['undefined', 'NaN', 'Invalid Date', LONG_DASH, '!']) expect(text).not.toContain(bad)
  for (const personal of PERSONAL) expect(text).not.toContain(personal)
  for (const item of result.signals) expect(item.emailSafe).toBe(true)
}

/** Four earlier same-weekday dates, each with a booking made well ahead (so it was on the books). */
function usualOf(date: string, partySize: number): Row[] {
  const base = Date.parse(`${date}T12:00:00Z`)
  return [1, 2, 3, 4].map((weeks) => {
    const earlier = new Date(base - weeks * 7 * 86_400_000).toISOString().slice(0, 10)
    return booking({ booking_date: earlier, created_at: '2026-08-01T10:00:00.000Z', party_size: partySize, status: 'completed' })
  })
}

describe('tableBookingsSection', () => {
  it('is the table bookings section and links to the bookings view', () => {
    expect(tableBookingsSection.key).toBe('table_bookings')
    expect(tableBookingsSection.path).toBe('/table-bookings/boh')
    expect(tableBookingsSection.build).toBe(buildTableBookingsSection)
  })
})

describe('buildTableBookingsSection', () => {
  it('says so plainly when there is nothing at all', async () => {
    const result = await build([])
    expect(result.headline).toBe('No table bookings or walk-ins in the last 13 weeks, and none on the books for the next 7 days.')
    expect(result.signals).toEqual([])
    expect(result.metrics).toEqual([])
    expectCleanText(result)
  })

  it('fails loudly when the bookings cannot be read, so the section is not checked', async () => {
    await expect(buildTableBookingsSection(makeContext(makeDb([]).fail('table_bookings')))).rejects.toThrow()
    await expect(buildTableBookingsSection(makeContext(makeDb([]).fail('special_hours')))).rejects.toThrow()
    await expect(buildTableBookingsSection(makeContext(makeDb([]).fail('system_settings')))).rejects.toThrow()
  })

  it('counts received bookings whatever happened later, and actual covers with walk-ins but without cancellations', async () => {
    const thisWeek = '2026-09-20'
    const created = `${thisWeek}T10:00:00.000Z`
    const result = await build([
      booking({ booking_date: thisWeek, created_at: created, party_size: 4, status: 'completed' }),
      booking({ booking_date: thisWeek, created_at: created, party_size: 6, status: 'cancelled', cancelled_at: '2026-09-20T11:00:00.000Z' }),
      booking({ booking_date: thisWeek, created_at: created, party_size: 3, status: 'no_show' }),
      booking({ booking_date: thisWeek, created_at: created, party_size: 7, status: 'pending_payment', payment_status: 'pending', hold_expires_at: '2026-09-20T12:00:00.000Z' }),
      // Walk-in: an actual cover, never a booking received.
      booking({ booking_date: thisWeek, created_at: created, party_size: 5, source: 'walk-in' }),
      // Event table booking: counted under Hosted events, never here.
      booking({ booking_date: thisWeek, created_at: created, party_size: 10, event_id: 'evt-1' }),
      // Christmas: on its own line, out of the comparisons.
      booking({ booking_date: thisWeek, created_at: created, party_size: 8, booking_type: 'christmas' }),
    ])
    expect(metric(result, 'Bookings received this week').value).toBe('4 (20 covers)')
    expect(metric(result, 'Actual covers this week').value).toBe('9')
    expect(list(result, 'This week against earlier weeks')[2].text).toContain('Actual covers, walk-ins included: 9 this week')
    expectCleanText(result)
  })

  it('raises a win when actual covers are well above the 4-week average', async () => {
    const result = await build([
      ...daily('2026-06-19', '2026-09-24', 2),
      booking({ booking_date: '2026-09-22', created_at: '2026-09-22T18:00:00.000Z', party_size: 20, source: 'walk-in' }),
    ])
    const win = signal(result, 'table_bookings.covers_up')
    expect(win).toMatchObject({ rag: 'green', kind: 'win', emailSafe: true })
    expect(win?.text).toBe('Actual covers are up this week: 34 actual covers this week, up 143% on the 4-week average.')
    expect(win?.action).toBeUndefined()
    expect(signal(result, 'table_bookings.covers_down')).toBeUndefined()
    expect(metric(result, 'Actual covers this week')).toEqual({
      label: 'Actual covers this week',
      value: '34',
      comparison: 'up 143% on last week; up 143% on the 4-week average; up 143% on the 13-week average',
    })
    expect(result.headline).toContain('This week: 34 actual covers, up 143% on the 4-week average.')
    expectCleanText(result)
  })

  it('raises a win when the trend is growing', async () => {
    const result = await build([
      ...daily('2026-06-19', '2026-08-20', 1),
      ...daily('2026-08-21', '2026-09-24', 5),
    ])
    const win = signal(result, 'table_bookings.covers_up')
    expect(win?.text).toBe('Covers are growing: the last 4 weeks averaged 35 a week against 15.6 over 13 weeks.')
    expect(list(result, 'This week against earlier weeks')[3].text).toBe('Actual covers are growing: the last 4 weeks are ahead of the 13-week average.')
    expect(signal(result, 'table_bookings.covers_down')).toBeUndefined()
  })

  it('raises amber when actual covers are well below the 4-week average', async () => {
    const result = await build([
      ...daily('2026-06-19', '2026-09-17', 5),
      ...daily('2026-09-18', '2026-09-24', 1),
    ])
    const down = signal(result, 'table_bookings.covers_down')
    expect(down).toMatchObject({ rag: 'amber', kind: 'issue', emailSafe: true })
    expect(down?.text).toBe('Actual covers are down this week: 7 actual covers this week, down 80% on the 4-week average.')
    expect(down?.action).toBeUndefined()
    expect(signal(result, 'table_bookings.covers_up')).toBeUndefined()
  })

  it('raises amber, never red, when the trend is declining', async () => {
    const result = await build([
      ...daily('2026-06-19', '2026-08-20', 5),
      ...daily('2026-08-21', '2026-09-24', 1),
    ])
    const down = signal(result, 'table_bookings.covers_down')
    expect(down?.text).toBe('Covers are declining: the last 4 weeks averaged 7 a week against 26.4 over 13 weeks.')
    expect(result.signals.every((s) => s.rag !== 'red')).toBe(true)
  })

  it('stays quiet when the change is small or below the floor', async () => {
    const result = await build([
      ...daily('2026-06-19', '2026-09-17', 2),
      // 14 a week before, 20 this week: 43% up but only 6 covers, under the floor of 15.
      ...daily('2026-09-18', '2026-09-24', 2),
      booking({ booking_date: '2026-09-21', created_at: '2026-09-21T10:00:00.000Z', party_size: 6, status: 'completed' }),
    ])
    expect(result.signals).toEqual([])
    expect(metric(result, 'Actual covers this week').comparison).toContain('in line with the 4-week average')
  })

  it('flags two or more quiet days in the next 7 with a promotion action', async () => {
    const result = await build([
      ...usualOf('2026-09-29', 12),
      ...usualOf('2026-09-30', 12),
      booking({ booking_date: '2026-09-29', created_at: '2026-09-20T10:00:00.000Z', party_size: 2 }),
      booking({ booking_date: '2026-09-30', created_at: '2026-09-20T10:00:00.000Z', party_size: 3 }),
    ])
    const weak = signal(result, 'table_bookings.weak_days')
    expect(weak).toMatchObject({ rag: 'amber', kind: 'issue', emailSafe: true })
    expect(weak?.text).toBe('2 days in the next 7 days are at half or less of the usual covers at this point: Tue 29 Sep (2 against 12) and Wed 30 Sep (3 against 12).')
    expect(weak?.action).toEqual({
      text: "Concentrate this week's promotion on Tue 29 Sep and Wed 30 Sep",
      href: BOH,
      target: 'list',
      dueDate: '2026-09-29',
      impact: 'money',
    })
    expect(dayItem(result, 'Tue 29 Sep')).toMatchObject({ rag: 'amber' })
    expect(dayItem(result, 'Tue 29 Sep').text).toContain('usually 12 covers by now')
    expect(result.headline).toContain('Quiet days ahead: Tue 29 Sep and Wed 30 Sep.')
    expectCleanText(result)
  })

  it('does not flag a single quiet day, a gap under the day floor, or a special closure', async () => {
    const single = await build([
      ...usualOf('2026-09-29', 12),
      booking({ booking_date: '2026-09-29', created_at: '2026-09-20T10:00:00.000Z', party_size: 2 }),
    ])
    expect(signal(single, 'table_bookings.weak_days')).toBeUndefined()
    expect(dayItem(single, 'Tue 29 Sep').rag).toBe('amber')

    const underFloor = await build([
      ...usualOf('2026-09-29', 4),
      ...usualOf('2026-09-30', 4),
      booking({ booking_date: '2026-09-29', created_at: '2026-09-20T10:00:00.000Z', party_size: 1 }),
    ])
    expect(signal(underFloor, 'table_bookings.weak_days')).toBeUndefined()

    const closed = await build([
      ...usualOf('2026-09-29', 12),
      ...usualOf('2026-09-30', 12),
      booking({ booking_date: '2026-09-30', created_at: '2026-09-20T10:00:00.000Z', party_size: 3 }),
    ], { special: [{ date: '2026-09-29', is_closed: true, opens: null, closes: null, kitchen_opens: null, kitchen_closes: null, is_kitchen_closed: false, schedule_config: [], kitchen_pace_covers: null, kitchen_walk_in_reserve: null }] })
    expect(signal(closed, 'table_bookings.weak_days')).toBeUndefined()
    expect(dayItem(closed, 'Tue 29 Sep').text).toBe('Tue 29 Sep: closed')
  })

  it('leaves earlier closed days out of the usual figure', async () => {
    const result = await build([
      ...usualOf('2026-09-29', 12),
      booking({ booking_date: '2026-09-22', created_at: '2026-08-01T10:00:00.000Z', party_size: 20 }),
    ], { special: [{ date: '2026-09-22', is_closed: true, opens: null, closes: null, kitchen_opens: null, kitchen_closes: null, is_kitchen_closed: false, schedule_config: [], kitchen_pace_covers: null, kitchen_walk_in_reserve: null }] })
    // 22 Sep is skipped entirely, so the usual is the other three weeks at 12.
    expect(dayItem(result, 'Tue 29 Sep').text).toContain('usually 12 covers by now')
    expect(result.notes).toContain('Usual covers by day leave out earlier days the pub was closed.')
  })

  it('notes a day well ahead of usual in green, without an action', async () => {
    const result = await build([
      ...usualOf('2026-09-26', 10),
      booking({ booking_date: '2026-09-26', created_at: '2026-09-20T10:00:00.000Z', party_size: 8 }),
      booking({ booking_date: '2026-09-26', created_at: '2026-09-21T10:00:00.000Z', party_size: 8 }),
    ])
    const strong = signal(result, 'table_bookings.strong_day.2026-09-26')
    expect(strong).toEqual({
      key: 'table_bookings.strong_day.2026-09-26',
      rag: 'green',
      kind: 'info',
      text: 'Sat 26 Sep is well ahead of usual: 16 covers booked against a usual 10 at this point.',
      emailSafe: true,
    })
    expect(dayItem(result, 'Sat 26 Sep').rag).toBe('green')
  })

  it('rebuilds what was on the books at the same point from created, cancelled and hold times', async () => {
    const result = await build([
      booking({ booking_date: '2026-09-26', created_at: '2026-09-20T10:00:00.000Z', party_size: 4 }),
      // Last week's window (18 to 24 Sep) as it stood at 06:00 on Fri 18 Sep.
      booking({ booking_date: '2026-09-19', created_at: '2026-09-10T10:00:00.000Z', party_size: 3, status: 'completed' }),
      booking({ booking_date: '2026-09-19', created_at: '2026-09-18T06:00:00.000Z', party_size: 5, status: 'completed' }),
      booking({ booking_date: '2026-09-20', created_at: '2026-09-10T10:00:00.000Z', party_size: 7, status: 'cancelled', cancelled_at: '2026-09-15T12:00:00.000Z' }),
      booking({ booking_date: '2026-09-20', created_at: '2026-09-10T10:00:00.000Z', party_size: 2, status: 'cancelled', cancelled_at: '2026-09-20T12:00:00.000Z' }),
      booking({ booking_date: '2026-09-21', created_at: '2026-09-10T10:00:00.000Z', party_size: 6, status: 'cancelled', payment_status: 'pending', hold_expires_at: '2026-09-17T12:00:00.000Z', cancelled_at: '2026-09-19T00:00:00.000Z' }),
      booking({ booking_date: '2026-09-21', created_at: '2026-09-10T10:00:00.000Z', party_size: 1, status: 'completed', payment_status: 'completed', hold_expires_at: '2026-09-17T12:00:00.000Z' }),
      // 13 weeks ago (26 Jun to 2 Jul) as it stood on 26 Jun.
      booking({ booking_date: '2026-06-27', created_at: '2026-06-01T10:00:00.000Z', party_size: 20, status: 'completed' }),
    ])
    const totals = list(result, 'Next 7 days').at(-1)
    expect(totals?.text).toBe(
      'Next 7 days in total: 1 booking, 4 covers. '
      + 'At this point last week: 3 bookings, 6 covers (in line with this point last week). '
      + '4 weeks ago: 0 bookings, 0 covers (new activity (none in this point 4 weeks ago)). '
      + '13 weeks ago: 1 booking, 20 covers (down 80% on this point 13 weeks ago).',
    )
    expect(metric(result, 'Covers booked, next 7 days')).toEqual({
      label: 'Covers booked, next 7 days',
      value: '4 (1 booking)',
      comparison: 'in line with this point last week; new activity (none in this point 4 weeks ago); down 80% on this point 13 weeks ago',
    })
    // Received counts what was made this week (18 to 24 Sep), whatever happened later.
    expect(metric(result, 'Bookings received this week').value).toBe('2 (9 covers)')
  })

  it('compares at the same London clock time across the October clock change', async () => {
    // Fri 30 Oct 2026 06:00 GMT. A week earlier, 06:00 London was 05:00 UTC (BST).
    const now = new Date('2026-10-30T06:00:00Z')
    const result = await build([
      booking({ booking_date: '2026-10-24', created_at: '2026-10-23T04:30:00.000Z', party_size: 2, status: 'completed' }),
      // 06:30 London on 23 Oct: after the comparison point, although it is before 06:00 UTC.
      booking({ booking_date: '2026-10-24', created_at: '2026-10-23T05:30:00.000Z', party_size: 9, status: 'completed' }),
    ], {}, now)
    expect(list(result, 'Next 7 days').at(-1)?.text).toContain('At this point last week: 1 booking, 2 covers')
    expect(list(result, 'Next 7 days')[0].text.startsWith('Fri 30 Oct:')).toBe(true)
  })

  it('shows kitchen capacity from the hours and pacing in force for each date', async () => {
    const created = '2026-09-20T10:00:00.000Z'
    const result = await build([
      booking({ booking_date: '2026-09-25', created_at: created, party_size: 6 }),
      booking({ booking_date: '2026-09-25', created_at: created, party_size: 4, booking_purpose: 'drinks' }),
      booking({ booking_date: '2026-09-25', created_at: created, party_size: 4, booking_type: 'christmas' }),
      booking({ booking_date: '2026-09-26', created_at: created, party_size: 16 }),
    ], {
      special: [
        {
          date: '2026-09-29', opens: '12:00:00', closes: '23:00:00', is_closed: false, is_kitchen_closed: false,
          kitchen_opens: '12:00:00', kitchen_closes: '21:00:00', schedule_config: [service('12:00', '15:00'), service('16:00', '21:00')],
          kitchen_pace_covers: 25, kitchen_walk_in_reserve: null,
        },
        {
          date: '2026-09-30', opens: null, closes: null, is_closed: true, is_kitchen_closed: false,
          kitchen_opens: null, kitchen_closes: null, schedule_config: [], kitchen_pace_covers: null, kitchen_walk_in_reserve: null,
        },
      ],
    })
    // Friday: split services 12:00 to 15:00 and 16:00 to 21:00, 16 arrival windows of 10.
    // Christmas food covers use the same kitchen, so they count towards it.
    expect(dayItem(result, 'Fri 25 Sep').text).toBe(
      'Fri 25 Sep: 2 bookings, 10 covers (6 food, 4 drinks); Christmas 1 booking, 4 covers; usually 0 covers by now; kitchen 10 of 160 bookable food covers (6%)',
    )
    // Each day opens the bookings board on that day (spec 5.5 point 4); the totals line has no link.
    expect(dayItem(result, 'Fri 25 Sep').href).toBe('https://management.example.test/table-bookings/boh?date=2026-09-25&view=day')
    expect(list(result, 'Next 7 days').filter((item) => item.href).length).toBe(7)
    // Saturday 12:00 to 19:00: 14 windows. Sunday lunch 13:00 to 18:00: 10 windows.
    expect(dayItem(result, 'Sat 26 Sep').text).toContain('1 party of 15 or more (16 covers)')
    expect(dayItem(result, 'Sat 26 Sep').text).toContain('kitchen 16 of 140 bookable food covers (11%)')
    expect(dayItem(result, 'Sun 27 Sep').text).toContain('kitchen 0 of 100 bookable food covers (0%)')
    expect(dayItem(result, 'Mon 28 Sep').text).toContain('kitchen closed')
    // Special hours raise the pace to 25, less the walk-in reserve of 5: 20 a window.
    expect(dayItem(result, 'Tue 29 Sep').text).toContain('kitchen 0 of 320 bookable food covers (0%)')
    expect(dayItem(result, 'Wed 30 Sep').text).toBe('Wed 30 Sep: closed')
    expect(metric(result, 'Parties of 15 or more, next 7 days').value).toBe('1 (16 covers)')
    expectCleanText(result)
  })

  it('explains when kitchen capacity cannot be shown', async () => {
    const rows = [booking({ booking_date: '2026-09-25', created_at: '2026-09-20T10:00:00.000Z', party_size: 6 })]
    const off = await build(rows, { settings: [{ key: 'kitchen_pacing_enabled', value: { value: false } }] })
    expect(off.notes).toContain('Kitchen pacing is switched off, so kitchen capacity is not shown.')
    expect(dayItem(off, 'Fri 25 Sep').text).not.toContain('kitchen')

    const incomplete = await build(rows, { settings: [{ key: 'kitchen_pacing_enabled', value: { value: true } }] })
    expect(incomplete.notes).toContain('Kitchen pacing settings are incomplete, so kitchen capacity is not shown.')

    const noHours = await build(rows, { versions: [], hours: [] })
    expect(dayItem(noHours, 'Fri 25 Sep').text).toContain('kitchen hours not set')
    expect(noHours.notes).toContain(
      'Opening hours are not set for Fri 25 Sep, Sat 26 Sep, Sun 27 Sep, Mon 28 Sep, Tue 29 Sep, Wed 30 Sep and Thu 1 Oct, so kitchen capacity there is unknown.',
    )
  })

  it('keeps Christmas bookings on their own line and out of the comparisons', async () => {
    const result = await build([
      ...daily('2026-06-19', '2026-09-24', 2),
      booking({ booking_date: '2026-12-18', created_at: '2026-09-20T10:00:00.000Z', party_size: 10, booking_type: 'christmas' }),
      booking({ booking_date: '2026-12-19', created_at: '2026-09-01T10:00:00.000Z', party_size: 8, booking_type: 'christmas' }),
      booking({ booking_date: '2026-12-11', created_at: '2026-09-02T10:00:00.000Z', party_size: 6, booking_type: 'christmas', status: 'cancelled', cancelled_at: '2026-09-03T10:00:00.000Z' }),
    ])
    expect(result.metrics[3]).toEqual({
      label: 'Christmas bookings',
      value: '2 bookings, 18 covers on the books',
      comparison: '1 booking (10 covers) received this week; not included in the comparisons',
    })
    // Received this week is the seven ordinary bookings only.
    expect(metric(result, 'Bookings received this week').value).toBe('7 (14 covers)')
    expect(list(result, 'Christmas').map((item) => item.text)).toEqual([
      'Received this week: 1 booking, 10 covers.',
      'On the books: 2 bookings, 18 covers, the first on Fri 18 Dec.',
    ])
    expect(result.notes).toContain('Christmas bookings are shown on their own and left out of every comparison.')
    expect(result.signals).toEqual([])
  })

  it('shows not enough history instead of comparing against missing data', async () => {
    // Fri 29 Aug 2025: bookings began on 4 Aug 2025 and walk-ins on 11 Feb 2026, so last
    // week can be compared but the 4- and 13-week averages and the usual figures cannot.
    // Received: 14 this week against 8 last week (7 made on the day plus the party of 30).
    const now = new Date('2025-08-29T05:00:00Z')
    const result = await build([
      ...daily('2025-08-04', '2025-08-21', 1),
      ...daily('2025-08-22', '2025-08-28', 10),
      ...daily('2025-08-22', '2025-08-28', 10),
      booking({ booking_date: '2025-08-30', created_at: '2025-08-20T10:00:00.000Z', party_size: 30 }),
    ], {}, now)
    expect(result.signals).toEqual([])
    expect(metric(result, 'Actual covers this week').comparison).toBe(
      'not enough history yet for last week; not enough history yet for the 4-week average; not enough history yet for the 13-week average',
    )
    expect(metric(result, 'Bookings received this week').comparison).toBe(
      'up 75% on last week; not enough history yet for the 4-week average; not enough history yet for the 13-week average',
    )
    expect(dayItem(result, 'Sat 30 Aug').text).toContain('no usual figure yet')
    expect(result.notes).toContain('Not enough booking history yet for the 4-week comparisons or the usual covers by day.')
    expect(list(result, 'This week against earlier weeks')[3].text).toBe('Not enough history yet to judge the trend in actual covers.')
    // The baseline weekly hours resolve 2025 dates: Saturday kitchen 12:00 to 19:00.
    expect(dayItem(result, 'Sat 30 Aug').text).toContain('kitchen 30 of 140 bookable food covers (21%)')
    expectCleanText(result)
  })

  it('never prints a guest name, reference or per-booking link, however large the party', async () => {
    const result = await build([
      ...daily('2026-06-19', '2026-09-24', 2),
      booking({ booking_date: '2026-09-26', created_at: '2026-09-10T10:00:00.000Z', party_size: 40 }),
      booking({ booking_date: '2026-09-27', created_at: '2026-09-10T10:00:00.000Z', party_size: 18, booking_type: 'sunday_lunch' }),
      ...usualOf('2026-09-29', 12),
      ...usualOf('2026-09-30', 12),
    ])
    expectCleanText(result)
    const hrefs = [
      ...result.lists.flatMap((l) => l.items.map((item) => item.href)).filter(Boolean),
      ...result.signals.map((s) => s.action?.href).filter(Boolean),
    ]
    expect(hrefs.length).toBeGreaterThan(0)
    // Only the board itself, or the board opened on a day: never a booking record.
    for (const href of hrefs) {
      expect(href === BOH || /\/table-bookings\/boh\?date=\d{4}-\d{2}-\d{2}&view=day$/.test(String(href))).toBe(true)
      expect(String(href)).not.toMatch(/\/table-bookings\/[0-9a-f-]{36}/)
    }
    expect(metric(result, 'Parties of 15 or more, next 7 days').value).toBe('2 (58 covers)')
    expect(result.metrics.length).toBeGreaterThanOrEqual(4)
    expect(result.headline).toMatch(/^Next 7 days: \d+ covers booked, /)
  })
})
