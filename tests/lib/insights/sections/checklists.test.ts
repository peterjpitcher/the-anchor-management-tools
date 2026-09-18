import { describe, expect, it } from 'vitest'
import { buildInsightsReport } from '@/lib/insights/engine'
import { buildChecklistsSection, checklistsSection } from '@/lib/insights/sections/checklists'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { addDays } from '@/lib/insights/windows'
import { FakeDb } from '../helpers/fake-db'
import { makeContext, TEST_APP_URL } from '../helpers/context'

// makeContext: Friday 25 Sep 2026 06:00 London. Today 2026-09-25, this week 18 to 24 Sep,
// last week 11 to 17 Sep, 4 weeks 28 Aug to 24 Sep, 8 weeks from 31 Jul.

type Row = Record<string, unknown>

const THIS_WEEK_START = '2026-09-18'
const THIS_WEEK_END = '2026-09-24'
const HISTORY_START = '2026-07-31'
const LAST_WEEK_END = '2026-09-17'

const STAFF: Row[] = [
  { employee_id: 'emp-a', first_name: 'Alice', last_name: 'Ashdown', preferred_name: null },
  { employee_id: 'emp-b', first_name: 'Bartholomew', last_name: 'Birch', preferred_name: 'Barty' },
  { employee_id: 'emp-c', first_name: 'Cedric', last_name: 'Coombes', preferred_name: null },
  { employee_id: 'emp-d', first_name: 'Delphine', last_name: 'Dukes', preferred_name: null },
  { employee_id: 'emp-e', first_name: 'Evangeline', last_name: 'Ellery', preferred_name: null },
]
const NAME_TOKENS = ['Alice', 'Ashdown', 'Barty', 'Bartholomew', 'Birch', 'Cedric', 'Coombes', 'Delphine', 'Dukes', 'Evangeline', 'Ellery']

let sequence = 0

function lockedAt(date: string): string {
  return `${addDays(date, 1)}T04:01:00Z`
}

function instance(date: string, overrides: Row = {}): Row {
  sequence += 1
  return {
    id: `inst-${String(sequence).padStart(6, '0')}`,
    business_date: date,
    slot: 'close',
    department: 'bar',
    title_snapshot: `Routine task ${sequence % 20}`,
    state: 'done',
    locked_at: lockedAt(date),
    was_late: false,
    completed_by_employee_id: 'emp-a',
    completed_at: `${date}T20:00:00Z`,
    grace_until: `${date}T21:00:00Z`,
    accountable_employee_id: 'emp-a',
    value_breach: false,
    value_recorded: null,
    value_unit: null,
    value_min: null,
    value_max: null,
    ...overrides,
  }
}

interface DaySpec {
  done?: number
  late?: number
  missed?: number
  skipped?: number
  notApplicable?: number
  completer?: string
  accountable?: string | null
  missTitle?: string
  missSlot?: string
  locked?: boolean
}

function dayRows(date: string, spec: DaySpec = {}): Row[] {
  const { done = 40, late = 0, missed = 0, skipped = 0, notApplicable = 0, completer = 'emp-a', locked = true } = spec
  const accountable = spec.accountable === undefined ? 'emp-a' : spec.accountable
  const lock = locked ? lockedAt(date) : null
  const rows: Row[] = []
  for (let i = 0; i < done; i += 1) {
    const isLate = i < late
    rows.push(instance(date, {
      state: 'done',
      was_late: isLate,
      completed_at: isLate ? `${date}T22:30:00Z` : `${date}T20:00:00Z`,
      completed_by_employee_id: completer,
      accountable_employee_id: accountable,
      locked_at: lock,
    }))
  }
  for (let i = 0; i < missed; i += 1) {
    rows.push(instance(date, {
      state: 'missed',
      completed_by_employee_id: null,
      completed_at: null,
      accountable_employee_id: accountable,
      title_snapshot: spec.missTitle ?? 'Clean the ice machine',
      slot: spec.missSlot ?? 'close',
      locked_at: lock,
    }))
  }
  for (let i = 0; i < skipped; i += 1) {
    rows.push(instance(date, { state: 'skipped', completed_by_employee_id: null, completed_at: null, locked_at: lock }))
  }
  for (let i = 0; i < notApplicable; i += 1) {
    rows.push(instance(date, { state: 'not_applicable', completed_by_employee_id: null, completed_at: null, locked_at: lock }))
  }
  return rows
}

function rangeRows(start: string, end: string, spec: DaySpec = {}): Row[] {
  const rows: Row[] = []
  for (let date = start; date <= end; date = addDays(date, 1)) rows.push(...dayRows(date, spec))
  return rows
}

/** Seven healthy weeks before this week: 40 done a day, nothing missed or late. */
function history(): Row[] {
  return rangeRows(HISTORY_START, LAST_WEEK_END)
}

function makeDb(instances: Row[], extra: Record<string, Row[]> = {}): FakeDb {
  const db = new FakeDb({
    checklist_task_instances: instances,
    checklist_spot_checks: [],
    checklist_spot_check_expectations: [],
    employees: STAFF,
    special_hours: [],
    ...extra,
  })
  db.rpcHandlers.business_hours_for_date = () => [{ opens: '12:00:00', closes: '23:00:00', is_closed: false }]
  return db
}

async function build(db: FakeDb, now?: Date): Promise<SectionBuildResult> {
  return buildChecklistsSection(makeContext(db, now))
}

function signal(result: SectionBuildResult, key: string): InsightSignal | undefined {
  return result.signals.find((item) => item.key === key)
}

function keys(result: SectionBuildResult): string[] {
  return result.signals.map((item) => item.key)
}

function list(result: SectionBuildResult, title: string) {
  const found = result.lists.find((item) => item.title.startsWith(title))
  if (!found) throw new Error(`No list ${title}`)
  return found
}

function metric(result: SectionBuildResult, label: string) {
  const found = result.metrics.find((item) => item.label.startsWith(label))
  if (!found) throw new Error(`No metric ${label}`)
  return found
}

/** Everything the email or a printed copy could show from this section. */
function emailVisibleText(result: SectionBuildResult): string {
  const parts: string[] = [result.headline, ...result.notes]
  for (const item of result.metrics) parts.push(item.label, item.value, item.comparison ?? '')
  for (const item of result.signals) {
    if (item.emailSafe) parts.push(item.text)
    if (item.action) parts.push(item.action.text, ...(item.action.members ?? []))
  }
  return parts.join('\n')
}

function everyHref(result: SectionBuildResult): string[] {
  const hrefs: string[] = []
  for (const item of result.signals) if (item.action) hrefs.push(item.action.href)
  for (const group of result.lists) for (const item of group.items) if (item.href) hrefs.push(item.href)
  return hrefs
}

function expectCleanOutput(result: SectionBuildResult): void {
  const json = JSON.stringify(result)
  expect(json).not.toMatch(/undefined|NaN|Invalid Date/)
  expect(json).not.toContain(String.fromCharCode(0x2014))
  for (const href of everyHref(result)) expect(href.startsWith(`${TEST_APP_URL}/`)).toBe(true)
}

describe('checklists section definition', () => {
  it('keeps its key, title and page', () => {
    expect(checklistsSection).toMatchObject({ key: 'checklists', title: 'Checklists', path: '/checklists/manage/insights' })
    expect(checklistsSection.build).toBe(buildChecklistsSection)
  })
})

describe('checklists section: healthy week', () => {
  it('is a green win with an on-track headline, weekly row and day links', async () => {
    const rows = [
      ...history(),
      ...rangeRows(THIS_WEEK_START, THIS_WEEK_END, { done: 40, late: 2 }),
      ...dayRows('2026-09-21', { done: 0, missed: 1, accountable: 'emp-b' }),
    ]
    const result = await build(makeDb(rows))

    expect(keys(result)).toEqual(['checklists.on_track'])
    const win = signal(result, 'checklists.on_track')!
    expect(win).toMatchObject({ kind: 'win', rag: 'green', emailSafe: true })
    expect(win.action).toBeUndefined()
    // 280 done, 1 missed: 99.64% truncated to one decimal; 14 of 280 late.
    expect(win.text).toBe('99.6% of checks were done this week, 5% late, with no repeat missers.')
    expect(result.headline).toBe('Checks are on track: 99.6% done this week, 5% late, and no repeat missers.')

    // The email shows the first four: completion, missed, late and the 8-week row (spec 5.11).
    expect(result.metrics.slice(0, 4)).toEqual([
      { label: 'Completion', value: '99.6%', comparison: 'last week 100%, previous 4 weeks 100%' },
      { label: 'Missed', value: '1', comparison: 'last week 0' },
      { label: 'Done late', value: '14', comparison: '5% of checks done' },
      {
        label: 'Completion, last 8 weeks',
        value: '100%, 100%, 100%, 100%, 100%, 100%, 100%, 99.6%',
        comparison: 'oldest first, weeks ending Thu 6 Aug to Thu 24 Sep',
      },
    ])
    expect(metric(result, 'Readings out of range').value).toBe('0')
    expect(result.notes).toEqual([])

    const days = list(result, 'This week by day').items
    expect(days).toHaveLength(7)
    expect(days[0]).toEqual({ text: 'Fri 18 Sep: 100% (40 done, 0 missed, 2 late)', href: `${TEST_APP_URL}/checklists/2026-09-18` })
    expect(days[3].text).toBe('Mon 21 Sep: 97.5% (40 done, 1 missed, 2 late)')
    expect(list(result, 'Missed this week').items).toEqual([
      { text: 'Mon 21 Sep: Clean the ice machine (bar, closing), Barty', href: `${TEST_APP_URL}/checklists/2026-09-21` },
    ])
    expectCleanOutput(result)
  })

  it('counts skipped and not applicable checks in neither side of completion', async () => {
    const rows = [
      ...history(),
      ...rangeRows(THIS_WEEK_START, THIS_WEEK_END, { done: 38, missed: 2, skipped: 5, notApplicable: 3, accountable: null }),
    ]
    const result = await build(makeDb(rows))
    // 266 done, 14 missed: exactly 95%, so no completion signal.
    expect(metric(result, 'Completion').value).toBe('95%')
    expect(keys(result).some((key) => key.startsWith('checklists.completion'))).toBe(false)
  })

  it('reads through ctx.db only, with paged reads of a stable order', async () => {
    const db = makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END)])
    await build(db)
    const tables = db.calls.map((call) => call.table)
    // 2,240 instance rows arrive in three pages of up to 1,000.
    expect(tables.filter((table) => table === 'checklist_task_instances')).toHaveLength(3)
    expect(tables).toContain('checklist_spot_checks')
    expect(tables).toContain('checklist_spot_check_expectations')
    expect(tables).toContain('employees')
    // No empty days, so the hours are never read.
    expect(tables).not.toContain('special_hours')
    expect(tables).not.toContain('business_hours_for_date')
  })
})

describe('checklists section: completion rules', () => {
  it('is red below 90% with a list action to the problems page for this week', async () => {
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END, { done: 30, missed: 5, accountable: null })]
    const result = await build(makeDb(rows))
    const low = signal(result, 'checklists.completion.low')!
    // 210 done, 35 missed: 85.71%.
    expect(low).toMatchObject({ rag: 'red', kind: 'issue', emailSafe: true })
    expect(low.text).toBe('Only 85.7% of checks were done this week: 35 checks missed.')
    expect(low.action).toEqual({
      text: 'Find out why 35 checks were missed this week',
      href: `${TEST_APP_URL}/checklists/manage/problems?from=2026-09-18&to=2026-09-24`,
      target: 'list',
      impact: 'safety',
    })
    expect(signal(result, 'checklists.completion.watch')).toBeUndefined()
    expect(signal(result, 'checklists.on_track')).toBeUndefined()
    expect(result.headline).toBe('Checks are not being done properly: only 85.7% done (35 missed) and 35 misses with no one accountable.')
    expect(list(result, 'This week by day').items[0].rag).toBe('red')
    expectCleanOutput(result)
  })

  it('is amber from 90% up to 95%, and exactly 90% is amber not red', async () => {
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END, { done: 36, missed: 4, accountable: null })]
    const result = await build(makeDb(rows))
    expect(signal(result, 'checklists.completion.low')).toBeUndefined()
    const watch = signal(result, 'checklists.completion.watch')!
    expect(watch).toMatchObject({ rag: 'amber', kind: 'issue', emailSafe: true })
    expect(watch.text).toBe('90% of checks were done this week, below 95%: 28 checks missed.')
    expect(watch.action?.href).toBe(`${TEST_APP_URL}/checklists/manage/problems?from=2026-09-18&to=2026-09-24`)
    expect(result.headline.startsWith('Checks are slipping: 90% done, below 95%')).toBe(true)
  })

  it('never shows a rate just under a line as the line itself', async () => {
    // 8,999 of 10,000 would round to 90.0%; it must read 89.9% beside a red signal.
    const rows = [
      ...history(),
      ...dayRows('2026-09-18', { done: 8999, missed: 1001, accountable: null }),
    ]
    const result = await build(makeDb(rows))
    expect(metric(result, 'Completion').value).toBe('89.9%')
    expect(signal(result, 'checklists.completion.low')).toBeDefined()
  })

  it('is amber when more than 15% of checks were done late, and not at exactly 15%', async () => {
    const over = await build(makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END, { done: 40, late: 7 })]))
    const late = signal(over, 'checklists.late')!
    expect(late).toMatchObject({ rag: 'amber', emailSafe: true })
    expect(late.text).toBe('17.5% of checks were done late this week (49 of 280).')
    expect(late.action).toMatchObject({
      href: `${TEST_APP_URL}/checklists/manage/insights?from=2026-09-18&to=2026-09-24`,
      target: 'list',
      impact: 'staffing',
    })
    expect(over.headline).toBe('Checks are mostly on track at 100% done, but 17.5% done late.')

    const exactly = await build(makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END, { done: 40, late: 6 })]))
    expect(signal(exactly, 'checklists.late')).toBeUndefined()
    expect(signal(exactly, 'checklists.on_track')).toBeDefined()
  })
})

describe('checklists section: readings, spot checks and unassigned misses', () => {
  it('raises one amber record action for a single out-of-range reading', async () => {
    const breach = instance('2026-09-22', {
      title_snapshot: 'Fridge 2 temperature',
      value_breach: true,
      value_recorded: 9,
      value_unit: 'degC',
      value_min: 0,
      value_max: '5.0',
    })
    const result = await build(makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END), breach]))
    const item = signal(result, `checklists.breach.${breach.id as string}`)!
    expect(item).toMatchObject({ rag: 'amber', kind: 'issue', emailSafe: true, entity: `checklist_instance:${breach.id as string}` })
    expect(item.text).toBe('Fridge 2 temperature read 9°C on Tue 22 Sep, outside 0°C to 5°C.')
    expect(item.action).toEqual({
      text: 'Check the Fridge 2 temperature reading from Tue 22 Sep (9°C)',
      href: `${TEST_APP_URL}/checklists/2026-09-22`,
      target: 'list',
      impact: 'safety',
    })
    expect(metric(result, 'Readings out of range').value).toBe('1')
    expect(list(result, 'Readings out of range this week').items).toEqual([
      { text: 'Tue 22 Sep: Fridge 2 temperature read 9°C, outside 0°C to 5°C', href: `${TEST_APP_URL}/checklists/2026-09-22`, rag: 'amber' },
    ])
    expect(signal(result, 'checklists.on_track')).toBeUndefined()
  })

  it('merges several readings into one list action with every reading beneath it', async () => {
    const breaches = [
      instance('2026-09-19', { title_snapshot: 'Cellar cooler', value_breach: true, value_recorded: 15, value_unit: 'degC', value_min: 1, value_max: 12 }),
      instance('2026-09-20', { title_snapshot: 'Fridge 1 temperature', value_breach: true, value_recorded: 8, value_unit: 'degC', value_min: null, value_max: 5 }),
      instance('2026-09-23', { title_snapshot: 'Freezer', value_breach: true, value_recorded: -10, value_unit: 'degC', value_min: -30, value_max: -15 }),
      // A breach on a missed row is impossible in practice and never counted.
      instance('2026-09-23', { state: 'missed', completed_by_employee_id: null, completed_at: null, value_breach: true }),
    ]
    const result = await build(makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END), ...breaches]))
    expect(keys(result).filter((key) => key.startsWith('checklists.breach'))).toEqual(['checklists.breaches'])
    const merged = signal(result, 'checklists.breaches')!
    expect(merged).toMatchObject({ rag: 'amber', kind: 'issue', emailSafe: true, text: '3 readings were out of range this week.' })
    expect(merged.action).toMatchObject({
      text: 'Follow up 3 out-of-range readings',
      href: `${TEST_APP_URL}/checklists/manage/problems?from=2026-09-18&to=2026-09-24`,
      target: 'list',
      impact: 'safety',
      members: [
        'Check the Cellar cooler reading from Sat 19 Sep (15°C)',
        'Check the Fridge 1 temperature reading from Sun 20 Sep (8°C)',
        'Check the Freezer reading from Wed 23 Sep (-10°C)',
      ],
    })
    expect(list(result, 'Readings out of range').items.map((item) => item.text)).toEqual([
      'Sat 19 Sep: Cellar cooler read 15°C, outside 1°C to 12°C',
      'Sun 20 Sep: Fridge 1 temperature read 8°C, above the 5°C limit',
      'Wed 23 Sep: Freezer read -10°C, outside -30°C to -15°C',
    ])
    expect(result.headline).toBe('Checks are mostly on track at 99.6% done, but 3 readings out of range.')
  })

  it('shows spot checks drawn against recorded and flags drawn ones never recorded', async () => {
    const spot = (id: string, date: string, state: string): Row => ({ id, business_date: date, state })
    const expectations = Array.from({ length: 7 }, (_, index) => ({ business_date: addDays(THIS_WEEK_START, index), expected: 3 }))
    const result = await build(makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END)], {
      checklist_spot_checks: [
        spot('s1', '2026-09-19', 'recorded'),
        spot('s2', '2026-09-19', 'drawn'),
        spot('s3', '2026-09-22', 'drawn'),
        spot('s0', '2026-09-10', 'drawn'),
      ],
      checklist_spot_check_expectations: expectations,
    }))
    expect(metric(result, 'Spot checks recorded')).toEqual({ label: 'Spot checks recorded', value: '1 of 3 drawn', comparison: '21 expected' })
    const spotSignal = signal(result, 'checklists.spot_checks')!
    expect(spotSignal).toMatchObject({ rag: 'amber', emailSafe: true, text: '2 spot checks drawn this week were not recorded.' })
    expect(spotSignal.action).toMatchObject({ href: `${TEST_APP_URL}/checklists/manage/spot-checks`, target: 'list' })
  })

  it('shows nothing drawn as 0 of 0 with no signal', async () => {
    const result = await build(makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END)]))
    expect(metric(result, 'Spot checks recorded')).toEqual({ label: 'Spot checks recorded', value: '0 of 0 drawn' })
    expect(signal(result, 'checklists.spot_checks')).toBeUndefined()
  })

  it('is amber at 10 unassigned misses and quiet at 9', async () => {
    const unassigned = (count: number): Row[] => Array.from({ length: count }, (_, index) =>
      instance(addDays(THIS_WEEK_START, index % 7), { state: 'missed', completed_by_employee_id: null, completed_at: null, accountable_employee_id: null }))
    const ten = await build(makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END), ...unassigned(10)]))
    const item = signal(ten, 'checklists.unassigned')!
    expect(item).toMatchObject({
      rag: 'amber',
      emailSafe: true,
      text: '10 missed checks this week had no accountable person: nobody was on the rota when they fell due.',
    })
    expect(item.action).toEqual({
      text: 'Agree who picks up checks with no accountable person',
      href: `${TEST_APP_URL}/checklists/manage/problems?from=2026-09-18&to=2026-09-24`,
      target: 'list',
      impact: 'housekeeping',
    })
    expect(metric(ten, 'Misses with no accountable person').value).toBe('10')
    expect(list(ten, 'Missed this week').items[0].text).toMatch(/, unassigned$/)

    const nine = await build(makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END), ...unassigned(9)]))
    expect(signal(nine, 'checklists.unassigned')).toBeUndefined()
  })

  it('explains that any-time checks have no accountable person', async () => {
    const miss = (index: number, slot: string): Row => instance(addDays(THIS_WEEK_START, index % 7), {
      state: 'missed', slot, completed_by_employee_id: null, completed_at: null, accountable_employee_id: null,
    })
    const anyTime = Array.from({ length: 10 }, (_, index) => miss(index, 'anytime'))
    const allAnyTime = await build(makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END), ...anyTime]))
    expect(signal(allAnyTime, 'checklists.unassigned')?.text)
      .toBe('10 missed checks this week had no accountable person: all any-time checks, which are not assigned to anyone.')

    const mixed = [...anyTime.slice(0, 7), miss(1, 'close'), miss(2, 'open'), miss(3, '18:00')]
    const mixedResult = await build(makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END), ...mixed]))
    expect(signal(mixedResult, 'checklists.unassigned')?.text)
      .toBe('10 missed checks this week had no accountable person: 7 any-time checks and 3 with nobody on the rota.')
  })
})

describe('checklists section: people (page only)', () => {
  function repeatMisserRows(): Row[] {
    return [
      ...history(),
      ...rangeRows(THIS_WEEK_START, THIS_WEEK_END),
      // Barty: 3 misses this week (red on this week alone).
      ...dayRows('2026-09-19', { done: 0, missed: 2, accountable: 'emp-b' }),
      ...dayRows('2026-09-22', { done: 0, missed: 1, accountable: 'emp-b' }),
      // Cedric: none this week, 6 in the 4 weeks (red on 4 weeks).
      ...dayRows('2026-09-01', { done: 0, missed: 3, accountable: 'emp-c', missTitle: 'Mop the cellar', missSlot: 'open' }),
      ...dayRows('2026-09-02', { done: 0, missed: 3, accountable: 'emp-c', missTitle: 'Mop the cellar', missSlot: 'open' }),
      // Delphine: 2 this week and 5 in 4 weeks: below both lines.
      ...dayRows('2026-09-20', { done: 0, missed: 2, accountable: 'emp-d' }),
      ...dayRows('2026-09-03', { done: 0, missed: 3, accountable: 'emp-d' }),
      // Evangeline: 6 misses, but on 27 Aug, outside the 4 weeks.
      ...dayRows('2026-08-27', { done: 0, missed: 6, accountable: 'emp-e' }),
    ]
  }

  it('counts repeat missers in the email and names them on the page only', async () => {
    const result = await build(makeDb(repeatMisserRows()))
    const count = signal(result, 'checklists.repeat_missers')!
    expect(count).toMatchObject({ rag: 'red', kind: 'issue', emailSafe: true })
    expect(count.text).toBe('2 staff repeatedly missed checks: 3 or more this week, or 6 or more in 4 weeks.')
    expect(count.action).toEqual({
      text: 'Talk to the 2 staff who keep missing checks',
      href: `${TEST_APP_URL}/checklists/manage/problems?from=2026-08-28&to=2026-09-24`,
      target: 'list',
      impact: 'staffing',
    })

    const barty = signal(result, 'checklists.repeat_misser.emp-b')!
    expect(barty).toMatchObject({ rag: 'red', kind: 'issue', emailSafe: false, entity: 'employee:emp-b' })
    expect(barty.text).toBe('Barty missed 3 checks this week and 3 in 4 weeks while on shift.')
    expect(barty.action).toBeUndefined()
    const cedric = signal(result, 'checklists.repeat_misser.emp-c')!
    expect(cedric).toMatchObject({ emailSafe: false })
    expect(cedric.text).toBe('Cedric missed 0 checks this week and 6 in 4 weeks while on shift.')
    expect(signal(result, 'checklists.repeat_misser.emp-d')).toBeUndefined()
    expect(signal(result, 'checklists.repeat_misser.emp-e')).toBeUndefined()

    expect(metric(result, 'Staff repeatedly missing checks').value).toBe('2')
    expect(result.headline).toBe('Checks are mostly on track at 98.2% done, but 2 staff repeatedly missed checks.')
  })

  it('uses the singular for one repeat misser', async () => {
    const result = await build(makeDb([
      ...history(),
      ...rangeRows(THIS_WEEK_START, THIS_WEEK_END),
      ...dayRows('2026-09-19', { done: 0, missed: 3, accountable: 'emp-b' }),
    ]))
    const count = signal(result, 'checklists.repeat_missers')!
    expect(count.text.startsWith('1 member of staff repeatedly missed checks')).toBe(true)
    expect(count.action?.text).toBe('Talk to the member of staff who keeps missing checks')
  })

  it('never lets a staff name reach anything the email or a printed copy shows', async () => {
    const rows = [
      ...repeatMisserRows(),
      ...rangeRows('2026-09-10', '2026-09-16', { done: 5, late: 2, completer: 'emp-b' }),
    ]
    const result = await build(makeDb(rows))
    const visible = emailVisibleText(result)
    for (const token of NAME_TOKENS) expect(visible).not.toContain(token)
    // The page still has the names.
    const pageText = JSON.stringify(result.lists)
    expect(pageText).toContain('Barty')
    expect(pageText).toContain('Cedric')
    expectCleanOutput(result)
  })

  it('lists each person over 4 weeks with the on-time score, and ranks only those with 10 or more checks', async () => {
    const rows = [
      ...history(),
      ...rangeRows(THIS_WEEK_START, THIS_WEEK_END),
      // Barty: 12 checks over 4 weeks, 3 late (25%).
      ...rangeRows('2026-09-11', '2026-09-16', { done: 2, late: 0, completer: 'emp-b' }),
      ...dayRows('2026-09-17', { done: 0, missed: 1, accountable: 'emp-b' }),
      // Cedric: 11 checks, 1 late (9%).
      ...dayRows('2026-09-05', { done: 11, late: 1, completer: 'emp-c' }),
      // Delphine: 9 checks, none late: too few to rank.
      ...dayRows('2026-09-06', { done: 9, completer: 'emp-d' }),
      // Evangeline: 20 checks on 20 Aug, outside the 4 weeks: not listed.
      ...dayRows('2026-08-20', { done: 20, completer: 'emp-e' }),
    ]
    // Make 3 of Barty's checks late.
    let madeLate = 0
    for (const row of rows) {
      if (row.completed_by_employee_id === 'emp-b' && madeLate < 3) {
        row.was_late = true
        row.completed_at = `${row.business_date as string}T22:30:00Z`
        madeLate += 1
      }
    }
    const result = await build(makeDb(rows))

    const ranking = list(result, 'Highest and lowest on-time').items
    expect(ranking).toEqual([
      { text: 'Highest: Alice, 0% late over 1,120 checks', rag: 'green' },
      { text: 'Lowest: Barty, 25% late over 12 checks' },
    ])

    const people = list(result, 'Staff, last 4 weeks').items
    expect(people.map((item) => item.text)).toEqual([
      'Alice: 1,120 checks done, 0% late, on-time score 10.0 out of 10',
      'Barty: 12 checks done, 25% late, 1 missed while on shift, too few checks for an on-time score',
      'Cedric: 11 checks done, 9% late, too few checks for an on-time score',
      'Delphine: 9 checks done, 0% late, too few checks for an on-time score',
    ])
    expect(people[0].href).toBe(`${TEST_APP_URL}/checklists/manage/insights?from=2026-08-28&to=2026-09-24`)
    expect(JSON.stringify(result)).not.toContain('Evangeline')
  })

  it('says so when fewer than two people can be ranked', async () => {
    const one = await build(makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END)]))
    expect(list(one, 'Highest and lowest on-time').items).toEqual([
      { text: 'Only one person has 10 or more checks: Alice, 0% late over 1,120 checks' },
    ])
    const none = await build(makeDb([...dayRows('2026-09-20', { done: 5 })]))
    const empty = list(none, 'Highest and lowest on-time')
    expect(empty.items).toEqual([])
    expect(empty.emptyText).toBe('Nobody has 10 or more checks in the last 4 weeks.')
  })

  it('lists the most-missed tasks over 4 weeks with department and time, and misses by place', async () => {
    const rows = [
      ...history(),
      ...rangeRows(THIS_WEEK_START, THIS_WEEK_END),
      ...dayRows('2026-09-01', { done: 0, missed: 4, accountable: null, missTitle: 'Clean the ice machine', missSlot: 'close' }),
      ...dayRows('2026-09-02', { done: 0, missed: 1, accountable: null, missTitle: 'Clean the ice machine', missSlot: '18:00:00' }),
      ...dayRows('2026-09-03', { done: 0, missed: 2, accountable: null, missTitle: 'Mop the floor', missSlot: 'open' }),
      ...dayRows('2026-09-04', { done: 0, missed: 2, accountable: null, missTitle: 'Check the fire exits', missSlot: 'anytime' }),
      ...dayRows('2026-09-05', { done: 0, missed: 1, accountable: null, missTitle: 'Bottle up', missSlot: 'close' }),
      ...dayRows('2026-09-06', { done: 0, missed: 1, accountable: null, missTitle: 'Wipe the menus', missSlot: 'open' }),
      ...dayRows('2026-09-07', { done: 0, missed: 1, accountable: null, missTitle: 'Empty the bins', missSlot: 'close' }),
      // Outside the 4 weeks: not counted.
      ...dayRows('2026-08-20', { done: 0, missed: 9, accountable: null, missTitle: 'Old task', missSlot: 'close' }),
    ]
    const result = await build(makeDb(rows))
    expect(list(result, 'Most-missed tasks').items.map((item) => item.text)).toEqual([
      'Clean the ice machine (bar, 18:00; bar, closing): 5 misses',
      'Check the fire exits (bar, any time): 2 misses',
      'Mop the floor (bar, opening): 2 misses',
      'Bottle up (bar, closing): 1 miss',
      'Empty the bins (bar, closing): 1 miss',
    ])
    expect(list(result, 'Misses by department and time').items.map((item) => item.text)).toEqual([
      'Bar, closing: 6 misses',
      'Bar, opening: 3 misses',
      'Bar, any time: 2 misses',
      'Bar, 18:00: 1 miss',
    ])
  })
})

describe('checklists section: gaps, closed days and settling', () => {
  it('notes an open day with no records and claims no rate for it', async () => {
    const rows = [
      ...history(),
      ...rangeRows(THIS_WEEK_START, '2026-09-20'),
      ...rangeRows('2026-09-22', THIS_WEEK_END),
    ]
    const result = await build(makeDb(rows))
    expect(result.notes).toEqual(['No checklist records for Mon 21 Sep, so this week\'s completion covers 6 days.'])
    expect(result.headline).toBe('Checks are mostly on track at 100% done, but no records for Mon 21 Sep.')
    expect(list(result, 'This week by day').items[3]).toEqual({
      text: 'Mon 21 Sep: no checklist records',
      href: `${TEST_APP_URL}/checklists/2026-09-21`,
      rag: 'amber',
    })
    // Completion over the 6 recorded days only; no win while a day is missing.
    expect(metric(result, 'Completion').value).toBe('100%')
    expect(signal(result, 'checklists.on_track')).toBeUndefined()
    expect(signal(result, 'checklists.no_records')).toBeUndefined()
  })

  it('counts the missing days in the headline when there are more than two', async () => {
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, '2026-09-20'), ...dayRows('2026-09-24')]
    const result = await build(makeDb(rows))
    expect(result.headline).toBe('Checks are mostly on track at 100% done, but no records for 3 days.')
    expect(result.notes).toEqual(['No checklist records for Mon 21 Sep, Tue 22 Sep and Wed 23 Sep, so this week\'s completion covers 4 days.'])
  })

  it('treats a day closed by special hours as closed, not missing', async () => {
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, '2026-09-20'), ...rangeRows('2026-09-22', THIS_WEEK_END)]
    const db = makeDb(rows, { special_hours: [{ id: 'sh1', date: '2026-09-21', opens: null, closes: null, is_closed: true }] })
    const result = await build(db)
    expect(result.notes).toEqual([])
    expect(list(result, 'This week by day').items[3]).toEqual({ text: 'Mon 21 Sep: closed' })
    expect(signal(result, 'checklists.on_track')).toBeDefined()
    expect(db.calls.find((call) => call.table === 'business_hours_for_date')?.args).toEqual({ p_date: '2026-09-21' })
  })

  it('treats a day closed in the weekly hours as closed', async () => {
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, '2026-09-20'), ...rangeRows('2026-09-22', THIS_WEEK_END)]
    const db = makeDb(rows)
    db.rpcHandlers.business_hours_for_date = (args) => (args.p_date === '2026-09-21'
      ? [{ opens: null, closes: null, is_closed: true }]
      : [{ opens: '12:00:00', closes: '23:00:00', is_closed: false }])
    const result = await build(db)
    expect(result.notes).toEqual([])
    expect(list(result, 'This week by day').items[3].text).toBe('Mon 21 Sep: closed')
  })

  it('still shows the gap when the hours cannot be read', async () => {
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, '2026-09-20'), ...rangeRows('2026-09-22', THIS_WEEK_END)]
    const db = makeDb(rows, { special_hours: [{ id: 'sh1', date: '2026-09-21', opens: null, closes: null, is_closed: true }] })
    db.fail('business_hours_for_date')
    const result = await build(db)
    expect(result.notes).toEqual(['No checklist records for Mon 21 Sep, so this week\'s completion covers 6 days.'])
  })

  it('leaves out a day that is not locked yet, including its spot checks', async () => {
    // Viewed on Friday at 04:00 London, before the overnight sweep has locked Thursday.
    const rows = [
      ...history(),
      ...rangeRows(THIS_WEEK_START, '2026-09-23'),
      ...dayRows('2026-09-24', { done: 10, missed: 20, locked: false, accountable: null }),
      instance('2026-09-24', { state: 'pending', completed_by_employee_id: null, completed_at: null, locked_at: null }),
    ]
    const db = makeDb(rows, { checklist_spot_checks: [{ id: 's1', business_date: '2026-09-24', state: 'drawn' }] })
    const result = await build(db, new Date('2026-09-25T03:00:00Z'))
    expect(result.notes).toEqual(['Checks for Thu 24 Sep are not locked yet, so that day is left out.'])
    expect(metric(result, 'Completion').value).toBe('100%')
    expect(metric(result, 'Missed').value).toBe('0')
    expect(signal(result, 'checklists.spot_checks')).toBeUndefined()
    expect(list(result, 'This week by day').items[6]).toEqual({ text: 'Thu 24 Sep: not locked yet', href: `${TEST_APP_URL}/checklists/2026-09-24` })
    // Before the sweep is due this is not a fault, but the win still waits for the whole week.
    expect(keys(result)).toEqual([])
    expect(result.headline).toBe('Checks are mostly on track at 100% done, but Thu 24 Sep not locked yet.')
  })

  it('counts a day whose only open check is an any-time check still inside its grace period', async () => {
    // Live pattern: at 06:00 Friday, an any-time check from Wednesday can be done until Saturday.
    const open = instance('2026-09-23', {
      state: 'pending',
      slot: 'anytime',
      title_snapshot: 'Descale the glass washer',
      completed_by_employee_id: null,
      completed_at: null,
      accountable_employee_id: null,
      locked_at: null,
      grace_until: '2026-09-26T21:00:00Z',
    })
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END, { done: 39, missed: 1, accountable: null }), open]
    const result = await build(makeDb(rows))
    // All seven days count: 273 done, 7 missed. The open check is in neither side.
    expect(metric(result, 'Completion').value).toBe('97.5%')
    expect(metric(result, 'Missed').value).toBe('7')
    expect(result.notes).toEqual(['1 check from Wed 23 Sep can still be done, so it is not counted yet.'])
    expect(list(result, 'This week by day').items[5].text).toBe('Wed 23 Sep: 97.5% (39 done, 1 missed, 0 late, 1 still open)')
    expect(signal(result, 'checklists.on_track')).toBeDefined()

    const two = await build(makeDb([...rows, { ...open, id: 'open-2', business_date: '2026-09-24' }]))
    expect(two.notes).toEqual(['2 checks from Wed 23 Sep and Thu 24 Sep can still be done, so they are not counted yet.'])
  })

  it('holds back a day with a check past its grace period, and flags it once the sweep should have run', async () => {
    // Grace ran out at 22:00 on Thursday; the sweep due by 05:30 Friday should have made it missed.
    const overdue = instance('2026-09-23', {
      state: 'pending',
      slot: 'anytime',
      completed_by_employee_id: null,
      completed_at: null,
      accountable_employee_id: null,
      locked_at: null,
      grace_until: '2026-09-24T21:00:00Z',
    })
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END), overdue]

    // Thursday 23:00 London: past grace, but the next sweep is not due until Friday morning.
    const before = await build(makeDb(rows), new Date('2026-09-24T22:00:00Z'))
    expect(signal(before, 'checklists.not_locked')).toBeUndefined()
    expect(before.notes).toContain('Checks for Wed 23 Sep are not locked yet, so that day is left out.')

    // Friday 06:00 London: the sweep should have judged it an hour ago.
    const result = await build(makeDb(rows))
    expect(result.notes).toEqual(['Checks for Wed 23 Sep should have locked overnight and have not, so that day is left out.'])
    expect(list(result, 'This week by day').items[5]).toEqual({
      text: 'Wed 23 Sep: not locked overnight',
      href: `${TEST_APP_URL}/checklists/2026-09-23`,
      rag: 'amber',
    })
    expect(signal(result, 'checklists.not_locked')?.text)
      .toBe('1 check from Wed 23 Sep was not locked overnight as expected, so that day is left out of this week\'s figures.')
    expect(signal(result, 'checklists.on_track')).toBeUndefined()
  })

  it('does not count a half-locked day, whose misses lock before its completions', async () => {
    const rows = [
      ...history(),
      ...rangeRows(THIS_WEEK_START, '2026-09-23'),
      ...dayRows('2026-09-24', { done: 0, missed: 5, accountable: null }),
      ...dayRows('2026-09-24', { done: 35, locked: false }),
    ]
    const result = await build(makeDb(rows), new Date('2026-09-25T03:00:00Z'))
    expect(metric(result, 'Missed').value).toBe('0')
    expect(result.notes).toEqual(['Checks for Thu 24 Sep are not locked yet, so that day is left out.'])
  })
})

describe('checklists section: a late or failed overnight sweep', () => {
  function pendingPastGrace(date: string, count: number): Row[] {
    return Array.from({ length: count }, () => instance(date, {
      state: 'pending', completed_by_employee_id: null, completed_at: null, locked_at: null,
    }))
  }

  async function reportFor(rows: Row[], now = new Date('2026-09-25T05:00:00Z')) {
    const report = await buildInsightsReport({
      createDb: () => makeDb(rows).asDb(),
      now,
      appUrl: TEST_APP_URL,
      sections: [checklistsSection],
      logFailure: () => undefined,
    })
    return report
  }

  it('is amber, not green, when nothing this week was locked, and shows no false zeros', async () => {
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END, { locked: false })]
    const result = await build(makeDb(rows))

    expect(keys(result)).toEqual(['checklists.not_locked'])
    const notLocked = signal(result, 'checklists.not_locked')!
    expect(notLocked).toMatchObject({ rag: 'amber', kind: 'issue', emailSafe: true })
    expect(notLocked.text).toBe(
      '280 checks from Fri 18 Sep, Sat 19 Sep, Sun 20 Sep, Mon 21 Sep, Tue 22 Sep, Wed 23 Sep and Thu 24 Sep '
      + 'were not locked overnight as expected, so those days are left out of this week\'s figures.',
    )
    expect(notLocked.action).toEqual({
      text: 'Have the overnight checklist lock checked: 7 days not locked',
      href: `${TEST_APP_URL}/checklists/manage`,
      target: 'list',
      impact: 'housekeeping',
    })
    expect(result.headline).toBe('Checks for 7 days were not locked overnight, so completion cannot be judged.')

    // The email's four figures: nothing reads as a measured 0.
    expect(result.metrics.slice(0, 4)).toEqual([
      { label: 'Completion', value: 'Not judged yet', comparison: 'last week 100%, previous 4 weeks 100%' },
      { label: 'Missed', value: 'Not judged yet', comparison: 'last week 0' },
      { label: 'Done late', value: 'Not judged yet' },
      {
        label: 'Completion, last 8 weeks',
        value: '100%, 100%, 100%, 100%, 100%, 100%, 100%, not judged yet',
        comparison: 'oldest first, weeks ending Thu 6 Aug to Thu 24 Sep',
      },
    ])
    expect(list(result, 'This week by day').items.every((item) => item.text.endsWith(': not locked overnight') && item.rag === 'amber')).toBe(true)
    expect(result.notes).toEqual([
      'Checks for Fri 18 Sep, Sat 19 Sep, Sun 20 Sep, Mon 21 Sep, Tue 22 Sep, Wed 23 Sep and Thu 24 Sep should have locked overnight and have not, so those days are left out.',
    ])
    // The page figures too: misses and spot checks count only on settled days, so they are
    // unknown; the readings taken are final, so their count stands.
    expect(metric(result, 'Readings out of range').value).toBe('0')
    expect(metric(result, 'Misses with no accountable person').value).toBe('Not judged yet')
    expect(metric(result, 'Spot checks recorded')).toEqual({ label: 'Spot checks recorded', value: 'Not judged yet' })
    expectCleanOutput(result)

    const report = await reportFor(rows)
    expect(report.sections[0].status).toBe('amber')
    expect(report.actions.map((action) => action.signalKey)).toEqual(['checklists.not_locked'])
  })

  it('still reports every out-of-range reading when the week did not lock', async () => {
    // A reading is final once recorded and no alert goes out at completion any more, so the
    // report must not wait for the lock: by the next report the day would be last week.
    const readings = Array.from({ length: 7 }, (_, index) => instance(addDays(THIS_WEEK_START, index), {
      title_snapshot: 'Fridge 2 temperature',
      value_breach: true,
      value_recorded: 9,
      value_unit: 'degC',
      value_min: 0,
      value_max: 5,
      locked_at: null,
    }))
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END, { locked: false }), ...readings]
    const result = await build(makeDb(rows))
    expect(keys(result)).toEqual(['checklists.breaches', 'checklists.not_locked'])
    expect(signal(result, 'checklists.breaches')).toMatchObject({ rag: 'amber', emailSafe: true, text: '7 readings were out of range this week.' })
    expect(signal(result, 'checklists.breaches')?.action?.members).toHaveLength(7)
    expect(metric(result, 'Readings out of range').value).toBe('7')
    expect(list(result, 'Readings out of range this week').items).toHaveLength(7)
    expect(result.headline).toBe('Checks for 7 days were not locked overnight, so completion cannot be judged. 7 readings were out of range.')
    expectCleanOutput(result)
  })

  it('reports a reading from a day the sweep has not locked in that Friday\'s email, once', async () => {
    const reading = instance('2026-09-24', {
      title_snapshot: 'Fridge 2 temperature',
      value_breach: true,
      value_recorded: 9,
      value_unit: 'degC',
      value_min: 0,
      value_max: 5,
      locked_at: null,
    })
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, '2026-09-23'), ...dayRows('2026-09-24', { locked: false }), reading]
    const result = await build(makeDb(rows))
    expect(keys(result)).toEqual([`checklists.breach.${reading.id as string}`, 'checklists.not_locked'])
    expect(signal(result, `checklists.breach.${reading.id as string}`)?.text).toBe('Fridge 2 temperature read 9°C on Thu 24 Sep, outside 0°C to 5°C.')
    expect(metric(result, 'Readings out of range').value).toBe('1')
    expect(result.headline).toBe('Checks are mostly on track at 100% done, but 1 reading out of range and Thu 24 Sep not locked overnight.')
    const report = await reportFor(rows)
    expect(report.actions.map((action) => action.signalKey)).toContain(`checklists.breach.${reading.id as string}`)

    // A week later the lock has caught up and the day is last week: not reported again.
    const later = [...rows.map((row) => (row.locked_at === null ? { ...row, locked_at: '2026-09-26T04:01:00Z' } : row)), ...rangeRows('2026-09-25', '2026-10-01')]
    const nextFriday = await build(makeDb(later), new Date('2026-10-02T05:00:00Z'))
    expect(keys(nextFriday).filter((key) => key.startsWith('checklists.breach'))).toEqual([])
  })

  it('holds back the win and flags the gap when the sweep stalls part way through the week', async () => {
    // Locked to Monday; Tuesday to Thursday never locked, with 30 checks still pending past grace.
    const stalled = ['2026-09-22', '2026-09-23', '2026-09-24']
    const rows = [
      ...history(),
      ...rangeRows(THIS_WEEK_START, '2026-09-21'),
      ...stalled.flatMap((date) => [...dayRows(date, { locked: false }), ...pendingPastGrace(date, 10)]),
    ]
    const result = await build(makeDb(rows))

    expect(signal(result, 'checklists.on_track')).toBeUndefined()
    expect(keys(result)).toEqual(['checklists.not_locked'])
    expect(signal(result, 'checklists.not_locked')?.text).toBe(
      '150 checks from Tue 22 Sep, Wed 23 Sep and Thu 24 Sep were not locked overnight as expected, '
      + 'so those days are left out of this week\'s figures.',
    )
    expect(result.headline).toBe('Checks are mostly on track at 100% done, but 3 days not locked overnight.')
    expect(result.notes).toEqual([
      'Checks for Tue 22 Sep, Wed 23 Sep and Thu 24 Sep should have locked overnight and have not, so those days are left out.',
    ])
    // The four counted days still show their real figures.
    expect(metric(result, 'Completion').value).toBe('100%')
    expect(metric(result, 'Missed').value).toBe('0')
    expect(list(result, 'This week by day').items.map((item) => item.text)).toEqual([
      'Fri 18 Sep: 100% (40 done, 0 missed, 0 late)',
      'Sat 19 Sep: 100% (40 done, 0 missed, 0 late)',
      'Sun 20 Sep: 100% (40 done, 0 missed, 0 late)',
      'Mon 21 Sep: 100% (40 done, 0 missed, 0 late)',
      'Tue 22 Sep: not locked overnight',
      'Wed 23 Sep: not locked overnight',
      'Thu 24 Sep: not locked overnight',
    ])
    expect((await reportFor(rows)).sections[0].status).toBe('amber')
  })

  it('names up to two late days in the headline and in the action counts days', async () => {
    const rows = [
      ...history(),
      ...rangeRows(THIS_WEEK_START, '2026-09-22'),
      ...dayRows('2026-09-23', { locked: false }),
      ...dayRows('2026-09-24', { locked: false }),
    ]
    const result = await build(makeDb(rows))
    expect(result.headline).toBe('Checks are mostly on track at 100% done, but Wed 23 Sep and Thu 24 Sep not locked overnight.')
    expect(signal(result, 'checklists.not_locked')?.action?.text).toBe('Have the overnight checklist lock checked: 2 days not locked')
  })

  it('treats 05:30 London the next morning as the moment an unlocked day becomes a fault, in summer time', async () => {
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, '2026-09-23'), ...dayRows('2026-09-24', { locked: false })]
    // 05:29 BST: the sweep may still land.
    const early = await build(makeDb(rows), new Date('2026-09-25T04:29:00Z'))
    expect(signal(early, 'checklists.not_locked')).toBeUndefined()
    expect(early.notes).toEqual(['Checks for Thu 24 Sep are not locked yet, so that day is left out.'])
    expect(signal(early, 'checklists.on_track')).toBeUndefined()
    // 05:30 BST: it should have.
    const due = await build(makeDb(rows), new Date('2026-09-25T04:30:00Z'))
    expect(signal(due, 'checklists.not_locked')).toBeDefined()
  })

  it('uses the London clock for the 05:30 deadline in winter time too', async () => {
    // Friday 30 Oct 2026, GMT: this week 23 to 29 Oct, with Thursday 29 Oct not locked.
    const rows = [...rangeRows('2026-09-04', '2026-10-28'), ...dayRows('2026-10-29', { locked: false })]
    const early = await build(makeDb(rows), new Date('2026-10-30T05:29:00Z'))
    expect(signal(early, 'checklists.not_locked')).toBeUndefined()
    const due = await build(makeDb(rows), new Date('2026-10-30T05:30:00Z'))
    expect(signal(due, 'checklists.not_locked')?.text)
      .toBe('40 checks from Thu 29 Oct were not locked overnight as expected, so that day is left out of this week\'s figures.')
  })

  it('waits for the next morning when a check\'s grace runs out after the sweep', async () => {
    // An any-time check from Wednesday whose grace ends at 06:00 Friday, after the 05:00 sweep.
    const lateGrace = instance('2026-09-23', {
      state: 'pending',
      slot: 'anytime',
      completed_by_employee_id: null,
      completed_at: null,
      accountable_employee_id: null,
      locked_at: null,
      grace_until: '2026-09-25T05:00:00Z',
    })
    const rows = [...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END), lateGrace]
    // Friday 06:30: past grace, but no sweep is due until Saturday 05:00.
    const friday = await build(makeDb(rows), new Date('2026-09-25T05:30:00Z'))
    expect(signal(friday, 'checklists.not_locked')).toBeUndefined()
    expect(friday.notes).toEqual(['Checks for Wed 23 Sep are not locked yet, so that day is left out.'])
    // Saturday 05:30: the Saturday sweep should have made it missed.
    const saturday = await build(makeDb(rows), new Date('2026-09-26T04:30:00Z'))
    expect(signal(saturday, 'checklists.not_locked')?.text)
      .toBe('1 check from Wed 23 Sep was not locked overnight as expected, so that day is left out of this week\'s figures.')
  })

  it('keeps staff names out of the sweep signal and its action', async () => {
    const rows = [
      ...history(),
      ...rangeRows(THIS_WEEK_START, '2026-09-21'),
      ...dayRows('2026-09-19', { done: 0, missed: 3, accountable: 'emp-b' }),
      ...dayRows('2026-09-22', { locked: false, completer: 'emp-c', accountable: 'emp-c' }),
    ]
    const result = await build(makeDb(rows))
    expect(signal(result, 'checklists.not_locked')).toBeDefined()
    const visible = emailVisibleText(result)
    for (const token of NAME_TOKENS) expect(visible).not.toContain(token)
  })
})

describe('checklists section: empty and immature states', () => {
  it('says completion cannot be judged and raises amber when an open week has no records', async () => {
    const result = await build(makeDb([]))
    expect(result.headline).toBe('No checklist records this week, so completion cannot be judged.')
    expect(keys(result)).toEqual(['checklists.no_records'])
    expect(signal(result, 'checklists.no_records')).toMatchObject({
      rag: 'amber',
      kind: 'issue',
      emailSafe: true,
      action: { href: `${TEST_APP_URL}/checklists/manage`, target: 'list' },
    })
    expect(result.notes).toContain('No checklist records for any day this week.')
    expect(metric(result, 'Completion')).toMatchObject({ value: 'No records', comparison: 'no earlier records to compare' })
    // Nothing was recorded, so missed and late are unknown rather than 0.
    expect(metric(result, 'Missed').value).toBe('No records')
    expect(metric(result, 'Done late')).toEqual({ label: 'Done late', value: 'No records' })
    expect(metric(result, 'Readings out of range').value).toBe('No records')
    expect(metric(result, 'Misses with no accountable person').value).toBe('No records')
    expect(metric(result, 'Spot checks recorded')).toEqual({ label: 'Spot checks recorded', value: 'No records' })
    expect(metric(result, 'Completion, last 8 weeks').value).toBe('none, none, none, none, none, none, none, none')
    expect(list(result, 'Missed this week')).toMatchObject({ items: [], emptyText: 'Nothing was missed this week.' })
    expectCleanOutput(result)
  })

  it('says the venue was closed when every empty day was closed', async () => {
    const db = makeDb([])
    db.rpcHandlers.business_hours_for_date = () => [{ opens: null, closes: null, is_closed: true }]
    const result = await build(db)
    expect(result.headline).toBe('The venue was closed all week, so no checks were due.')
    expect(result.signals).toEqual([])
    expect(result.notes).toEqual([])
  })

  it('says every check was skipped rather than printing a rate', async () => {
    const rows = rangeRows(THIS_WEEK_START, THIS_WEEK_END, { done: 0, skipped: 4 })
    const result = await build(makeDb(rows))
    expect(result.headline).toBe('No checks counted this week: every check was skipped.')
    expect(metric(result, 'Completion').value).toBe('None due')
    expect(result.signals).toEqual([])
    expect(list(result, 'This week by day').items[0].text).toBe('Fri 18 Sep: no checks counted')
  })

  it('shows not enough history before the checklists began', async () => {
    // Friday 24 Jul 2026: this week 17 to 23 Jul straddles the 19 Jul start.
    const rows = rangeRows('2026-07-19', '2026-07-23', { done: 40, missed: 1, accountable: null })
    const result = await build(makeDb(rows), new Date('2026-07-24T05:00:00Z'))
    expect(metric(result, 'Completion').comparison).toBe('not enough history yet')
    expect(metric(result, 'Missed').comparison).toBe('not enough history yet')
    expect(result.notes).toContain('Checklist records begin on 19 Jul 2026, so the 4-week figures cover a shorter period.')
    expect(metric(result, 'Completion, last 8 weeks').value).toBe('none, none, none, none, none, none, none, 97.5%')
    // Friday and Saturday before the start have no records while open, so they are noted.
    expect(result.notes[0]).toBe('No checklist records for Fri 17 Jul and Sat 18 Jul, so this week\'s completion covers 5 days.')
    expectCleanOutput(result)
  })

  it('compares with last week only once the 4-week baseline predates the start', async () => {
    // Friday 7 Aug: last week (24 to 30 Jul) is covered, the 4 weeks before (3 to 30 Jul) are not.
    const rows = rangeRows('2026-07-19', '2026-08-06')
    const result = await build(makeDb(rows), new Date('2026-08-07T05:00:00Z'))
    expect(metric(result, 'Completion').comparison).toBe('last week 100%')
    expect(metric(result, 'Missed').comparison).toBe('last week 0')
  })
})

describe('checklists section: clock changes and failure', () => {
  it('keeps seven trading dates in the week containing the October clock change', async () => {
    // Friday 30 Oct 2026 06:00 GMT: this week 23 to 29 Oct includes Sunday 25 Oct.
    const rows = rangeRows('2026-09-04', '2026-10-29')
    const result = await build(makeDb(rows), new Date('2026-10-30T06:00:00Z'))
    const days = list(result, 'This week by day').items.map((item) => item.text)
    expect(days).toHaveLength(7)
    expect(days[2]).toBe('Sun 25 Oct: 100% (40 done, 0 missed, 0 late)')
    expect(result.notes).toEqual([])
  })

  it('keeps seven trading dates in the week containing the March clock change', async () => {
    // Friday 2 Apr 2027 06:00 BST: this week 26 Mar to 1 Apr includes Sunday 28 Mar.
    const rows = rangeRows('2027-02-05', '2027-04-01')
    const result = await build(makeDb(rows), new Date('2027-04-02T05:00:00Z'))
    const days = list(result, 'This week by day').items.map((item) => item.text)
    expect(days).toHaveLength(7)
    expect(days[2]).toBe('Sun 28 Mar: 100% (40 done, 0 missed, 0 late)')
  })

  it('throws when the checklist data cannot be read, so the engine marks it not checked', async () => {
    const db = makeDb([...history()]).fail('checklist_task_instances')
    await expect(build(db)).rejects.toThrow(/insights checklist instances failed/)
    const report = await buildInsightsReport({
      createDb: () => db.asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: TEST_APP_URL,
      sections: [checklistsSection],
      logFailure: () => undefined,
    })
    expect(report.sections[0]).toMatchObject({ key: 'checklists', status: 'not_checked' })
  })

  it('throws when the staff names cannot be read', async () => {
    const db = makeDb([...history(), ...rangeRows(THIS_WEEK_START, THIS_WEEK_END)]).fail('employees')
    await expect(build(db)).rejects.toThrow(/staff names failed/)
  })

  it('gives a red section through the engine when completion is low, with one action per rule', async () => {
    const rows = [
      ...history(),
      ...rangeRows(THIS_WEEK_START, THIS_WEEK_END, { done: 30, missed: 5, accountable: 'emp-b' }),
    ]
    const report = await buildInsightsReport({
      createDb: () => makeDb(rows).asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: TEST_APP_URL,
      sections: [checklistsSection],
      logFailure: () => undefined,
    })
    const section = report.sections[0]
    expect(section.status).toBe('red')
    expect(section.signals.slice(0, 3).map((item) => item.key)).toEqual([
      'checklists.completion.low',
      'checklists.repeat_missers',
      'checklists.repeat_misser.emp-b',
    ])
    expect(report.actions.map((action) => action.signalKey)).toEqual(['checklists.completion.low', 'checklists.repeat_missers'])
    for (const action of report.actions) for (const token of NAME_TOKENS) expect(action.text).not.toContain(token)
  })
})
