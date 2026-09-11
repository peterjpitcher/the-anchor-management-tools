// @vitest-environment node
//
// "Open now" from both public hours routes, around a close after midnight.
//
// The owner confirmed on 11 September 2026 that New Year's Eve closes at 1am, stored as a
// special hours row of 12:00 to 01:00. Reading today's row alone said the pub was shut at
// 00:30 on 1 January (a closed day) while the party was still running, and open at 00:30
// on 31 December although 30 December had shut at 22:00.
//
// The real routes, the real effective-dated resolver and the real London date helpers
// run here; only the database is an in-memory fake. Instants are written in UTC so the
// file reads the same in both test zones: London is on GMT from 25 October 2026 to
// 28 March 2027 and on BST (UTC+1) either side.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }))

import { GET as getBusinessHours } from '@/app/api/business/hours/route'
import { GET as getLegacyBusinessHours } from '@/app/api/business-hours/route'

type Row = Record<string, unknown>

// Fixture hours, not the pub's: noon to 22:00 with lunch and dinner sittings, and a
// Saturday that closes at midnight (the only after-midnight close the weekly editor allows).
const SITTINGS = [
  { name: 'Lunch', starts_at: '12:00', ends_at: '15:00', capacity: 50, booking_type: 'regular' },
  { name: 'Dinner', starts_at: '16:00', ends_at: '21:00', capacity: 50, booking_type: 'regular' },
]

function version(id: string, effectiveFrom: string): Row {
  return { id, effective_from: effectiveFrom, status: 'published', label: null, is_baseline: false }
}

function week(versionId: string, perDay: Record<number, Row> = {}): Row[] {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    id: `${versionId}-${day}`,
    version_id: versionId,
    day_of_week: day,
    opens: '12:00:00',
    closes: '22:00:00',
    kitchen_opens: '12:00:00',
    kitchen_closes: '21:00:00',
    is_closed: false,
    is_kitchen_closed: false,
    schedule_config: SITTINGS,
    ...perDay[day],
  }))
}

function special(date: string, fields: Row): Row {
  return {
    id: `special-${date}`,
    date,
    kitchen_opens: null,
    kitchen_closes: null,
    is_closed: false,
    is_kitchen_closed: true,
    note: null,
    schedule_config: [],
    ...fields,
  }
}

const SATURDAY_TO_MIDNIGHT = { 6: { closes: '00:00:00' } }

// 30 December is a Wednesday on the regular 12:00 to 22:00.
const NEW_YEAR = [
  special('2026-12-31', { opens: '12:00:00', closes: '01:00:00', note: "New Year's Eve" }),
  special('2027-01-01', { opens: null, closes: null, is_closed: true, note: "New Year's Day" }),
]

function seed({
  versions = [version('v-2026', '2026-01-01')],
  hours = week('v-2026', SATURDAY_TO_MIDNIGHT),
  specials = NEW_YEAR,
}: { versions?: Row[]; hours?: Row[]; specials?: Row[] } = {}) {
  state.db = createFakeSupabase({
    business_hours_versions: versions,
    business_hours: hours,
    special_hours: specials,
    service_statuses: [],
    service_status_overrides: [],
    events: [],
  })
}

async function hoursAt(isoInstant: string, query = '') {
  vi.setSystemTime(new Date(isoInstant))
  const response = await getBusinessHours(
    new NextRequest(`https://management.orangejelly.co.uk/api/business/hours${query}`),
  )
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.success).toBe(true)
  return body.data
}

async function legacyAt(isoInstant: string) {
  vi.setSystemTime(new Date(isoInstant))
  const response = await getLegacyBusinessHours(new NextRequest('https://management.orangejelly.co.uk/api/business-hours'))
  expect(response.status).toBe(200)
  return response.json()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  seed()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('an ordinary day is unchanged', () => {
  // Friday 11 September 2026, British Summer Time.
  it('reports open, the sitting being served and both countdowns', async () => {
    const data = await hoursAt('2026-09-11T17:00:00Z') // 18:00
    expect(data.currentStatus).toMatchObject({
      isOpen: true,
      kitchenOpen: true,
      closesIn: '4 hours',
      opensIn: null,
      currentTime: '18:00:00',
      services: { venue: { open: true, closesIn: '4 hours' }, kitchen: { open: true, closesIn: '3 hours' } },
    })
    expect(data.today).toMatchObject({
      date: '2026-09-11',
      dayName: 'friday',
      summary: 'Open 12:00:00 - 22:00:00, Kitchen 12:00 - 15:00, 16:00 - 21:00',
    })
    expect((await legacyAt('2026-09-11T17:00:00Z')).currentStatus).toMatchObject({
      isOpen: true,
      currentTime: '18:00',
      currentDate: '2026-09-11',
      currentDay: 5,
      todayHours: { open_time: '12:00:00', close_time: '22:00:00', kitchen_last_order_time: '21:00:00' },
    })
  })

  it('reports the kitchen shut between sittings', async () => {
    const data = await hoursAt('2026-09-11T14:30:00Z') // 15:30
    expect(data.currentStatus).toMatchObject({
      isOpen: true,
      kitchenOpen: false,
      closesIn: '6 hours 30 minutes',
      services: { kitchen: { open: false, closesIn: null } },
    })
  })

  it('counts down to opening in the morning and says nothing after closing', async () => {
    expect((await hoursAt('2026-09-11T09:00:00Z')).currentStatus).toMatchObject({
      isOpen: false,
      kitchenOpen: false,
      closesIn: null,
      opensIn: '2 hours',
    })
    expect((await hoursAt('2026-09-11T22:30:00Z')).currentStatus).toMatchObject({
      isOpen: false,
      closesIn: null,
      opensIn: null,
    })
    expect((await legacyAt('2026-09-11T09:00:00Z')).currentStatus.isOpen).toBe(false)
    expect((await legacyAt('2026-09-11T22:30:00Z')).currentStatus.isOpen).toBe(false)
  })
})

describe("New Year's Eve, 12:00 to 01:00", () => {
  it('is open at 12:00 on 31 December, counting down to 1am', async () => {
    const data = await hoursAt('2026-12-31T12:00:00Z')
    expect(data.currentStatus).toMatchObject({ isOpen: true, kitchenOpen: false, closesIn: '13 hours', opensIn: null })
    expect(data.today).toMatchObject({ date: '2026-12-31', summary: 'Open 12:00:00 - 01:00:00', isSpecialHours: true })
    expect((await legacyAt('2026-12-31T12:00:00Z')).currentStatus).toMatchObject({
      isOpen: true,
      todayHours: { open_time: '12:00:00', close_time: '01:00:00' },
    })
  })

  it('is open at 23:30 on 31 December, with an hour and a half to go', async () => {
    const data = await hoursAt('2026-12-31T23:30:00Z')
    expect(data.currentStatus).toMatchObject({
      isOpen: true,
      closesIn: '1 hour 30 minutes',
      services: { venue: { open: true, closesIn: '1 hour 30 minutes' } },
    })
    expect((await legacyAt('2026-12-31T23:30:00Z')).currentStatus.isOpen).toBe(true)
  })

  it('is still open at 00:30 on 1 January, on 31 December\'s hours, though 1 January is closed', async () => {
    const data = await hoursAt('2027-01-01T00:30:00Z')
    expect(data.currentStatus).toMatchObject({
      isOpen: true,
      kitchenOpen: false,
      closesIn: '30 minutes',
      opensIn: null,
      currentTime: '00:30:00',
      services: { venue: { open: true, closesIn: '30 minutes' }, kitchen: { open: false, closesIn: null } },
    })
    // The calendar day itself is still reported as it is.
    expect(data.today).toMatchObject({ date: '2027-01-01', summary: 'Closed' })
    // Yesterday's row is read for the status but never returned as upcoming special hours.
    expect(data.specialHours.map((row: Row) => row.date)).toEqual(['2027-01-01'])
    expect(data.planning.nextClosure).toMatchObject({ date: '2027-01-01' })

    const legacy = await legacyAt('2027-01-01T00:30:00Z')
    expect(legacy.currentStatus).toMatchObject({
      isOpen: true,
      currentDate: '2027-01-01',
      todayHours: { is_closed: true },
    })
    expect(legacy.specialHours.map((row: Row) => row.date)).toEqual(['2027-01-01'])
  })

  it('is closed at 00:30 on 31 December, because 30 December shut at 22:00', async () => {
    const data = await hoursAt('2026-12-31T00:30:00Z')
    expect(data.currentStatus).toMatchObject({
      isOpen: false,
      closesIn: null,
      opensIn: '11 hours 30 minutes',
      services: { venue: { open: false, closesIn: null } },
    })
    expect((await legacyAt('2026-12-31T00:30:00Z')).currentStatus.isOpen).toBe(false)
  })

  it('is closed from 1am on 1 January', async () => {
    const data = await hoursAt('2027-01-01T01:00:00Z')
    expect(data.currentStatus).toMatchObject({ isOpen: false, kitchenOpen: false, closesIn: null, opensIn: null })
    expect((await legacyAt('2027-01-01T01:00:00Z')).currentStatus.isOpen).toBe(false)
  })
})

describe('a regular close at midnight', () => {
  // Saturday 7 November 2026, GMT, on the regular 12:00 to 00:00.
  it('counts down to midnight instead of going negative', async () => {
    // The clock-time countdown said "-30 minute" here.
    const data = await hoursAt('2026-11-07T23:30:00Z')
    expect(data.currentStatus).toMatchObject({ isOpen: true, closesIn: '30 minutes' })
    expect((await legacyAt('2026-11-07T23:30:00Z')).currentStatus.isOpen).toBe(true)
  })

  it('is closed after midnight, with Sunday still to open', async () => {
    const data = await hoursAt('2026-11-08T00:30:00Z')
    expect(data.currentStatus).toMatchObject({ isOpen: false, closesIn: null, opensIn: '11 hours 30 minutes' })
    expect((await legacyAt('2026-11-08T00:30:00Z')).currentStatus.isOpen).toBe(false)
  })
})

describe('a regular 1am close, read from the version in force the day before', () => {
  // The weekly editor only allows a midnight close, but the table can hold a later one.
  // A new schedule starts on Sunday 15 November 2026 with Saturday back to 22:00, so at
  // 00:30 that Sunday the Saturday night still runs on the old schedule.
  beforeEach(() => {
    seed({
      versions: [version('v-old', '2026-01-01'), version('v-new', '2026-11-15')],
      hours: [...week('v-old', { 6: { closes: '01:00:00' } }), ...week('v-new')],
      specials: [],
    })
  })

  it('is open at 00:30 on the Sunday the new schedule starts', async () => {
    const data = await hoursAt('2026-11-15T00:30:00Z')
    expect(data.currentStatus).toMatchObject({ isOpen: true, closesIn: '30 minutes' })
    expect(data.regularHours.saturday).toMatchObject({ closes: '22:00:00' })
    expect((await legacyAt('2026-11-15T00:30:00Z')).currentStatus.isOpen).toBe(true)
  })

  it('reads the status from today, whatever date ?date= asks about', async () => {
    const data = await hoursAt('2026-11-15T00:30:00Z', '?date=2026-11-21')
    expect(data.currentStatus).toMatchObject({ isOpen: true, closesIn: '30 minutes' })
  })

  it('is closed at 00:30 the Sunday after, on the new schedule', async () => {
    expect((await hoursAt('2026-11-22T00:30:00Z')).currentStatus).toMatchObject({ isOpen: false, opensIn: '11 hours 30 minutes' })
    expect((await legacyAt('2026-11-22T00:30:00Z')).currentStatus.isOpen).toBe(false)
  })
})

describe('the night the clocks go back, 25 October 2026', () => {
  it('closes a midnight Saturday at midnight and counts the extra hour before Sunday opens', async () => {
    const saturdayNight = await hoursAt('2026-10-24T22:30:00Z') // 23:30 BST
    expect(saturdayNight.currentStatus).toMatchObject({ isOpen: true, closesIn: '30 minutes' })

    // 00:30 BST to 12:00 GMT is twelve and a half hours, not the eleven and a half on the clock face.
    const smallHours = await hoursAt('2026-10-24T23:30:00Z')
    expect(smallHours.currentStatus).toMatchObject({ isOpen: false, opensIn: '12 hours 30 minutes' })
    expect((await legacyAt('2026-10-24T23:30:00Z')).currentStatus.isOpen).toBe(false)
  })

  it('closes a 1am Saturday at the first 1am and stays shut through the repeated hour', async () => {
    seed({ specials: [special('2026-10-24', { opens: '12:00:00', closes: '01:00:00' })] })

    expect((await hoursAt('2026-10-24T23:30:00Z')).currentStatus).toMatchObject({ isOpen: true, closesIn: '30 minutes' })
    expect((await legacyAt('2026-10-24T23:30:00Z')).currentStatus.isOpen).toBe(true)

    // 01:00 BST, then 01:30 GMT.
    expect((await hoursAt('2026-10-25T00:00:00Z')).currentStatus).toMatchObject({ isOpen: false })
    expect((await hoursAt('2026-10-25T01:30:00Z')).currentStatus).toMatchObject({ isOpen: false, opensIn: '10 hours 30 minutes' })
    expect((await legacyAt('2026-10-25T01:30:00Z')).currentStatus.isOpen).toBe(false)
  })
})

describe('the night the clocks go forward, 28 March 2027', () => {
  it('closes a midnight Saturday at midnight', async () => {
    expect((await hoursAt('2027-03-27T23:30:00Z')).currentStatus).toMatchObject({ isOpen: true, closesIn: '30 minutes' })
    // 00:30 GMT to 12:00 BST is ten and a half hours.
    expect((await hoursAt('2027-03-28T00:30:00Z')).currentStatus).toMatchObject({ isOpen: false, opensIn: '10 hours 30 minutes' })
  })

  it('keeps a 1am Saturday open until the clock jumps', async () => {
    seed({ specials: [special('2027-03-27', { opens: '12:00:00', closes: '01:00:00' })] })

    expect((await hoursAt('2027-03-28T00:30:00Z')).currentStatus).toMatchObject({ isOpen: true, closesIn: '30 minutes' })
    expect((await legacyAt('2027-03-28T00:30:00Z')).currentStatus.isOpen).toBe(true)

    // 02:30 BST, an hour after the jump.
    expect((await hoursAt('2027-03-28T01:30:00Z')).currentStatus).toMatchObject({ isOpen: false, opensIn: '9 hours 30 minutes' })
    expect((await legacyAt('2027-03-28T01:30:00Z')).currentStatus.isOpen).toBe(false)
  })
})
