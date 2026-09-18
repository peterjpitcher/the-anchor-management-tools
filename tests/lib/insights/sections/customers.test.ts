import { describe, expect, it } from 'vitest'
import { buildCustomersSection, customersSection } from '@/lib/insights/sections/customers'
import { addDays } from '@/lib/insights/windows'
import type { SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { makeContext } from '../helpers/context'

// Default report instant: Friday 25 Sep 2026, 06:00 London.
//   this week          18 Sep to 24 Sep
//   last week          11 Sep to 17 Sep
//   previous 4 weeks   21 Aug to 17 Sep
//   previous 13 weeks  19 Jun to 17 Sep
const HISTORY_ANCHOR = '2025-03-29T12:00:00.000Z'
const LONG_DASH = String.fromCharCode(0x2014)
const PERSONAL = ['Jane', 'Privateperson', 'jane.private@example.test', '07700900123']

type Row = Record<string, unknown>

let sequence = 0
function record(instant: string): Row {
  sequence += 1
  return {
    id: `cust-${String(sequence).padStart(6, '0')}`,
    created_at: new Date(instant).toISOString(),
    first_name: 'Jane',
    last_name: 'Privateperson',
    email: 'jane.private@example.test',
    mobile_e164: '07700900123',
  }
}

function onDay(date: string, count: number): Row[] {
  return Array.from({ length: count }, () => record(`${date}T12:00:00Z`))
}

/** `perDay` records on every date from start to end inclusive. */
function everyDay(start: string, end: string, perDay: number): Row[] {
  const rows: Row[] = []
  for (let date = start; date <= end; date = addDays(date, 1)) rows.push(...onDay(date, perDay))
  return rows
}

function db(rows: Row[]): FakeDb {
  return new FakeDb({ customers: rows })
}

async function build(rows: Row[], now?: Date): Promise<SectionBuildResult> {
  return buildCustomersSection(makeContext(db(rows), now))
}

function metric(result: SectionBuildResult, label: string): { value: string; comparison?: string } {
  const found = result.metrics.find((m) => m.label === label)
  if (!found) throw new Error(`No metric ${label}`)
  return found
}

function allText(result: SectionBuildResult): string {
  return JSON.stringify(result)
}

function expectCleanText(result: SectionBuildResult): void {
  const text = allText(result)
  for (const bad of ['undefined', 'NaN', 'Invalid Date', LONG_DASH, '!']) expect(text).not.toContain(bad)
  for (const personal of PERSONAL) expect(text).not.toContain(personal)
}

/** Steady baseline: `perDay` every day of the previous 13 weeks, plus an old record for history. */
function baseline(perDay: number): Row[] {
  return [record(HISTORY_ANCHOR), ...everyDay('2026-06-19', '2026-09-17', perDay)]
}

describe('customers section', () => {
  it('is registered as the customers section linking to /customers', () => {
    expect(customersSection).toMatchObject({ key: 'customers', title: 'Customers', path: '/customers' })
    expect(customersSection.build).toBe(buildCustomersSection)
  })

  it('reports a steady week with every window, no signals and the fixed note', async () => {
    const result = await build([...baseline(3), ...everyDay('2026-09-18', '2026-09-24', 3)])

    expect(result.headline).toBe('21 new customer records this week, in line with the 4-week average.')
    expect(result.signals).toEqual([])
    expect(result.lists).toEqual([])
    expect(result.metrics.map((m) => m.label)).toEqual([
      'New records, 7 days',
      '4-week average',
      '13-week average',
      'Trend',
      'New records, 14 days',
      'New records, 4 weeks',
      'New records, 13 weeks',
    ])
    expect(metric(result, 'New records, 7 days')).toEqual({ label: 'New records, 7 days', value: '21', comparison: 'in line with last week (21)' })
    expect(metric(result, '4-week average')).toMatchObject({ value: '21 a week', comparison: 'this week: in line with the 4-week average' })
    expect(metric(result, '13-week average')).toMatchObject({ value: '21 a week', comparison: 'this week: in line with the 13-week average' })
    expect(metric(result, 'Trend')).toMatchObject({ value: 'Steady', comparison: 'New customer records are steady over 13 weeks.' })
    expect(metric(result, 'New records, 14 days').value).toBe('42')
    expect(metric(result, 'New records, 4 weeks').value).toBe('84')
    expect(metric(result, 'New records, 13 weeks').value).toBe('273')
    expect(result.notes).toEqual(['Counts new customer records, including imports, walk-ins and texts to new numbers.'])
    expectCleanText(result)
  })

  it('reads with two queries: the first record and one paged read', async () => {
    const fake = db([...baseline(1), ...onDay('2026-09-20', 2)])
    await buildCustomersSection(makeContext(fake))
    expect(fake.calls).toEqual([
      { table: 'customers', kind: 'select' },
      { table: 'customers', kind: 'select' },
    ])
  })

  it('raises a win when this week is at least 20% and 5 records above the 4-week average', async () => {
    const result = await build([...baseline(2), ...everyDay('2026-09-18', '2026-09-24', 3)])

    expect(result.signals).toEqual([{
      key: 'customers.growth.week',
      rag: 'green',
      kind: 'win',
      text: 'New customer records are up 50% on the 4-week average: 21 this week against 14 a week.',
      emailSafe: true,
    }])
    expect(result.headline).toBe('21 new customer records this week, up 50% on the 4-week average.')
    expect(metric(result, 'New records, 7 days').comparison).toBe('up 50% on last week (14)')
    expectCleanText(result)
  })

  it('treats exactly 20% above as a win and just under as steady', async () => {
    // 25 a week over the previous 4 weeks: 100 records across 21 Aug to 17 Sep.
    const fourWeeks = [...everyDay('2026-08-21', '2026-09-13', 3), ...onDay('2026-09-14', 16), ...everyDay('2026-09-15', '2026-09-17', 4)]
    const history = [record(HISTORY_ANCHOR), ...fourWeeks]
    expect(fourWeeks).toHaveLength(100)

    // Spread over the week so no single day counts as a spike.
    const week = everyDay('2026-09-18', '2026-09-24', 4)
    const atThreshold = await build([...history, ...week, ...onDay('2026-09-18', 2)])
    expect(atThreshold.signals.map((s) => s.key)).toEqual(['customers.growth.week'])
    expect(atThreshold.signals[0].text).toBe('New customer records are up 20% on the 4-week average: 30 this week against 25 a week.')

    const justUnder = await build([...history, ...week, ...onDay('2026-09-18', 1)])
    expect(justUnder.signals).toEqual([])
    expect(justUnder.headline).toBe('29 new customer records this week, in line with the 4-week average.')
  })

  it('needs the floor of 5 as well as 20%, so tiny numbers stay steady', async () => {
    // 1 a week before, 4 this week: +300% but only 3 more records.
    const history = [record(HISTORY_ANCHOR), ...['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14'].flatMap((d) => onDay(d, 1))]
    const result = await build([...history, ...onDay('2026-09-21', 4)])
    expect(result.signals).toEqual([])
    expect(result.headline).toBe('4 new customer records this week, in line with the 4-week average.')

    const fall = await build([...history.slice(0, 1), ...['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14'].flatMap((d) => onDay(d, 4))])
    expect(fall.signals).toEqual([])
    expect(fall.headline).toBe('No new customer records this week, in line with the 4-week average.')
  })

  it('raises an amber issue with no action when this week is at least 20% below the 4-week average', async () => {
    const result = await build([...baseline(3), ...everyDay('2026-09-18', '2026-09-24', 1)])

    expect(result.signals).toEqual([{
      key: 'customers.decline.week',
      rag: 'amber',
      kind: 'issue',
      text: 'New customer records are down 67% on the 4-week average: 7 this week against 21 a week.',
      emailSafe: true,
    }])
    expect(result.signals.some((s) => s.rag === 'red')).toBe(false)
    expect(result.headline).toBe('7 new customer records this week, down 67% on the 4-week average.')
    expectCleanText(result)
  })

  it('flags a day at 3 times the 13-week daily average and at least 20 records, and claims no win from it', async () => {
    // 3 a day as usual, plus 22 more on Tue 22 Sep. Setting the spike aside, the week is normal.
    const result = await build([...baseline(3), ...everyDay('2026-09-18', '2026-09-24', 3), ...onDay('2026-09-22', 22)])

    expect(result.signals).toEqual([{
      key: 'customers.spike.2026-09-22',
      rag: 'amber',
      kind: 'issue',
      text: 'Unusual spike on Tue 22 Sep: 25 new records against 3 a day usually. Check for an import.',
      emailSafe: true,
      action: {
        text: 'Check the 25 customer records added on Tue 22 Sep for an import or duplicates',
        href: 'https://management.example.test/customers',
        target: 'list',
        impact: 'housekeeping',
      },
    }])
    expect(result.headline).toBe('43 new customer records this week, with an unusual spike on Tue 22 Sep; setting it aside, in line with the 4-week average.')
    // Raw counts stay raw; comparisons set the spike aside and say so.
    expect(metric(result, 'New records, 7 days')).toMatchObject({ value: '43', comparison: 'in line with last week (21), setting aside an unusual day' })
    expect(metric(result, '4-week average')).toMatchObject({ value: '21 a week', comparison: 'this week: in line with the 4-week average, setting aside an unusual day' })
    expect(metric(result, '13-week average')).toMatchObject({ value: '21 a week', comparison: 'this week: in line with the 13-week average, setting aside an unusual day' })
    expect(metric(result, 'Trend')).toMatchObject({ value: 'Steady', comparison: 'New customer records are steady over 13 weeks.' })
    expect(metric(result, 'New records, 14 days').value).toBe('64')
    expect(result.notes).toContain(
      'Averages, comparisons and the trend count an unusual day, most likely an import, at the usual 3 a day: Tue 22 Sep (25 records). The 7-day to 13-week totals count every record.',
    )
    expectCleanText(result)
  })

  it('still claims the win in a spike week when the other days are genuinely up', async () => {
    // Usually 2 a day (14 a week). This week 3 a day, plus 25 more on Tue 22 Sep.
    const result = await build([...baseline(2), ...everyDay('2026-09-18', '2026-09-24', 3), ...onDay('2026-09-22', 25)])

    expect(result.signals.map((s) => s.key)).toEqual(['customers.growth.week', 'customers.spike.2026-09-22'])
    expect(result.signals[0]).toEqual({
      key: 'customers.growth.week',
      rag: 'green',
      kind: 'win',
      text: 'New customer records are up 43% on the 4-week average, setting aside an unusual day: about 20 this week against 14 a week.',
      emailSafe: true,
    })
    expect(result.signals[1].text).toBe('Unusual spike on Tue 22 Sep: 28 new records against 2 a day usually. Check for an import.')
    expect(result.headline).toBe('46 new customer records this week, with an unusual spike on Tue 22 Sep; setting it aside, up 43% on the 4-week average.')
    expect(metric(result, 'New records, 7 days').value).toBe('46')
    expectCleanText(result)
  })

  it('raises no false decline in the weeks after an import in the 4-week baseline', async () => {
    // Mirrors 20 Aug 2025 in production: about 1 a day, then one import of 54 on Tue 1 Sep 2026.
    const rows = [...baseline(1), ...onDay('2026-09-01', 54), ...everyDay('2026-09-18', '2026-09-24', 1)]
    const result = await build(rows)

    // Raw, this would be 7 against 20.5 a week: "down 66%" and a growing trend.
    expect(result.signals).toEqual([])
    expect(result.headline).toBe('7 new customer records this week, in line with the 4-week average, setting aside an unusual earlier day.')
    expect(metric(result, '4-week average')).toMatchObject({ value: '7.1 a week', comparison: 'this week: in line with the 4-week average, setting aside an unusual day' })
    expect(metric(result, '13-week average')).toMatchObject({ value: '7 a week', comparison: 'this week: in line with the 13-week average, setting aside an unusual day' })
    expect(metric(result, 'Trend')).toMatchObject({ value: 'Steady', comparison: 'New customer records are steady over 13 weeks, setting aside an unusual day.' })
    // Last week had no import, so its comparison is untouched.
    expect(metric(result, 'New records, 7 days').comparison).toBe('in line with last week (7)')
    // Raw totals still count the import.
    expect(metric(result, 'New records, 4 weeks').value).toBe('82')
    expect(metric(result, 'New records, 13 weeks').value).toBe('145')
    expect(result.notes).toContain(
      'Averages, comparisons and the trend count an unusual day, most likely an import, at the usual 1.6 a day: Tue 1 Sep (55 records). The 7-day to 13-week totals count every record.',
    )
    expectCleanText(result)
  })

  it('sets an import aside in the week after it, both against last week and the 4-week average', async () => {
    // An import of 49 on Tue 15 Sep (last week), then an ordinary week.
    const result = await build([...baseline(1), ...onDay('2026-09-15', 49), ...everyDay('2026-09-18', '2026-09-24', 1)])
    expect(result.signals).toEqual([])
    expect(metric(result, 'New records, 7 days').comparison).toBe('in line with last week (56), setting aside an unusual day')
    expect(result.headline).toBe('7 new customer records this week, in line with the 4-week average, setting aside an unusual earlier day.')
  })

  it('keeps an import older than 4 weeks from making the trend look like a decline', async () => {
    // 3 a day for 13 weeks, plus an import of 100 on Wed 15 Jul (inside the 13-week baseline only).
    const result = await build([...baseline(3), ...onDay('2026-07-15', 100), ...everyDay('2026-09-18', '2026-09-24', 3)])

    // Raw, the 13-week average would be 28.7 a week: "declining" and "down 27%".
    expect(result.signals).toEqual([])
    expect(metric(result, 'Trend')).toMatchObject({ value: 'Steady', comparison: 'New customer records are steady over 13 weeks, setting aside an unusual day.' })
    expect(metric(result, '13-week average')).toMatchObject({ value: '21.1 a week', comparison: 'this week: in line with the 13-week average, setting aside an unusual day' })
    // Not in the 4-week baseline, so the headline and 4-week figure are untouched.
    expect(result.headline).toBe('21 new customer records this week, in line with the 4-week average.')
    expect(metric(result, '4-week average')).toMatchObject({ value: '21 a week', comparison: 'this week: in line with the 4-week average' })
  })

  it('raises a real decline when an import week has almost nothing else in it', async () => {
    // Usually 1 a day. This week only an import of 25 on Tue 22 Sep and nothing else.
    const result = await build([...baseline(1), ...onDay('2026-09-22', 25)])
    expect(result.signals.map((s) => s.key)).toEqual(['customers.decline.week', 'customers.spike.2026-09-22'])
    expect(result.signals[0].text).toBe(
      'New customer records are down 86% on the 4-week average, setting aside an unusual day: about 1 this week against 7 a week.',
    )
    expect(result.headline).toBe('25 new customer records this week, with an unusual spike on Tue 22 Sep; setting it aside, down 86% on the 4-week average.')
    expectCleanText(result)
  })

  it('says every record came in the spike when there were none before', async () => {
    const result = await build([record(HISTORY_ANCHOR), ...onDay('2026-09-22', 25)])
    expect(result.signals.map((s) => s.key)).toEqual(['customers.spike.2026-09-22'])
    expect(result.headline).toBe('25 new customer records this week, all in an unusual spike on Tue 22 Sep, after none in the 4 weeks before.')
    expectCleanText(result)
  })

  it('calls a spike week new activity when the other days are the first in 4 weeks', async () => {
    // 7 records on Wed 1 Jul (13-week baseline only), none in the 4 weeks before this week.
    const rows = [record(HISTORY_ANCHOR), ...onDay('2026-07-01', 7), ...everyDay('2026-09-18', '2026-09-23', 1), ...onDay('2026-09-24', 25)]
    const result = await build(rows)
    expect(result.signals.map((s) => s.key)).toEqual(['customers.growth.week', 'customers.spike.2026-09-24'])
    expect(result.signals[0].text).toBe('About 6 new customer records this week after none in the 4 weeks before, setting aside an unusual day.')
    expect(result.headline).toBe('31 new customer records this week, with an unusual spike on Thu 24 Sep; setting it aside, new activity after none in the 4 weeks before.')
    expectCleanText(result)
  })

  it('says unusual days, not it, when this week and the 4-week baseline both hold one', async () => {
    const result = await build([
      ...baseline(3), ...onDay('2026-09-01', 40), ...everyDay('2026-09-18', '2026-09-24', 3), ...onDay('2026-09-22', 30),
    ])
    expect(result.headline).toBe('51 new customer records this week, with an unusual spike on Tue 22 Sep; setting aside unusual days, in line with the 4-week average.')
    expect(metric(result, '4-week average').comparison).toBe('this week: in line with the 4-week average, setting aside 2 unusual days')
    expect(result.notes.some((n) => n.includes('unusual days, most likely imports,') && n.includes('Tue 1 Sep (43 records) and Tue 22 Sep (33 records)'))).toBe(true)
    expectCleanText(result)
  })

  it('needs at least 20 records for a spike even when the day is far above normal', async () => {
    const low = [record(HISTORY_ANCHOR), ...['2026-07-01', '2026-08-01', '2026-09-01'].flatMap((d) => onDay(d, 1))]
    const nineteen = await build([...low, ...onDay('2026-09-22', 19)])
    expect(nineteen.signals.map((s) => s.key)).toEqual(['customers.growth.week'])

    const twenty = await build([...low, ...onDay('2026-09-22', 20)])
    expect(twenty.signals.map((s) => s.key)).toEqual(['customers.spike.2026-09-22'])
  })

  it('needs 3 times the 13-week daily average for a spike when the average is high', async () => {
    // 7 a day on average, so a spike needs 21.
    const busy = baseline(7)
    const twenty = await build([...busy, ...onDay('2026-09-22', 20)])
    expect(twenty.signals.filter((s) => s.key.startsWith('customers.spike'))).toEqual([])

    const twentyOne = await build([...busy, ...onDay('2026-09-22', 21)])
    expect(twentyOne.signals.map((s) => s.key)).toContain('customers.spike.2026-09-22')
  })

  it('only looks for spikes in this week', async () => {
    const result = await build([...baseline(1), ...onDay('2026-09-15', 30), ...everyDay('2026-09-18', '2026-09-24', 1)])
    expect(result.signals.filter((s) => s.key.startsWith('customers.spike'))).toEqual([])
  })

  it('merges several spike days into one list action with every day as a member', async () => {
    const result = await build([...baseline(1), ...onDay('2026-09-19', 25), ...onDay('2026-09-23', 30)])
    const spikes = result.signals.filter((s) => s.key.startsWith('customers.spike'))

    expect(spikes).toEqual([{
      key: 'customers.spike.week',
      rag: 'amber',
      kind: 'issue',
      text: 'Unusual spikes in new customer records on 2 days this week. Check for an import.',
      emailSafe: true,
      action: {
        text: 'Check the customer records added on 2 unusual days this week for an import or duplicates',
        href: 'https://management.example.test/customers',
        target: 'list',
        impact: 'housekeeping',
        members: [
          'Check the 25 customer records added on Sat 19 Sep for an import or duplicates',
          'Check the 30 customer records added on Wed 23 Sep for an import or duplicates',
        ],
        dueDate: undefined,
      },
    }])
    expect(result.signals.some((s) => s.kind === 'win')).toBe(false)
    // Nothing else came in that week, so setting the spikes aside leaves a real decline.
    expect(result.signals.map((s) => s.key)).toEqual(['customers.decline.week', 'customers.spike.week'])
    expect(result.headline).toBe('55 new customer records this week, with unusual spikes on 2 days; setting them aside, down 71% on the 4-week average.')
  })

  it('shows not enough history and raises no signal when records begin inside the 4-week baseline', async () => {
    // First record 5 Sep: last week is covered, the 4- and 13-week baselines are not.
    const result = await build([...everyDay('2026-09-05', '2026-09-17', 1), ...onDay('2026-09-22', 40)])

    expect(result.signals).toEqual([])
    expect(result.headline).toBe('40 new customer records this week, not enough history yet for the 4-week average.')
    expect(metric(result, 'New records, 7 days').comparison).toBe('up 471% on last week (7)')
    expect(metric(result, '4-week average')).toEqual({ label: '4-week average', value: 'Not enough history yet' })
    expect(metric(result, '13-week average')).toEqual({ label: '13-week average', value: 'Not enough history yet' })
    expect(metric(result, 'Trend')).toEqual({ label: 'Trend', value: 'Not enough history yet' })
    expect(result.notes).toContain('Customer records start on 5 Sep 2026, so there is not enough history yet for the 4-week and 13-week averages, the trend or spike checks.')
    expectCleanText(result)
  })

  it('keeps the 4-week win but skips spike checks when only the 13-week baseline is missing', async () => {
    // First record 1 Aug: before the 4-week baseline (21 Aug), after the 13-week one (19 Jun).
    const result = await build([...everyDay('2026-08-01', '2026-09-17', 1), ...onDay('2026-09-22', 30)])

    expect(result.signals.map((s) => s.key)).toEqual(['customers.growth.week'])
    expect(metric(result, '13-week average').value).toBe('Not enough history yet')
    expect(result.notes).toContain('Customer records start on 1 Aug 2026, so there is not enough history yet for the 13-week average, the trend or spike checks.')
  })

  it('says there is no comparison at all when records start this week', async () => {
    const result = await build(onDay('2026-09-20', 3))
    expect(metric(result, 'New records, 7 days').comparison).toBe('not enough history yet for last week')
    expect(result.notes).toContain('Customer records start on 20 Sep 2026, so there is not enough history yet for any comparison, the trend or spike checks.')
    expect(result.signals).toEqual([])
  })

  it('handles an empty customer table as zeros with a no-history note, never a signal', async () => {
    const result = await build([])
    expect(result.headline).toBe('No new customer records this week, not enough history yet for the 4-week average.')
    expect(result.signals).toEqual([])
    expect(metric(result, 'New records, 7 days').value).toBe('0')
    expect(result.notes).toEqual([
      'Counts new customer records, including imports, walk-ins and texts to new numbers.',
      'No customer records yet, so there is nothing to compare.',
    ])
    expectCleanText(result)
  })

  it('reads a quiet period with history as genuinely zero', async () => {
    const result = await build([record(HISTORY_ANCHOR)])
    expect(result.headline).toBe('No new customer records this week, and none in the 4 weeks before.')
    expect(result.signals).toEqual([])
    expect(metric(result, 'New records, 7 days').comparison).toBe('no activity, as in last week')
    expect(metric(result, '4-week average')).toMatchObject({ value: '0 a week', comparison: 'this week: no activity, as in the 4-week average' })
    expect(metric(result, 'New records, 13 weeks').value).toBe('0')
    expect(result.notes).toHaveLength(1)
  })

  it('calls records after an empty 4 weeks new activity and a win', async () => {
    const result = await build([record(HISTORY_ANCHOR), ...everyDay('2026-09-18', '2026-09-24', 1)])
    expect(result.signals).toEqual([{
      key: 'customers.growth.week',
      rag: 'green',
      kind: 'win',
      text: '7 new customer records this week, after none in the 4 weeks before.',
      emailSafe: true,
    }])
    expect(result.headline).toBe('7 new customer records this week, after none in the 4 weeks before.')
  })

  it('reports a growing trend in the figures without raising a trend signal', async () => {
    // 1 a day for 9 weeks, then 3 a day for the 4 weeks before this week, and 3 a day this week.
    const rows = [
      record(HISTORY_ANCHOR),
      ...everyDay('2026-06-19', '2026-08-20', 1),
      ...everyDay('2026-08-21', '2026-09-17', 3),
      ...everyDay('2026-09-18', '2026-09-24', 3),
    ]
    const result = await build(rows)
    expect(metric(result, 'Trend')).toMatchObject({
      value: 'Growing',
      comparison: 'New customer records are growing: the last 4 weeks are ahead of the 13-week average.',
    })
    expect(result.signals).toEqual([])
  })

  it('reports a declining trend in the figures without raising a trend signal', async () => {
    const rows = [
      record(HISTORY_ANCHOR),
      ...everyDay('2026-06-19', '2026-08-20', 3),
      ...everyDay('2026-08-21', '2026-09-17', 1),
      ...everyDay('2026-09-18', '2026-09-24', 1),
    ]
    const result = await build(rows)
    expect(metric(result, 'Trend').value).toBe('Declining')
    expect(result.signals).toEqual([])
  })

  it('buckets by London date in British Summer Time and leaves today out', async () => {
    const rows = [
      ...baseline(1),
      record('2026-09-17T23:30:00Z'), // 00:30 on Fri 18 Sep in London: this week
      record('2026-09-17T22:30:00Z'), // 23:30 on Thu 17 Sep in London: last week
      record('2026-09-24T23:30:00Z'), // 00:30 on Fri 25 Sep in London: today, not counted
      record('2026-09-24T22:59:00Z'), // 23:59 on Thu 24 Sep in London: this week
    ]
    const result = await build(rows)
    expect(metric(result, 'New records, 7 days').value).toBe('2')
    expect(metric(result, 'New records, 14 days').value).toBe('10')
  })

  it('keeps a week containing the October clock change to 7 whole London days', async () => {
    // Friday 30 Oct 2026, 06:00 GMT. This week is 23 Oct to 29 Oct; clocks went back on 25 Oct.
    const now = new Date('2026-10-30T06:00:00Z')
    const rows = [
      record(HISTORY_ANCHOR),
      record('2026-10-22T22:30:00Z'), // 23:30 BST on Thu 22 Oct: last week
      record('2026-10-22T23:30:00Z'), // 00:30 BST on Fri 23 Oct: this week
      record('2026-10-29T23:30:00Z'), // 23:30 GMT on Thu 29 Oct: this week
      record('2026-10-30T00:30:00Z'), // 00:30 GMT on Fri 30 Oct: today, not counted
    ]
    const result = await build(rows, now)
    expect(metric(result, 'New records, 7 days').value).toBe('2')
    expect(metric(result, 'New records, 14 days').value).toBe('3')
  })

  it('pages past 1,000 rows so a big import is counted in full', async () => {
    const result = await build([...baseline(3), ...everyDay('2026-09-18', '2026-09-24', 3), ...onDay('2026-09-22', 1200)])
    expect(metric(result, 'New records, 7 days').value).toBe('1,221')
    expect(metric(result, 'New records, 13 weeks').value).toBe('1,473')
    expect(result.signals.map((s) => s.key)).toEqual(['customers.spike.2026-09-22'])
    expect(result.signals[0].text).toBe('Unusual spike on Tue 22 Sep: 1,203 new records against 3 a day usually. Check for an import.')
  })

  it('fails loudly when the read fails, so the engine marks the section not checked', async () => {
    const fake = new FakeDb({ customers: baseline(1) }).fail('customers', 'permission denied')
    await expect(buildCustomersSection(makeContext(fake))).rejects.toThrow(/permission denied/)
  })

  it('keeps every signal and action email safe and free of personal details', async () => {
    const result = await build([...baseline(1), ...onDay('2026-09-19', 25), ...onDay('2026-09-23', 30)])
    expect(result.signals.length).toBeGreaterThan(0)
    for (const signal of result.signals) {
      expect(signal.emailSafe).toBe(true)
      expect(signal.entity).toBeUndefined()
    }
    expectCleanText(result)
  })
})
