// @vitest-environment node
//
// The missing cash-up list around a close after midnight.
//
// New Year's Eve 2026 is 12:00 to 01:00. The list ran up to the server's calendar yesterday,
// so at 00:30 on 1 January it listed 31 December as missing while the till was still open.
// A day now counts only once it has finished trading, on London dates.
//
// Instants are written in UTC so the file reads the same in both test zones: London is on GMT
// from 25 October 2026 to 28 March 2027 and on BST (UTC+1) either side.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as unknown as FakeSupabase & { auth?: unknown } }))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.db }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))

import { getMissingCashupDatesAction } from '@/app/actions/missing-cashups'

const SITE_ID = 'site-1'

function seed(sessions: string[] = []) {
  state.db = createFakeSupabase({
    cashup_sessions: sessions.map((date) => ({ site_id: SITE_ID, session_date: date })),
    special_hours: [
      { date: '2026-12-31', opens: '12:00:00', closes: '01:00:00', is_closed: false },
      { date: '2027-01-01', opens: null, closes: null, is_closed: true },
    ],
    business_hours_versions: [{ id: 'v-1', effective_from: '2026-01-01', status: 'published' }],
    business_hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      id: `v-1-${day}`,
      version_id: 'v-1',
      day_of_week: day,
      opens: '12:00:00',
      closes: '22:00:00',
      is_closed: false,
    })),
  })
  state.db.auth = { getUser: async () => ({ data: { user: { id: 'user-1' } } }) }
}

async function missingAt(isoInstant: string, daysBack: number) {
  vi.setSystemTime(new Date(isoInstant))
  const result = await getMissingCashupDatesAction(SITE_ID, daysBack)
  expect(result.success).toBe(true)
  return result.dates
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  seed()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('New Year\'s Eve, closing at 1am', () => {
  it('does not list 31 December at 00:30 on 1 January, while it is still trading', async () => {
    expect(await missingAt('2027-01-01T00:30:00Z', 3)).toEqual(['2026-12-29', '2026-12-30'])
  })

  it('lists 31 December once the night has closed', async () => {
    expect(await missingAt('2027-01-01T01:30:00Z', 3)).toEqual(['2026-12-29', '2026-12-30', '2026-12-31'])
  })

  it('leaves a day that has its cash-up off the list', async () => {
    seed(['2026-12-30'])
    expect(await missingAt('2027-01-01T01:30:00Z', 3)).toEqual(['2026-12-29', '2026-12-31'])
  })
})

describe('an ordinary night', () => {
  it('lists yesterday straight after midnight, on the London date', async () => {
    // 00:30 BST on Saturday 12 September 2026: Friday shut at 22:00.
    expect(await missingAt('2026-09-11T23:30:00Z', 2)).toEqual(['2026-09-10', '2026-09-11'])
  })
})

describe('a voided cash-up', () => {
  it('keeps its day off the list, because a voided day can never be entered again', async () => {
    // One cash-up per site and date, voided or not: listing the day would leave it on the
    // banner for a year with nothing anyone can do about it.
    seed()
    state.db.tables.cashup_sessions.push(
      { site_id: SITE_ID, session_date: '2026-09-09', voided_at: '2026-09-10T09:00:00Z', status: 'locked' },
      { site_id: SITE_ID, session_date: '2026-09-10', voided_at: null, status: 'draft' },
    )
    expect(await missingAt('2026-09-11T23:30:00Z', 3)).toEqual(['2026-09-11'])
  })
})
