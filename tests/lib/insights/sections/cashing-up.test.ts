import { describe, expect, it } from 'vitest'
import { eachIsoDateInRange } from '@/lib/dateUtils'
import { findMissingCashupDates, isYesterdayStillTrading, loadTradingDays } from '@/lib/cashing-up/trading-days'
import { buildInsightsReport } from '@/lib/insights/engine'
import { buildCashingUpSection, cashingUpSection } from '@/lib/insights/sections/cashing-up'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { makeContext, TEST_APP_URL } from '../helpers/context'

// makeContext: Friday 25 Sep 2026 06:00 London. Today 2026-09-25, yesterday Thu 24 Sep,
// this week Fri 18 to Thu 24 Sep, last week Fri 11 to Thu 17 Sep, the previous 13 weeks
// 19 Jun to 17 Sep (12 Jun to 10 Sep before last week), and the same weeks a year earlier
// (364 days) Fri 12 to Thu 25 Sep 2025.
//
// Entry window: a day is missing only when it is on or before Mon 21 Sep (today minus 4);
// Tue 22, Wed 23 and Thu 24 Sep with no cash-up are "not entered yet". Missing days are
// counted from Tue 8 Sep (14 days up to Mon 21 Sep).

type Row = Record<string, unknown>

const SITE = { id: 'site-1', name: 'The Anchor' }
const THIS_WEEK = eachIsoDateInRange('2026-09-18', '2026-09-24')
const LAST_WEEK = eachIsoDateInRange('2026-09-11', '2026-09-17')
const HISTORY = eachIsoDateInRange('2026-06-12', '2026-09-17')
const YEAR_AGO = eachIsoDateInRange('2025-09-12', '2025-09-25')
const LAST_WEEK_LABEL = 'Last complete week (Fri 11 to Thu 17 Sep) against the 13-week weekday average'
const LAST_WEEK_NOTE = 'Performance comparison is for the last complete week, Fri 11 to Thu 17 Sep, because '
const PERSON = 'Jane Cashcounter'

interface SessionOptions {
  takings?: number
  cash?: number
  variance?: number
  status?: string
  site?: string
  voided?: boolean
  breakdowns?: Row[] | null
  totalCounted?: number | string | null
  /** When the cash-up was entered; by default late that evening, on its own London date. */
  createdAt?: string | null
}

function session(date: string, options: SessionOptions = {}): Row {
  const site = options.site ?? SITE.id
  const takings = options.takings ?? 500
  const cash = options.cash ?? Math.round(takings * 0.3 * 100) / 100
  const variance = options.variance ?? 0
  const breakdowns = options.breakdowns !== undefined
    ? options.breakdowns
    : [
        { payment_type_code: 'CASH', counted_amount: cash + 0, expected_amount: cash - variance, variance_amount: variance },
        { payment_type_code: 'CARD', counted_amount: Math.round((takings - cash) * 100) / 100, expected_amount: takings - cash, variance_amount: 0 },
        { payment_type_code: 'STRIPE', counted_amount: 0, expected_amount: 0, variance_amount: 0 },
      ]
  return {
    id: `s-${site}-${date}`,
    site_id: site,
    session_date: date,
    status: options.status ?? 'submitted',
    created_at: options.createdAt !== undefined ? options.createdAt : `${date}T22:30:00Z`,
    total_counted_amount: options.totalCounted !== undefined ? options.totalCounted : takings,
    total_expected_amount: takings - variance,
    total_variance_amount: variance,
    voided_at: options.voided ? '2026-09-23T10:00:00Z' : null,
    prepared_by_user_id: 'user-1',
    notes: `Counted by ${PERSON}`,
    cashup_payment_breakdowns: breakdowns,
  }
}

function days(dates: string[], options: SessionOptions | ((date: string) => SessionOptions | null) = {}): Row[] {
  return dates.flatMap((date) => {
    const resolved = typeof options === 'function' ? options(date) : options
    return resolved ? [session(date, resolved)] : []
  })
}

/** 14 weeks of £500 days and the year-ago fortnight of £500 days. */
function history(options: SessionOptions = {}): Row[] {
  return [...days(HISTORY, options), ...days(YEAR_AGO, options)]
}

interface DbOptions {
  sessions: Row[]
  special?: Row[]
  sites?: Row[]
  closedWeekdays?: number[]
}

function db(options: DbOptions): FakeDb {
  const closed = new Set(options.closedWeekdays ?? [])
  return new FakeDb({
    sites: options.sites ?? [SITE],
    cashup_sessions: options.sessions,
    special_hours: options.special ?? [],
    business_hours_versions: [{ id: 'v1', effective_from: '2000-01-01', status: 'published' }],
    business_hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      id: `bh-${day}`,
      version_id: 'v1',
      day_of_week: day,
      opens: '12:00:00',
      closes: '22:00:00',
      is_closed: closed.has(day),
    })),
  })
}

async function build(fake: FakeDb, now?: Date): Promise<SectionBuildResult> {
  return buildCashingUpSection(makeContext(fake, now))
}

function byKey(result: SectionBuildResult, prefix: string): InsightSignal[] {
  return result.signals.filter((signal) => signal.key.startsWith(prefix))
}

function issues(result: SectionBuildResult): InsightSignal[] {
  return result.signals.filter((signal) => signal.kind === 'issue')
}

function metric(result: SectionBuildResult, label: string): { label: string; value: string; comparison?: string } | undefined {
  return result.metrics.find((item) => item.label === label)
}

function expectClean(result: SectionBuildResult): void {
  const text = JSON.stringify(result)
  expect(text).not.toMatch(/undefined|NaN|Invalid Date|Infinity/)
  expect(text).not.toContain(PERSON)
  expect(text).not.toContain(String.fromCharCode(0x2014))
  expect(text).not.toContain('!')
}

describe('cashing up section', () => {
  it('is registered under the cashing_up key with the cashing-up dashboard', () => {
    expect(cashingUpSection).toMatchObject({ key: 'cashing_up', title: 'Cashing up', path: '/cashing-up/dashboard' })
  })

  it('says so when no site is set up, and expects nothing', async () => {
    const result = await build(db({ sessions: [], sites: [] }))
    expect(result.headline).toBe('No site is set up for cashing up.')
    expect(result.signals).toEqual([])
    expect(result.metrics).toEqual([])
  })

  it('compares a complete, ordinary week and raises nothing', async () => {
    const result = await build(db({ sessions: [...history(), ...days(THIS_WEEK)] }))
    expect(result.headline).toBe('7 of 7 trading days entered. Takings £3,500, in line with the usual week.')
    expect(result.signals).toEqual([])
    expect(result.notes).toEqual([])
    expect(result.metrics.slice(0, 4)).toEqual([
      { label: 'Cash-ups entered', value: '7 of 7 trading days', comparison: 'none missing' },
      { label: 'Takings', value: '£3,500', comparison: 'over 7 entered days, £500 a day' },
      { label: 'Against the 13-week weekday average', value: 'in line', comparison: 'usual week £3,500' },
      { label: 'Variances of £10 or more', value: '0', comparison: 'none entered this week; none in the previous 13 weeks' },
    ])
    expect(metric(result, 'Against the 4-week weekday average')).toEqual({ label: 'Against the 4-week weekday average', value: 'in line', comparison: 'usual week £3,500' })
    expect(metric(result, 'Against the same week last year')).toEqual({ label: 'Against the same week last year', value: 'in line', comparison: 'last year £3,500' })
    expect(metric(result, 'Cash share of takings')).toEqual({ label: 'Cash share of takings', value: '30%', comparison: '13-week average 30%' })
    expect(result.lists[0].items[0]).toEqual({
      text: 'Fri 18 Sep: £500.00, cash £150.00.',
      href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-18`,
    })
    expect(result.lists[1]).toMatchObject({ title: 'Missing cash-ups', items: [], emptyText: 'No missing cash-ups.' })
    expectClean(result)
  })

  it('reads amounts from the payment breakdowns, not the session totals', async () => {
    const week = THIS_WEEK.map((date) => session(date, { takings: 500, totalCounted: 9999 }))
    const result = await build(db({ sessions: [...history(), ...week] }))
    expect(metric(result, 'Takings')?.value).toBe('£3,500')
  })

  describe('completeness', () => {
    it('raises amber for one missing day with a record action on that day', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, (date) => (date === '2026-09-21' ? null : {}))]
      const result = await build(db({ sessions }))
      expect(result.headline).toBe('6 of 7 trading days entered; missing Mon 21 Sep. Takings £3,000 over 6 entered days. Last complete week, Fri 11 to Thu 17 Sep: £3,500, in line with the usual week.')
      const [missing] = byKey(result, 'cashing_up.missing.')
      expect(missing).toMatchObject({
        key: 'cashing_up.missing.site-1',
        rag: 'amber',
        kind: 'issue',
        emailSafe: true,
        text: '1 trading day has gone more than 3 days without a cash-up: Mon 21 Sep.',
        action: {
          text: 'Enter the cash-up for Mon 21 Sep',
          href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-21`,
          target: 'record',
          dueDate: '2026-09-21',
          impact: 'money',
        },
      })
      expect(result.notes).toContain(`${LAST_WEEK_NOTE}1 trading day this week is missing.`)
      expect(metric(result, LAST_WEEK_LABEL)).toEqual({ label: LAST_WEEK_LABEL, value: 'in line', comparison: 'took £3,500; usual week £3,500' })
      expect(result.lists[0].items[3]).toEqual({ text: 'Mon 21 Sep: missing.', href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-21`, rag: 'amber' })
      expectClean(result)
    })

    it('raises amber for a trading day 5 days old with no cash-up', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, (date) => (date === '2026-09-20' ? null : {}))]
      const result = await build(db({ sessions }))
      expect(byKey(result, 'cashing_up.missing.')).toEqual([expect.objectContaining({
        rag: 'amber',
        text: '1 trading day has gone more than 3 days without a cash-up: Sun 20 Sep.',
        action: expect.objectContaining({ text: 'Enter the cash-up for Sun 20 Sep', dueDate: '2026-09-20' }),
      })])
      expect(result.lists[0].items[2]).toEqual({ text: 'Sun 20 Sep: missing.', href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-20`, rag: 'amber' })
    })

    it('raises amber with one list action for two missing days', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, (date) => (['2026-09-20', '2026-09-21'].includes(date) ? null : {}))]
      const result = await build(db({ sessions }))
      expect(result.headline).toBe('5 of 7 trading days entered; missing Sun 20 Sep and Mon 21 Sep. Takings £2,500 over 5 entered days. Last complete week, Fri 11 to Thu 17 Sep: £3,500, in line with the usual week.')
      const [missing] = byKey(result, 'cashing_up.missing.')
      expect(missing.rag).toBe('amber')
      expect(missing.action).toEqual({
        text: 'Enter 2 missing cash-ups, the earliest Sun 20 Sep',
        href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-20`,
        target: 'list',
        members: ['Enter the cash-up for Sun 20 Sep', 'Enter the cash-up for Mon 21 Sep'],
        dueDate: '2026-09-20',
        impact: 'money',
      })
      expect(result.notes).toContain(`${LAST_WEEK_NOTE}2 trading days this week are missing.`)
    })

    it('raises red for three or more trading days more than 3 days old with no cash-up', async () => {
      const gaps = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-23']
      const sessions = [...history(), ...days(THIS_WEEK, (date) => (gaps.includes(date) ? null : {}))]
      const result = await build(db({ sessions }))
      const [missing] = byKey(result, 'cashing_up.missing.')
      expect(missing.rag).toBe('red')
      // Wed 23 Sep is inside the entry window, so it is not one of them.
      expect(missing.text).toBe('3 trading days have gone more than 3 days without a cash-up: Fri 18 Sep, Sat 19 Sep and Sun 20 Sep.')
      expect(missing.action).toMatchObject({ text: 'Enter 3 missing cash-ups, the earliest Fri 18 Sep', target: 'list' })
      expect(missing.action?.members).toHaveLength(3)
      expect(result.headline.startsWith('3 of 7 trading days entered; missing Fri 18 Sep, Sat 19 Sep and Sun 20 Sep; Wed 23 Sep not entered yet.')).toBe(true)
      expect(result.lists[1].items.map((item) => item.text)).toEqual(['Fri 18 Sep', 'Sat 19 Sep', 'Sun 20 Sep'])
      expect(result.lists[1].items.every((item) => item.rag === 'red')).toBe(true)
      expect(result.lists[0].items[5]).toEqual({ text: 'Wed 23 Sep: not entered yet.', href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-23` })
      expect(result.notes).toContain(`${LAST_WEEK_NOTE}4 trading days this week are missing or not entered yet.`)
    })

    it('at Friday 06:00 with Wed and Thu not entered: no signal, a note, and last week compared and labelled', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, (date) => (['2026-09-23', '2026-09-24'].includes(date) ? null : {}))]
      const result = await build(db({ sessions }))
      expect(result.signals).toEqual([])
      expect(result.headline).toBe(
        '5 of 7 trading days entered; Wed 23 Sep and Thu 24 Sep not entered yet. Takings £2,500 over 5 entered days. '
        + 'Last complete week, Fri 11 to Thu 17 Sep: £3,500, in line with the usual week.',
      )
      expect(result.notes).toEqual([
        'Not entered yet: Wed 23 Sep and Thu 24 Sep (within the usual 3-day entry window).',
        `${LAST_WEEK_NOTE}2 trading days this week are not entered yet.`,
      ])
      expect(result.metrics.slice(0, 4)).toEqual([
        { label: 'Cash-ups entered', value: '5 of 7 trading days', comparison: 'Wed 23 Sep and Thu 24 Sep not entered yet' },
        { label: 'Takings', value: '£2,500', comparison: 'over 5 entered days, £500 a day' },
        { label: LAST_WEEK_LABEL, value: 'in line', comparison: 'took £3,500; usual week £3,500' },
        { label: 'Variances of £10 or more', value: '0', comparison: 'none entered this week; none in the previous 13 weeks' },
      ])
      expect(metric(result, 'Last complete week (Fri 11 to Thu 17 Sep) against the 4-week weekday average')?.value).toBe('in line')
      expect(metric(result, 'Last complete week (Fri 11 to Thu 17 Sep) against the same week last year')).toMatchObject({ value: 'in line', comparison: 'took £3,500; last year £3,500' })
      expect(result.metrics.some((item) => item.label.startsWith('Against'))).toBe(false)
      expect(result.lists[0].items.slice(5)).toEqual([
        { text: 'Wed 23 Sep: not entered yet.', href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-23` },
        { text: 'Thu 24 Sep: not entered yet.', href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-24` },
      ])
      expect(result.lists[1].items).toEqual([])
      expectClean(result)
    })

    it('never counts yesterday as missing', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, (date) => (date === '2026-09-24' ? null : {}))]
      const result = await build(db({ sessions }))
      expect(byKey(result, 'cashing_up.missing.')).toEqual([])
      expect(issues(result)).toEqual([])
      expect(result.headline.startsWith('6 of 7 trading days entered; Thu 24 Sep not entered yet. Takings £3,000 over 6 entered days.')).toBe(true)
      expect(result.notes[0]).toBe('Not entered yet: Thu 24 Sep (within the usual 3-day entry window).')
      expect(result.lists[0].items[6]).toEqual({ text: 'Thu 24 Sep: not entered yet.', href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-24` })
    })

    it('does not compare when neither this week nor last week is complete', async () => {
      const sessions = [...history(), ...days(THIS_WEEK)].filter((row) => !['2026-09-15', '2026-09-24'].includes(row.session_date as string))
      const result = await build(db({ sessions }))
      expect(result.headline).toBe('6 of 7 trading days entered; Thu 24 Sep not entered yet. Takings £3,000 over 6 entered days. 1 earlier day also missing.')
      expect(result.notes).toEqual([
        'Not entered yet: Thu 24 Sep (within the usual 3-day entry window).',
        'Performance comparison not made: 2 trading days across this week and last week are missing or not entered yet.',
      ])
      for (const phrase of ['the 13-week weekday average', 'the 4-week weekday average', 'the same week last year']) {
        expect(metric(result, `Against ${phrase}`)).toEqual({
          label: `Against ${phrase}`,
          value: 'Not compared',
          comparison: 'neither this week nor last week is complete',
        })
      }
      expect(byKey(result, 'cashing_up.week_')).toEqual([])
      expect(byKey(result, 'cashing_up.missing.')[0].text).toBe('1 trading day has gone more than 3 days without a cash-up: Tue 15 Sep.')
      expectClean(result)
    })

    it('treats a draft as not entered and says why', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, (date) => (date === '2026-09-21' ? { status: 'draft' } : {}))]
      const result = await build(db({ sessions }))
      expect(byKey(result, 'cashing_up.missing.')).toHaveLength(1)
      expect(result.notes).toContain('Mon 21 Sep has a draft cash-up that was never submitted, so it counts as not entered.')
      expect(result.lists[0].items[3].text).toBe('Mon 21 Sep: missing (a draft was started but not submitted).')
      expect(metric(result, 'Takings')?.value).toBe('£3,000')
    })

    it('counts approved and locked cash-ups as entered, and a voided day as voided with no action', async () => {
      // A voided cash-up cannot be replaced (one cash-up per site and date, voided or not),
      // so calling its day missing would raise an action nobody can complete.
      const sessions = [
        ...history(),
        ...days(THIS_WEEK, (date) => {
          if (date === '2026-09-19') return { status: 'approved' }
          if (date === '2026-09-20') return { status: 'locked' }
          if (date === '2026-09-21') return { voided: true }
          return {}
        }),
      ]
      const result = await build(db({ sessions }))
      expect(result.signals).toEqual([])
      expect(result.headline).toBe(
        '6 of 7 trading days entered; Mon 21 Sep voided, not re-entered. Takings £3,000 over 6 entered days. '
        + 'Last complete week, Fri 11 to Thu 17 Sep: £3,500, in line with the usual week.',
      )
      expect(metric(result, 'Cash-ups entered')).toEqual({ label: 'Cash-ups entered', value: '6 of 7 trading days', comparison: 'Mon 21 Sep voided, not re-entered' })
      expect(metric(result, 'Takings')?.value).toBe('£3,000')
      expect(result.lists[0].items[3]).toEqual({ text: 'Mon 21 Sep: voided, not re-entered.', href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-21` })
      expect(result.lists[1].items).toEqual([])
      // Its takings are unknown, so this week is not compared; last week stands in.
      expect(result.notes).toEqual([
        `${LAST_WEEK_NOTE}1 trading day this week was voided and not re-entered.`,
        'Mon 21 Sep has a voided cash-up that was not re-entered, so its takings are not known. A voided day cannot be entered again, so it is not counted as missing.',
      ])
      expectClean(result)

      const report = await buildInsightsReport({
        createDb: () => db({ sessions }).asDb(),
        now: new Date('2026-09-25T05:00:00Z'),
        appUrl: TEST_APP_URL,
        sections: [cashingUpSection],
      })
      expect(report.sections[0].status).toBe('green')
      expect(report.actions).toEqual([])
    })

    it('never calls a voided day missing, before this week or inside the entry window', async () => {
      const voided = ['2026-09-15', '2026-09-23']
      const sessions = [
        ...history(),
        ...days(THIS_WEEK),
      ].map((row) => (voided.includes(row.session_date as string) ? session(row.session_date as string, { voided: true }) : row))
      const result = await build(db({ sessions }))
      expect(byKey(result, 'cashing_up.missing.')).toEqual([])
      expect(issues(result)).toEqual([])
      expect(result.lists[0].items[5]).toEqual({ text: 'Wed 23 Sep: voided, not re-entered.', href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-23` })
      expect(result.headline).toBe('6 of 7 trading days entered; Wed 23 Sep voided, not re-entered. Takings £3,000 over 6 entered days.')
      expect(result.notes).toEqual([
        'Performance comparison not made: 2 trading days across this week and last week were voided and not re-entered.',
        'Tue 15 Sep and Wed 23 Sep have voided cash-ups that were not re-entered, so their takings are not known. A voided day cannot be entered again, so they are not counted as missing.',
      ])
      expectClean(result)
    })

    it('names missing days before this week, within the 14 days up to the entry window', async () => {
      // Sun 6 Sep is older than the 14 days checked, so it is left to the missing cash-ups page.
      const gaps = ['2026-09-06', '2026-09-08', '2026-09-14']
      const sessions = [...history(), ...days(THIS_WEEK)].filter((row) => !gaps.includes(row.session_date as string))
      const result = await build(db({ sessions }))
      const [missing] = byKey(result, 'cashing_up.missing.')
      expect(missing.rag).toBe('amber')
      expect(missing.text).toBe('2 trading days have gone more than 3 days without a cash-up: Tue 8 Sep and Mon 14 Sep.')
      expect(missing.action).toMatchObject({
        text: 'Enter 2 missing cash-ups, the earliest Tue 8 Sep',
        members: ['Enter the cash-up for Tue 8 Sep', 'Enter the cash-up for Mon 14 Sep'],
        dueDate: '2026-09-08',
      })
      // This week is complete, so it is compared even though last week is not.
      expect(result.headline).toBe('7 of 7 trading days entered. Takings £3,500, in line with the usual week. 2 earlier days also missing.')
      expect(result.lists[1].items.map((item) => item.text)).toEqual(['Tue 8 Sep', 'Mon 14 Sep'])
    })

    it('expects no cash-up on a day special hours close, and still compares the week', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, (date) => (date === '2026-09-22' ? null : {}))]
      const result = await build(db({ sessions, special: [{ id: 'sh1', date: '2026-09-22', opens: null, closes: null, is_closed: true }] }))
      expect(byKey(result, 'cashing_up.missing.')).toEqual([])
      expect(result.headline).toBe('6 of 6 trading days entered. Takings £3,000, in line with the usual week.')
      expect(result.notes).toContain('No cash-up expected on Tue 22 Sep: the venue was closed.')
      expect(result.lists[0].items[4]).toEqual({ text: 'Tue 22 Sep: closed, no cash-up expected.' })
      expect(metric(result, 'Against the 13-week weekday average')?.comparison).toBe('usual week £3,000')
    })

    it('treats a special-hours day with no closed flag as open, and a weekday the hours close as closed', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, (date) => (['2026-09-20', '2026-09-21'].includes(date) ? null : {}))]
      const result = await build(db({
        sessions,
        closedWeekdays: [0],
        special: [{ id: 'sh1', date: '2026-09-21', opens: '12:00:00', closes: '22:00:00', is_closed: null }],
      }))
      const [missing] = byKey(result, 'cashing_up.missing.')
      expect(missing.text).toBe('1 trading day has gone more than 3 days without a cash-up: Mon 21 Sep.')
      expect(result.notes).toContain('No cash-up expected on Sun 20 Sep: the venue was closed.')
    })

    it('shows a genuinely zero day as £0.00 and counts it as entered', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, (date) => (date === '2026-09-22' ? { takings: 0, cash: 0 } : {}))]
      const result = await build(db({ sessions }))
      expect(result.headline.startsWith('7 of 7 trading days entered.')).toBe(true)
      expect(metric(result, 'Takings')).toEqual({ label: 'Takings', value: '£3,000', comparison: 'over 7 entered days, £429 a day' })
      expect(result.lists[0].items[4].text).toBe('Tue 22 Sep: £0.00, cash £0.00, 100% below the usual Tuesday of £500.00.')
    })

    it('keeps a genuine zero day apart from a missing day, and counts it towards a complete week', async () => {
      const sessions = [
        ...history().filter((row) => row.session_date !== '2026-09-15'),
        session('2026-09-15', { takings: 0, cash: 0 }),
        ...days(THIS_WEEK, (date) => {
          if (date === '2026-09-20') return null
          if (date === '2026-09-21') return { takings: 0, cash: 0 }
          return {}
        }),
      ]
      const result = await build(db({ sessions }))
      const [missing] = byKey(result, 'cashing_up.missing.')
      expect(missing.text).toBe('1 trading day has gone more than 3 days without a cash-up: Sun 20 Sep.')
      expect(result.lists[0].items[2]).toMatchObject({ text: 'Sun 20 Sep: missing.', rag: 'amber' })
      expect(result.lists[0].items[3].text).toBe('Mon 21 Sep: £0.00, cash £0.00, 100% below the usual Monday of £500.00.')
      expect(metric(result, 'Cash-ups entered')).toEqual({ label: 'Cash-ups entered', value: '6 of 7 trading days', comparison: 'missing Sun 20 Sep' })
      // Last week's zero Tuesday is entered, so last week is complete and compared at £3,000.
      expect(metric(result, LAST_WEEK_LABEL)).toMatchObject({ comparison: 'took £3,000; usual week £3,500' })
      expect(result.headline).toContain('Last complete week, Fri 11 to Thu 17 Sep: £3,000, in line with the usual week.')
      expectClean(result)
    })

    it('never turns a missing week into £0 takings', async () => {
      const result = await build(db({ sessions: history() }))
      expect(metric(result, 'Takings')).toEqual({ label: 'Takings', value: 'Not entered', comparison: 'no cash-ups entered this week' })
      expect(result.headline).toBe(
        '0 of 7 trading days entered; 4 missing; Tue 22 Sep, Wed 23 Sep and Thu 24 Sep not entered yet. No takings recorded yet this week. '
        + 'Last complete week, Fri 11 to Thu 17 Sep: £3,500, in line with the usual week.',
      )
      expect(byKey(result, 'cashing_up.missing.')[0].rag).toBe('red')
      expect(byKey(result, 'cashing_up.week_')).toEqual([])
      expect(JSON.stringify(result)).not.toContain('£0')
    })

    it('uses the session totals when a cash-up has no payment breakdown, and leaves unreadable amounts out', async () => {
      const sessions = [
        ...history(),
        ...days(THIS_WEEK, (date) => {
          if (date === '2026-09-19') return { breakdowns: [], totalCounted: 640 }
          if (date === '2026-09-20') return { breakdowns: [], totalCounted: null }
          return {}
        }),
      ]
      const result = await build(db({ sessions }))
      expect(result.lists[0].items[1].text).toBe('Sat 19 Sep: £640.00.')
      expect(result.lists[0].items[2]).toMatchObject({ text: 'Sun 20 Sep: entered, but the amounts cannot be read.', rag: 'amber' })
      expect(metric(result, 'Takings')?.value).toBe('£3,140')
      expect(result.notes).toContain(`${LAST_WEEK_NOTE}1 entered day this week has amounts that cannot be read.`)
      expect(result.notes).toContain('Sun 20 Sep has amounts that cannot be read, so it is left out of takings.')
      expectClean(result)
    })
  })

  describe('weekly comparison', () => {
    it('raises amber when a complete week is 20% or more below the weekday average', async () => {
      const result = await build(db({ sessions: [...history(), ...days(THIS_WEEK, { takings: 300 })] }))
      const [below] = byKey(result, 'cashing_up.week_below.')
      expect(below).toEqual({
        key: 'cashing_up.week_below.site-1',
        rag: 'amber',
        kind: 'issue',
        emailSafe: true,
        text: 'Takings of £2,100 this week were 40% below the usual week of £3,500 (13-week weekday average).',
      })
      expect(result.headline).toBe('7 of 7 trading days entered. Takings £2,100, down 40% on the usual week.')
      expect(metric(result, 'Against the 13-week weekday average')?.value).toBe('down 40%')
    })

    it('records a win when a complete week is 20% or more above', async () => {
      const result = await build(db({ sessions: [...history(), ...days(THIS_WEEK, { takings: 700 })] }))
      const [above] = byKey(result, 'cashing_up.week_above.')
      expect(above).toMatchObject({ rag: 'green', kind: 'win', emailSafe: true })
      expect(above.text).toBe('Takings of £4,900 this week were 40% above the usual week of £3,500 (13-week weekday average).')
      expect(issues(result)).toEqual([])
    })

    it('calls a change under 20% steady', async () => {
      const result = await build(db({ sessions: [...history(), ...days(THIS_WEEK, { takings: 590 })] }))
      expect(byKey(result, 'cashing_up.week_')).toEqual([])
      expect(metric(result, 'Against the 13-week weekday average')?.value).toBe('in line')
    })

    it('ignores a 20% change smaller than the weekly floor', async () => {
      const low = [...days(HISTORY, { takings: 30 }), ...days(YEAR_AGO, { takings: 30 })]
      const result = await build(db({ sessions: [...low, ...days(THIS_WEEK, { takings: 40 })] }))
      expect(byKey(result, 'cashing_up.week_')).toEqual([])
    })

    it('compares against each weekday, so a strong Sunday baseline is matched to Sunday', async () => {
      const weekdayAmount = (date: string): SessionOptions => ({ takings: new Date(`${date}T12:00:00Z`).getUTCDay() === 0 ? 1400 : 350 })
      const sessions = [...days([...HISTORY, ...YEAR_AGO], weekdayAmount), ...days(THIS_WEEK, weekdayAmount)]
      const result = await build(db({ sessions }))
      expect(metric(result, 'Against the 13-week weekday average')).toMatchObject({ value: 'in line', comparison: 'usual week £3,500' })
      expect(result.signals).toEqual([])
    })

    it('says not enough history when cashing up started recently, and checks no earlier days', async () => {
      const recent = eachIsoDateInRange('2026-09-04', '2026-09-17')
      const result = await build(db({ sessions: [...days(recent), ...days(THIS_WEEK)] }))
      expect(result.headline).toBe('7 of 7 trading days entered. Takings £3,500 over 7 entered days.')
      expect(byKey(result, 'cashing_up.missing.')).toEqual([])
      expect(byKey(result, 'cashing_up.week_')).toEqual([])
      expect(metric(result, 'Against the 13-week weekday average')).toMatchObject({ value: 'Not compared', comparison: 'not enough history yet' })
      expect(result.notes).toContain('Not enough history yet for the comparison with the 4-week weekday average: Friday, Saturday, Sunday, Monday, Tuesday, Wednesday and Thursday have fewer than 3 entered days in the previous 4 weeks.')
      expect(result.notes).toContain('Not enough history yet for the comparison with the same week last year: Friday, Saturday, Sunday, Monday, Tuesday, Wednesday and Thursday have no cash-up 52 weeks earlier.')
      expect(result.notes).toContain('Cashing up started on Fri 4 Sep, so earlier days are not checked.')
    })

    it('needs 3 entered days of a weekday in the 4 weeks but compares once it has them', async () => {
      const gapped = history().filter((row) => row.session_date !== '2026-09-11')
      const result = await build(db({ sessions: [...gapped, ...days(THIS_WEEK)] }))
      expect(metric(result, 'Against the 4-week weekday average')?.value).toBe('in line')
      // The gap itself is a missing trading day.
      expect(byKey(result, 'cashing_up.missing.')[0].text).toBe('1 trading day has gone more than 3 days without a cash-up: Fri 11 Sep.')
    })

    describe('last complete week', () => {
      const pendingWedThu = (options: SessionOptions = {}) => (date: string): SessionOptions | null =>
        (['2026-09-23', '2026-09-24'].includes(date) ? null : options)

      it('compares this week, not last week, when this week is complete', async () => {
        const sessions = [
          ...history().filter((row) => !LAST_WEEK.includes(row.session_date as string)),
          ...days(LAST_WEEK, { takings: 300 }),
          ...days(THIS_WEEK),
        ]
        const result = await build(db({ sessions }))
        expect(result.headline).toBe('7 of 7 trading days entered. Takings £3,500, in line with the usual week.')
        expect(metric(result, 'Against the 13-week weekday average')).toMatchObject({ value: 'in line' })
        expect(byKey(result, 'cashing_up.week_')).toEqual([])
        expect(JSON.stringify(result)).not.toContain('Last complete week')
      })

      it('raises the weekly decline for last week, naming the week, when this week is not complete', async () => {
        const sessions = [
          ...history().filter((row) => !LAST_WEEK.includes(row.session_date as string)),
          ...days(LAST_WEEK, { takings: 300 }),
          ...days(THIS_WEEK, pendingWedThu()),
        ]
        const result = await build(db({ sessions }))
        expect(byKey(result, 'cashing_up.week_below.')).toEqual([{
          key: 'cashing_up.week_below.site-1',
          rag: 'amber',
          kind: 'issue',
          emailSafe: true,
          text: 'Last complete week, Fri 11 to Thu 17 Sep: takings of £2,100 were 40% below the usual week of £3,500 (13-week weekday average).',
        }])
        expect(result.headline).toBe(
          '5 of 7 trading days entered; Wed 23 Sep and Thu 24 Sep not entered yet. Takings £2,500 over 5 entered days. '
          + 'Last complete week, Fri 11 to Thu 17 Sep: £2,100, down 40% on the usual week.',
        )
        expect(metric(result, LAST_WEEK_LABEL)).toEqual({ label: LAST_WEEK_LABEL, value: 'down 40%', comparison: 'took £2,100; usual week £3,500' })
        expectClean(result)
      })

      it('records the weekly win for last week and takes every baseline 7 days earlier', async () => {
        // Last week £800 a day. The week of 14 to 20 Aug is in last week's 4 weeks but not this
        // week's; the year-ago week before last is £300 a day, the year-ago week £500.
        const lowAugust = eachIsoDateInRange('2026-08-14', '2026-08-20')
        const yearAgoLast = eachIsoDateInRange('2025-09-12', '2025-09-18')
        const amount = (date: string): SessionOptions => {
          if (LAST_WEEK.includes(date)) return { takings: 800 }
          if (lowAugust.includes(date)) return { takings: 200 }
          if (yearAgoLast.includes(date)) return { takings: 300 }
          return {}
        }
        const sessions = [...days([...HISTORY, ...YEAR_AGO], amount), ...days(THIS_WEEK, pendingWedThu())]
        const result = await build(db({ sessions }))

        // Unshifted, the 13-week baseline would be £3,500 (it would hold last week itself) and the
        // 4-week £4,025; shifted it is 12 weeks of £500 and one of £200 from 12 Jun to 10 Sep.
        expect(metric(result, LAST_WEEK_LABEL)).toEqual({ label: LAST_WEEK_LABEL, value: 'up 68%', comparison: 'took £5,600; usual week £3,338' })
        expect(metric(result, 'Last complete week (Fri 11 to Thu 17 Sep) against the 4-week weekday average'))
          .toMatchObject({ value: 'up 88%', comparison: 'took £5,600; usual week £2,975' })
        expect(metric(result, 'Last complete week (Fri 11 to Thu 17 Sep) against the same week last year'))
          .toMatchObject({ value: 'up 167%', comparison: 'took £5,600; last year £2,100' })
        expect(byKey(result, 'cashing_up.week_above.')).toEqual([{
          key: 'cashing_up.week_above.site-1',
          rag: 'green',
          kind: 'win',
          emailSafe: true,
          text: 'Last complete week, Fri 11 to Thu 17 Sep: takings of £5,600 were 68% above the usual week of £3,338 (13-week weekday average).',
        }])
        expect(issues(result)).toEqual([])
        expect(result.headline).toContain('Last complete week, Fri 11 to Thu 17 Sep: £5,600, up 68% on the usual week.')
      })

      it('needs the year-ago day 364 days before last week, not before this week', async () => {
        const sessions = [
          ...history().filter((row) => row.session_date !== '2025-09-13'),
          ...days(THIS_WEEK, pendingWedThu()),
        ]
        const result = await build(db({ sessions }))
        expect(metric(result, 'Last complete week (Fri 11 to Thu 17 Sep) against the same week last year'))
          .toMatchObject({ value: 'Not compared', comparison: 'not enough history yet' })
        expect(result.notes).toContain('Not enough history yet for the comparison of the last complete week, Fri 11 to Thu 17 Sep, with the same week last year: Saturday has no cash-up 52 weeks earlier.')
        expect(metric(result, LAST_WEEK_LABEL)?.value).toBe('in line')
      })

      it('names a week that crosses a month end in full', async () => {
        // Friday 9 Oct 2026: last week is Fri 25 Sep to Thu 1 Oct.
        const now = new Date('2026-10-09T05:00:00Z')
        const past = eachIsoDateInRange('2026-06-19', '2026-10-01')
        const yearAgo = eachIsoDateInRange('2025-09-26', '2025-10-09')
        const week = eachIsoDateInRange('2026-10-02', '2026-10-06')
        const result = await build(db({ sessions: days([...past, ...yearAgo, ...week]) }), now)
        expect(result.headline).toContain('Last complete week, Fri 25 Sep to Thu 1 Oct: £3,500, in line with the usual week.')
        expect(metric(result, 'Last complete week (Fri 25 Sep to Thu 1 Oct) against the 13-week weekday average')?.value).toBe('in line')
      })
    })

    it('compares with the year-ago day only when that day was entered', async () => {
      const withoutYearAgo = history().filter((row) => row.session_date !== '2025-09-20')
      const result = await build(db({ sessions: [...withoutYearAgo, ...days(THIS_WEEK)] }))
      expect(metric(result, 'Against the same week last year')).toMatchObject({ value: 'Not compared', comparison: 'not enough history yet' })
      expect(result.notes).toContain('Not enough history yet for the comparison with the same week last year: Saturday has no cash-up 52 weeks earlier.')
      expect(metric(result, 'Against the 13-week weekday average')?.value).toBe('in line')
    })
  })

  describe('day anomalies', () => {
    it('shows an unusual day even when the week is incomplete, without a weekly claim', async () => {
      const sessions = [
        ...history(),
        ...days(THIS_WEEK, (date) => {
          if (date === '2026-09-21') return null
          if (date === '2026-09-19') return { takings: 1000 }
          if (date === '2026-09-20') return { takings: 100 }
          return {}
        }),
      ]
      const result = await build(db({ sessions }))
      expect(byKey(result, 'cashing_up.day_high.')).toEqual([{
        key: 'cashing_up.day_high.site-1.2026-09-19',
        rag: 'green',
        kind: 'info',
        emailSafe: true,
        text: 'Sat 19 Sep took £1,000.00, 100% above the usual Saturday of £500.00.',
      }])
      expect(byKey(result, 'cashing_up.day_low.')).toEqual([expect.objectContaining({
        key: 'cashing_up.day_low.site-1.2026-09-20',
        rag: 'amber',
        kind: 'info',
        text: 'Sun 20 Sep took £100.00, 80% below the usual Sunday of £500.00.',
      })])
      expect(byKey(result, 'cashing_up.week_')).toEqual([])
      expect(byKey(result, 'cashing_up.missing.')).toHaveLength(1)
    })

    it('needs 8 entered days of the weekday and a £150 difference', async () => {
      const sparse = history().filter((row) => {
        const date = row.session_date as string
        // Keep only 7 of the 13 Saturdays.
        return !(new Date(`${date}T12:00:00Z`).getUTCDay() === 6 && date < '2026-07-31' && date >= '2026-06-19')
      })
      const sessions = [...sparse, ...days(THIS_WEEK, (date) => {
        if (date === '2026-09-19') return { takings: 1000 }
        if (date === '2026-09-22') return { takings: 620 }
        return {}
      })]
      const result = await build(db({ sessions }))
      expect(byKey(result, 'cashing_up.day_high.site-1.2026-09-19')).toEqual([])
      // Tuesday is 24% above but only £120, under the £150 floor.
      expect(byKey(result, 'cashing_up.day_high.site-1.2026-09-22')).toEqual([])
    })
  })

  describe('variances', () => {
    it('raises red for a variance of £50 or more, with a record action on that day', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, (date) => (date === '2026-09-23' ? { variance: -62.4 } : {}))]
      const result = await build(db({ sessions }))
      const [red] = byKey(result, 'cashing_up.variance.')
      expect(red).toEqual({
        key: 'cashing_up.variance.s-site-1-2026-09-23',
        entity: 'cashup:s-site-1-2026-09-23',
        rag: 'red',
        kind: 'issue',
        emailSafe: true,
        text: 'Wed 23 Sep: the cash-up was £62.40 short.',
        action: {
          text: 'Check the £62.40 cash shortfall on Wed 23 Sep',
          href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-23`,
          target: 'record',
          impact: 'money',
        },
      })
      expect(result.headline).toBe('7 of 7 trading days entered. Takings £3,500, in line with the usual week. 1 variance of £50 or more entered this week.')
      // A lone red variance is already its own action, so the rate rule stays quiet.
      expect(byKey(result, 'cashing_up.variance_rate.')).toEqual([])
      expect(result.lists[2].items).toEqual([{ text: 'Wed 23 Sep: £62.40 short', href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-23`, rag: 'red' }])
    })

    it('raises amber when £10 variances run above the 13-week rate, listing each with date and amount', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, (date) => {
        if (date === '2026-09-19') return { variance: 12.5 }
        if (date === '2026-09-22') return { variance: -15 }
        return {}
      })]
      const result = await build(db({ sessions }))
      const [rate] = byKey(result, 'cashing_up.variance_rate.')
      expect(rate).toEqual({
        key: 'cashing_up.variance_rate.site-1',
        rag: 'amber',
        kind: 'issue',
        emailSafe: true,
        text: '2 cash-up variances of £10 or more entered this week, more than usual (none in the previous 13 weeks): Sat 19 Sep: £12.50 over; Tue 22 Sep: £15.00 short.',
        action: {
          text: 'Review 2 cash-up variances of £10 or more entered this week',
          href: `${TEST_APP_URL}/cashing-up/weekly?week=2026-09-21`,
          target: 'list',
          members: ['Sat 19 Sep: £12.50 over', 'Tue 22 Sep: £15.00 short'],
          impact: 'money',
        },
      })
      expect(metric(result, 'Variances of £10 or more')).toEqual({
        label: 'Variances of £10 or more',
        value: '2',
        comparison: 'largest £15.00 short on Tue 22 Sep; none in the previous 13 weeks',
      })
      expect(byKey(result, 'cashing_up.variance.')).toEqual([])
    })

    it('stays quiet when this week matches the usual rate of variances', async () => {
      // Three £10+ variances a week in the history (Sun, Tue, Fri), two this week (Tue, Fri).
      const variance = (weekdays: number[]) => (date: string): SessionOptions =>
        (weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? { variance: -11 } : {})
      const sessions = [...days([...HISTORY, ...YEAR_AGO], variance([0, 2, 5])), ...days(THIS_WEEK, variance([2, 5]))]
      const result = await build(db({ sessions }))
      expect(byKey(result, 'cashing_up.variance_rate.')).toEqual([])
      expect(metric(result, 'Variances of £10 or more')?.comparison).toBe('largest £11.00 short on Fri 18 Sep; about 3 a week over the previous 13 weeks')
    })

    it('does not judge the rate without enough history', async () => {
      const recent = eachIsoDateInRange('2026-09-04', '2026-09-17')
      const sessions = [...days(recent), ...days(THIS_WEEK, (date) => (date === '2026-09-19' ? { variance: 12 } : {}))]
      const result = await build(db({ sessions }))
      expect(byKey(result, 'cashing_up.variance_rate.')).toEqual([])
      expect(result.notes).toContain('Not enough history yet to judge the usual rate of cash-up variances.')
    })

    describe('entered late', () => {
      // Cash-ups are entered one to eleven days after the day they cover, so the variance
      // rules follow the day a cash-up was entered, not the day it covers.
      const FRI_2_OCT = new Date('2026-10-02T05:00:00Z')
      const FRI_9_OCT = new Date('2026-10-09T05:00:00Z')
      const lateThursday = (createdAt: string): Row => session('2026-09-24', { variance: -60, createdAt })
      const before = [...history(), ...days(THIS_WEEK.filter((date) => date !== '2026-09-24'))]

      it('reports a Thursday shortfall entered on Saturday in the next Friday report, and only that one', async () => {
        // Friday 25 Sep: Thursday is not entered yet, so there is nothing to report.
        const first = await build(db({ sessions: before }))
        expect(byKey(first, 'cashing_up.variance.')).toEqual([])
        expect(first.lists[0].items[6].text).toBe('Thu 24 Sep: not entered yet.')

        // Saturday 26 Sep: the Thursday cash-up is entered £60 short.
        const sessions = [...before, lateThursday('2026-09-26T11:00:00Z')]
        const second = await build(db({ sessions }), FRI_2_OCT)
        expect(byKey(second, 'cashing_up.variance.')).toEqual([{
          key: 'cashing_up.variance.s-site-1-2026-09-24',
          entity: 'cashup:s-site-1-2026-09-24',
          rag: 'red',
          kind: 'issue',
          emailSafe: true,
          text: 'Thu 24 Sep (entered Sat 26 Sep): the cash-up was £60.00 short.',
          action: {
            text: 'Check the £60.00 cash shortfall on Thu 24 Sep',
            href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-24`,
            target: 'record',
            impact: 'money',
          },
        }])
        expect(second.lists[2].items).toEqual([{
          text: 'Thu 24 Sep (entered Sat 26 Sep): £60.00 short',
          href: `${TEST_APP_URL}/cashing-up/daily?date=2026-09-24`,
          rag: 'red',
        }])
        expect(second.headline).toContain('1 variance of £50 or more entered this week.')

        // Friday 9 Oct: already reported, so not again.
        const third = await build(db({ sessions }), FRI_9_OCT)
        expect(byKey(third, 'cashing_up.variance.')).toEqual([])
        expect(third.lists[2].items).toEqual([])
        expectClean(second)
      })

      it('reports a cash-up entered on its own day in that week, not the week after', async () => {
        const sessions = [...before, lateThursday('2026-09-24T21:00:00Z')]
        const first = await build(db({ sessions }))
        expect(byKey(first, 'cashing_up.variance.').map((signal) => signal.text)).toEqual(['Thu 24 Sep: the cash-up was £60.00 short.'])
        const second = await build(db({ sessions }), FRI_2_OCT)
        expect(byKey(second, 'cashing_up.variance.')).toEqual([])
      })

      it('holds a cash-up entered after midnight, before the Friday run, for the next report', async () => {
        // 01:10 London on Friday 25 Sep: after this week ended, before the 06:00 run.
        const sessions = [...before, lateThursday('2026-09-25T00:10:00Z')]
        const first = await build(db({ sessions }))
        expect(byKey(first, 'cashing_up.variance.')).toEqual([])
        // The day itself still shows its shortfall on the page.
        expect(first.lists[0].items[6]).toMatchObject({ text: 'Thu 24 Sep: £500.00, cash £150.00, £60.00 short.', rag: 'red' })
        const second = await build(db({ sessions }), FRI_2_OCT)
        expect(byKey(second, 'cashing_up.variance.').map((signal) => signal.text)).toEqual(['Thu 24 Sep (entered Fri 25 Sep): the cash-up was £60.00 short.'])
      })

      it('counts a late cash-up in this week\'s variance rate and not in the 13-week rate', async () => {
        const sessions = [
          ...history().filter((row) => row.session_date !== '2026-09-17'),
          session('2026-09-17', { variance: -15, createdAt: '2026-09-21T10:00:00Z' }),
          ...days(THIS_WEEK, (date) => (date === '2026-09-19' ? { variance: 12.5 } : {})),
        ]
        const result = await build(db({ sessions }))
        const [rate] = byKey(result, 'cashing_up.variance_rate.')
        expect(rate.text).toBe('2 cash-up variances of £10 or more entered this week, more than usual (none in the previous 13 weeks): Thu 17 Sep (entered Mon 21 Sep): £15.00 short; Sat 19 Sep: £12.50 over.')
        expect(rate.action).toMatchObject({
          text: 'Review 2 cash-up variances of £10 or more entered this week',
          members: ['Thu 17 Sep (entered Mon 21 Sep): £15.00 short', 'Sat 19 Sep: £12.50 over'],
        })
        expect(metric(result, 'Variances of £10 or more')).toEqual({
          label: 'Variances of £10 or more',
          value: '2',
          comparison: 'largest £15.00 short on Thu 17 Sep; none in the previous 13 weeks',
        })
        expectClean(result)
      })

      it('never reports an old cash-up entered this week, such as an import of past days', async () => {
        const sessions = [
          ...history().filter((row) => row.session_date !== '2025-09-20'),
          session('2025-09-20', { variance: -80, createdAt: '2026-09-21T10:00:00Z' }),
          session('2026-05-01', { variance: -90, createdAt: '2026-09-21T10:00:00Z' }),
          ...days(THIS_WEEK),
        ]
        const result = await build(db({ sessions }))
        expect(byKey(result, 'cashing_up.variance')).toEqual([])
        expect(metric(result, 'Variances of £10 or more')?.value).toBe('0')
      })

      it('uses the day itself when a cash-up has no creation time', async () => {
        const sessions = [...history(), ...days(THIS_WEEK, (date) => (date === '2026-09-23' ? { variance: -62.4, createdAt: null } : {}))]
        const result = await build(db({ sessions }))
        expect(byKey(result, 'cashing_up.variance.').map((signal) => signal.text)).toEqual(['Wed 23 Sep: the cash-up was £62.40 short.'])
      })
    })

    it('reports the cash share of takings against the 13-week average', async () => {
      const sessions = [...history(), ...days(THIS_WEEK, { takings: 500, cash: 100 })]
      const result = await build(db({ sessions }))
      expect(metric(result, 'Cash share of takings')).toEqual({ label: 'Cash share of takings', value: '20%', comparison: '13-week average 30%' })
    })
  })

  describe('sites', () => {
    it('reports only the site that cashes up and says which', async () => {
      const result = await build(db({
        sites: [SITE, { id: 'site-2', name: 'Old Test Site' }],
        sessions: [...history(), ...days(THIS_WEEK)],
      }))
      expect(result.headline).toBe('7 of 7 trading days entered. Takings £3,500, in line with the usual week.')
      expect(result.notes).toEqual(['Figures are for The Anchor; 1 other site had no cash-ups in the last 14 weeks.'])
    })

    it('reports each active site separately, named, with site links', async () => {
      const second = [...days([...HISTORY, ...YEAR_AGO], { site: 'site-2' }), ...days(THIS_WEEK, (date) => (date === '2026-09-21' ? null : { site: 'site-2' }))]
      const result = await build(db({
        sites: [SITE, { id: 'site-2', name: 'The Barn' }],
        sessions: [...history(), ...days(THIS_WEEK), ...second],
      }))
      expect(result.headline).toBe(
        'The Anchor: 7 of 7 trading days entered. Takings £3,500, in line with the usual week. '
        + 'The Barn: 6 of 7 trading days entered; missing Mon 21 Sep. Takings £3,000 over 6 entered days. '
        + 'Last complete week, Fri 11 to Thu 17 Sep: £3,500, in line with the usual week.',
      )
      const [missing] = byKey(result, 'cashing_up.missing.')
      expect(missing.key).toBe('cashing_up.missing.site-2')
      expect(missing.text).toBe('The Barn: 1 trading day has gone more than 3 days without a cash-up: Mon 21 Sep.')
      expect(metric(result, `The Barn: ${LAST_WEEK_LABEL}`)?.value).toBe('in line')
      expect(result.notes).toContain(`The Barn: ${LAST_WEEK_NOTE}1 trading day this week is missing.`)
      expect(missing.action?.text).toBe('Enter the cash-up for Mon 21 Sep (The Barn)')
      expect(missing.action?.href).toBe(`${TEST_APP_URL}/cashing-up/daily?date=2026-09-21&siteId=site-2`)
      expect(result.metrics.map((item) => item.label).slice(0, 2)).toEqual(['The Anchor: Cash-ups entered', 'The Anchor: Takings'])
    })

    it('shows the gaps for a site that has stopped cashing up', async () => {
      const result = await build(db({ sessions: [session('2026-01-10')] }))
      const [missing] = byKey(result, 'cashing_up.missing.')
      expect(missing.rag).toBe('red')
      expect(missing.text).toBe('14 trading days have gone more than 3 days without a cash-up: Tue 8 Sep, Wed 9 Sep, Thu 10 Sep, Fri 11 Sep, Sat 12 Sep and 9 more.')
      expect(missing.action?.members).toHaveLength(11)
      expect(missing.action?.members?.[10]).toBe('and 4 more days')
      expect(result.notes).toContain('Performance comparison not made: 14 trading days across this week and last week are missing or not entered yet.')
    })

    it('says so when a site has never cashed up', async () => {
      const result = await build(db({ sessions: [] }))
      expect(result.headline).toBe('No cash-ups have been entered yet.')
      expect(result.signals).toEqual([])
    })
  })

  describe('reads', () => {
    it('fails loudly when cash-ups cannot be read, so the section is not checked', async () => {
      await expect(build(db({ sessions: history() }).fail('cashup_sessions'))).rejects.toThrow('Fixture failure')
    })

    it('fails loudly when special hours cannot be read rather than assuming none', async () => {
      await expect(build(db({ sessions: history() }).fail('special_hours'))).rejects.toThrow('Fixture failure')
    })

    it('keeps its query count modest', async () => {
      const fake = db({ sessions: [...history(), ...days(THIS_WEEK)] })
      await build(fake)
      expect(fake.calls.length).toBeLessThanOrEqual(8)
    })

    it('keeps whole London days across the October clock change', async () => {
      // Friday 30 Oct 2026 06:00 GMT: this week is Fri 23 to Thu 29 Oct, across 25 Oct.
      const now = new Date('2026-10-30T06:00:00Z')
      const week = eachIsoDateInRange('2026-10-23', '2026-10-29')
      const past = eachIsoDateInRange('2026-07-24', '2026-10-22')
      const yearAgo = eachIsoDateInRange('2025-10-24', '2025-10-30')
      const result = await build(db({ sessions: [...days([...past, ...yearAgo]), ...days(week)] }), now)
      expect(result.headline).toBe('7 of 7 trading days entered. Takings £3,500, in line with the usual week.')
      expect(result.lists[0].items.map((item) => item.text.slice(0, 10))).toEqual([
        'Fri 23 Oct', 'Sat 24 Oct', 'Sun 25 Oct', 'Mon 26 Oct', 'Tue 27 Oct', 'Wed 28 Oct', 'Thu 29 Oct',
      ])
    })
  })

  it('keeps every sentence email safe: no person, no notes, no staff names, even on a busy week', async () => {
    const sessions = [
      ...history(),
      ...days(THIS_WEEK, (date) => {
        if (['2026-09-20', '2026-09-21', '2026-09-22'].includes(date)) return date === '2026-09-21' ? { status: 'draft' } : null
        if (date === '2026-09-18') return { variance: -75 }
        if (date === '2026-09-19') return { takings: 1200, variance: 12 }
        if (date === '2026-09-23') return { variance: 20 }
        return {}
      }),
    ]
    const result = await build(db({ sessions }))
    expect(result.signals.map((signal) => signal.key.split('.').slice(0, 2).join('.')).sort()).toEqual([
      'cashing_up.day_high',
      'cashing_up.missing',
      'cashing_up.variance',
      'cashing_up.variance_rate',
    ])
    expect(result.signals.every((signal) => signal.emailSafe)).toBe(true)
    for (const signal of result.signals) {
      expect(signal.text).not.toMatch(/\n/)
      expect(signal.action?.text ?? '').not.toContain(PERSON)
      for (const member of signal.action?.members ?? []) expect(member).not.toContain(PERSON)
    }
    expect(result.headline).not.toMatch(/\n/)
    expectClean(result)
  })

  it('gives the section its status through the engine', async () => {
    // Three days past the entry window (Sat 19 to Mon 21 Sep) and one inside it (Wed 23 Sep).
    const gaps = ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-23']
    const fake = db({ sessions: [...history(), ...days(THIS_WEEK, (date) => (gaps.includes(date) ? null : {}))] })
    const report = await buildInsightsReport({
      createDb: () => fake.asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: TEST_APP_URL,
      sections: [cashingUpSection],
    })
    const [section] = report.sections
    expect(section.status).toBe('red')
    expect(report.actions[0]).toMatchObject({ sectionKey: 'cashing_up', rag: 'red', text: 'Enter 3 missing cash-ups, the earliest Sat 19 Sep' })
  })

  it('leaves the section green through the engine when only days inside the entry window are not entered', async () => {
    const fake = db({ sessions: [...history(), ...days(THIS_WEEK, (date) => (['2026-09-22', '2026-09-23', '2026-09-24'].includes(date) ? null : {}))] })
    const report = await buildInsightsReport({
      createDb: () => fake.asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: TEST_APP_URL,
      sections: [cashingUpSection],
    })
    expect(report.sections[0].status).toBe('green')
    expect(report.actions).toEqual([])
  })
})

describe('cash-up trading days', () => {
  it('finds missing dates for the missing-cash-ups page, counting drafts and voided cash-ups as entered', async () => {
    // As before the move: a draft is opened rather than started again, and a voided day can
    // never be entered again (one cash-up per site and date, voided or not), so neither is listed.
    const fake = db({
      sessions: [
        session('2026-09-20'),
        session('2026-09-21', { status: 'draft' }),
        session('2026-09-22', { voided: true }),
        session('2026-09-23', { site: 'site-2' }),
      ],
    })
    const dates = await findMissingCashupDates(fake.asDb(), {
      siteId: SITE.id,
      from: '2026-09-20',
      to: '2026-09-24',
      now: new Date('2026-09-25T05:00:00Z'),
    })
    expect(dates).toEqual(['2026-09-23', '2026-09-24'])
  })

  it('counts a date no published hours cover as closed', async () => {
    const fake = db({ sessions: [] })
    fake.tables.business_hours_versions = [{ id: 'v1', effective_from: '2026-09-22', status: 'published' }]
    const trading = await loadTradingDays(fake.asDb(), ['2026-09-21', '2026-09-22'])
    expect(trading.get('2026-09-21')?.open).toBe(false)
    expect(trading.get('2026-09-22')?.open).toBe(true)
  })

  it('does not call yesterday missing while an after-midnight close keeps it trading', async () => {
    const fake = db({
      sessions: [],
      special: [{ id: 'nye', date: '2026-12-31', opens: '12:00:00', closes: '01:00:00', is_closed: false }],
    })
    const halfPastMidnight = new Date('2027-01-01T00:30:00Z')
    const trading = await loadTradingDays(fake.asDb(), ['2026-12-31'])
    expect(isYesterdayStillTrading(halfPastMidnight, trading.get('2026-12-31'))).toBe(true)
    expect(isYesterdayStillTrading(new Date('2027-01-01T02:00:00Z'), trading.get('2026-12-31'))).toBe(false)
    const dates = await findMissingCashupDates(fake.asDb(), { siteId: SITE.id, from: '2026-12-30', to: '2026-12-31', now: halfPastMidnight })
    expect(dates).toEqual(['2026-12-30'])
  })
})
