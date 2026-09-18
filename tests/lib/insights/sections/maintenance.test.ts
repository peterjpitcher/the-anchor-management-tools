import { describe, expect, it } from 'vitest'
import { buildInsightsReport } from '@/lib/insights/engine'
import { buildMaintenanceSection, maintenanceSection } from '@/lib/insights/sections/maintenance'
import { MAINTENANCE } from '@/lib/insights/thresholds'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { TEST_APP_URL, makeContext } from '../helpers/context'

// Default report instant: Friday 25 Sep 2026, 06:00 London. Today is 2026-09-25 and
// "this week" is Fri 18 Sep to Thu 24 Sep.
const APP = TEST_APP_URL

const AREAS = [
  { id: 'area-bar', name: 'Main Bar' },
  { id: 'area-ladies', name: 'Toilets (Ladies)' },
  { id: 'area-kitchen', name: 'Kitchen' },
  { id: 'area-exterior', name: 'Exterior and Building' },
  { id: 'area-other', name: 'Other' },
  { id: 'area-patio', name: 'Patio' },
]

let sequence = 0

interface ItemFixture {
  id?: string
  title?: string
  kind?: 'issue' | 'improvement'
  status?: string
  priority?: 'critical' | 'high' | 'medium' | 'low'
  responsibility?: 'us' | 'greene_king' | 'to_confirm'
  area_id?: string
  reported_on?: string
  target_date?: string | null
  completed_on?: string | null
}

function item(overrides: ItemFixture = {}): Record<string, unknown> {
  sequence += 1
  const id = overrides.id ?? `item-${String(sequence).padStart(3, '0')}`
  return {
    id,
    reference: `MNT-${sequence}`,
    title: `Job ${sequence}`,
    kind: 'issue',
    status: 'reported',
    priority: 'medium',
    responsibility: 'us',
    area_id: 'area-bar',
    reported_on: '2026-09-06',
    target_date: null,
    completed_on: null,
    // Columns the section must never read or print.
    description: 'Private description text',
    contractor_name: 'Contractor Person',
    contractor_contact: '07700 900123',
    created_by_email: 'someone@example.test',
    ...overrides,
  }
}

function db(items: Record<string, unknown>[], areas = AREAS): FakeDb {
  return new FakeDb({ maintenance_items: items, maintenance_areas: areas })
}

async function build(items: Record<string, unknown>[], now?: Date): Promise<SectionBuildResult> {
  return buildMaintenanceSection(makeContext(db(items), now))
}

function signalByKey(result: SectionBuildResult, key: string): InsightSignal {
  const found = result.signals.find((signal) => signal.key === key)
  if (!found) throw new Error(`No signal ${key}; have ${result.signals.map((signal) => signal.key).join(', ')}`)
  return found
}

function metric(result: SectionBuildResult, label: string): { value: string; comparison?: string } {
  const found = result.metrics.find((entry) => entry.label === label)
  if (!found) throw new Error(`No metric ${label}`)
  return found
}

function list(result: SectionBuildResult, title: string): SectionBuildResult['lists'][number] {
  const found = result.lists.find((entry) => entry.title === title)
  if (!found) throw new Error(`No list ${title}`)
  return found
}

function expectPrintable(result: SectionBuildResult): void {
  const json = JSON.stringify(result)
  expect(json).not.toMatch(/undefined|NaN|Invalid Date/)
  expect(json).not.toContain(String.fromCharCode(0x2014))
  expect(json).not.toContain('!')
}

describe('maintenance section', () => {
  it('is registered as the maintenance section', () => {
    expect(maintenanceSection).toMatchObject({ key: 'maintenance', title: 'Maintenance', path: '/maintenance' })
  })

  it('reads only maintenance items and areas, once each', async () => {
    const fake = db([item()])
    await buildMaintenanceSection(makeContext(fake))
    expect(fake.calls.map((call) => call.table).sort()).toEqual(['maintenance_areas', 'maintenance_items'])
  })

  it('fails loudly when the items cannot be read', async () => {
    await expect(buildMaintenanceSection(makeContext(db([item()]).fail('maintenance_items')))).rejects.toThrow(/maintenance items/)
  })

  it('handles an empty tracker', async () => {
    const result = await build([])
    expect(result.headline).toBe('No open maintenance jobs. Nothing new or closed this week.')
    expect(result.signals).toEqual([
      { key: 'maintenance.all_clear', rag: 'green', kind: 'info', text: 'No new or overdue issues.', emailSafe: true },
    ])
    expect(metric(result, 'Open')).toEqual({ label: 'Open', value: '0' })
    expect(metric(result, 'Overdue')).toEqual({ label: 'Overdue', value: '0' })
    expect(result.metrics.find((entry) => entry.label === 'Oldest open')).toBeUndefined()
    expect(result.lists.map((entry) => [entry.title, entry.items.length])).toEqual([
      ['Critical and high', 0],
      ['Overdue', 0],
      ['New this week', 0],
      ['Closed this week', 0],
      ['All open jobs', 0],
    ])
    expect(list(result, 'Overdue').emptyText).toBe('Nothing is overdue.')
    expect(result.notes).toEqual([])
    expectPrintable(result)
  })

  describe('signals', () => {
    it('red: a critical job open, with its overdue days folded into the one line', async () => {
      const result = await build([
        item({ id: 'crit', title: 'Soil pipe leak', priority: 'critical', area_id: 'area-ladies', target_date: '2026-09-15', reported_on: '2025-04-28' }),
      ])
      expect(result.signals).toHaveLength(1)
      const signal = signalByKey(result, 'maintenance.critical_open.crit')
      expect(signal).toEqual({
        key: 'maintenance.critical_open.crit',
        entity: 'maintenance:crit',
        rag: 'red',
        kind: 'issue',
        text: 'Critical job open: Soil pipe leak. Toilets (Ladies), reported, 10 days overdue, our responsibility.',
        emailSafe: true,
        action: {
          text: 'Fix the critical job: Soil pipe leak, Toilets (Ladies)',
          href: `${APP}/maintenance/crit`,
          target: 'record',
          dueDate: '2026-09-15',
          impact: 'safety',
        },
      })
      expectPrintable(result)
    })

    it('red: a critical job with Greene King asks the reader to chase them, with no due date when none is set', async () => {
      const result = await build([
        item({ id: 'crit', title: 'Roof leak', priority: 'critical', status: 'awaiting_landlord', area_id: 'area-exterior' }),
      ])
      const signal = signalByKey(result, 'maintenance.critical_open.crit')
      expect(signal.text).toBe('Critical job open: Roof leak. Exterior and Building, with Greene King, open 19 days, our responsibility.')
      expect(signal.action?.text).toBe('Chase Greene King on the critical job: Roof leak, Exterior and Building')
      expect(signal.action).not.toHaveProperty('dueDate')
    })

    it('red: a high-priority job past its target date', async () => {
      const result = await build([
        item({ id: 'high', title: 'Broken step', priority: 'high', target_date: '2026-09-24', area_id: 'area-bar' }),
      ])
      const signal = signalByKey(result, 'maintenance.high_overdue.high')
      expect(signal.rag).toBe('red')
      expect(signal.text).toBe('High-priority job overdue: Broken step. Main Bar, reported, 1 day overdue, our responsibility.')
      expect(signal.action).toMatchObject({
        text: 'Finish or re-date the overdue high-priority job: Broken step, Main Bar',
        target: 'record',
        dueDate: '2026-09-24',
        impact: 'safety',
      })
    })

    it('amber: another overdue job, customer impact in a customer-facing area, housekeeping elsewhere', async () => {
      const result = await build([
        item({ id: 'med', title: 'Dripping tap', priority: 'medium', area_id: 'area-ladies', target_date: '2026-09-20' }),
        item({ id: 'low', title: 'Shelf bracket', priority: 'low', area_id: 'area-kitchen', target_date: '2026-09-01', responsibility: 'greene_king' }),
      ])
      const medium = signalByKey(result, 'maintenance.overdue.med')
      expect(medium.rag).toBe('amber')
      expect(medium.text).toBe('Overdue job: Dripping tap. Toilets (Ladies), reported, 5 days overdue, our responsibility.')
      expect(medium.action).toMatchObject({ text: 'Finish or re-date the overdue job: Dripping tap, Toilets (Ladies)', impact: 'customer', dueDate: '2026-09-20' })
      const low = signalByKey(result, 'maintenance.overdue.low')
      expect(low.text).toContain("24 days overdue, Greene King's responsibility.")
      expect(low.action).toMatchObject({ text: 'Chase Greene King on the overdue job: Shelf bracket, Kitchen', impact: 'housekeeping' })
    })

    it('amber: a high-priority job open and not overdue; due today is not overdue', async () => {
      // Three like signals merge, so the per-item wording is checked through the members.
      const three = await build([
        item({ id: 'today', title: 'Gutter', priority: 'high', target_date: '2026-09-25' }),
        item({ id: 'undated', title: 'Damp wall', priority: 'high' }),
        item({ id: 'confirm', title: 'Fence panel', priority: 'high', responsibility: 'to_confirm' }),
      ])
      expect(three.signals).toHaveLength(1)
      expect(signalByKey(three, 'maintenance.high_open').action?.members).toEqual([
        // Dated before undated, then by id.
        'Plan the high-priority job: Gutter, Main Bar',
        'Confirm who owns the high-priority job: Fence panel, Main Bar',
        'Set a target date for the high-priority job: Damp wall, Main Bar',
      ])
      const two = await build([
        item({ id: 'today', title: 'Gutter', priority: 'high', target_date: '2026-09-25' }),
        item({ id: 'third', title: 'Street light', priority: 'high', status: 'with_third_party', target_date: '2026-10-10' }),
      ])
      expect(signalByKey(two, 'maintenance.high_open.today')).toMatchObject({
        rag: 'amber',
        text: 'High-priority job open: Gutter. Main Bar, reported, open 19 days, our responsibility.',
        action: { text: 'Plan the high-priority job: Gutter, Main Bar', target: 'record', dueDate: '2026-09-25', impact: 'safety' },
      })
      expect(signalByKey(two, 'maintenance.high_open.third').action?.text).toBe('Chase the third party on the high-priority job: Street light, Main Bar')
      expect(two.signals.every((signal) => signal.rag === 'amber' && signal.kind === 'issue')).toBe(true)
    })

    it('medium and low jobs that are not overdue raise nothing', async () => {
      const result = await build([
        item({ priority: 'medium', target_date: '2026-10-01' }),
        item({ priority: 'low', kind: 'improvement' }),
      ])
      expect(result.signals.map((signal) => signal.key)).toEqual(['maintenance.all_clear'])
    })

    it('gives one signal per record, in precedence order', async () => {
      const result = await build([
        item({ id: 'a', priority: 'high', target_date: '2026-10-01' }),
        item({ id: 'b', priority: 'low', target_date: '2026-09-01' }),
        item({ id: 'c', priority: 'critical', target_date: '2026-09-01' }),
        item({ id: 'd', priority: 'high', target_date: '2026-09-02' }),
      ])
      expect(result.signals.map((signal) => signal.key)).toEqual([
        'maintenance.critical_open.c',
        'maintenance.high_overdue.d',
        'maintenance.overdue.b',
        'maintenance.high_open.a',
      ])
      expect(new Set(result.signals.map((signal) => signal.entity)).size).toBe(4)
    })

    it(`merges more than ${MAINTENANCE.mergeAbove} like signals into one list action on the narrowest list`, async () => {
      const result = await build([
        item({ id: 'c1', title: 'C one', priority: 'critical' }),
        item({ id: 'c2', title: 'C two', priority: 'critical' }),
        item({ id: 'c3', title: 'C three', priority: 'critical' }),
        item({ id: 'h1', title: 'H one', priority: 'high', target_date: '2026-09-10' }),
        item({ id: 'h2', title: 'H two', priority: 'high', target_date: '2026-09-11' }),
        item({ id: 'h3', title: 'H three', priority: 'high', target_date: '2026-09-12' }),
        item({ id: 'o1', title: 'O one', priority: 'low', target_date: '2026-09-20' }),
        item({ id: 'o2', title: 'O two', priority: 'medium', target_date: '2026-09-08', area_id: 'area-ladies' }),
        item({ id: 'o3', title: 'O three', priority: 'low', target_date: '2026-09-21' }),
        item({ id: 'p1', title: 'P one', priority: 'high', target_date: '2026-10-20' }),
        item({ id: 'p2', title: 'P two', priority: 'high', target_date: '2026-10-05' }),
        item({ id: 'p3', title: 'P three', priority: 'high' }),
      ])
      expect(result.signals.map((signal) => signal.key)).toEqual([
        'maintenance.critical_open',
        'maintenance.high_overdue',
        'maintenance.overdue',
        'maintenance.high_open',
      ])
      expect(signalByKey(result, 'maintenance.critical_open')).toMatchObject({
        rag: 'red',
        text: '3 critical jobs are open.',
        emailSafe: true,
        action: { text: 'Deal with 3 critical jobs', href: `${APP}/maintenance?priority=critical`, target: 'list', impact: 'safety' },
      })
      expect(signalByKey(result, 'maintenance.high_overdue')).toMatchObject({
        rag: 'red',
        text: '3 high-priority jobs are overdue.',
        action: {
          text: 'Finish or re-date 3 overdue high-priority jobs',
          href: `${APP}/maintenance?priority=high&overdue=true`,
          target: 'list',
          dueDate: '2026-09-10',
        },
      })
      const overdue = signalByKey(result, 'maintenance.overdue')
      expect(overdue).toMatchObject({
        rag: 'amber',
        text: '3 other jobs are overdue.',
        action: { href: `${APP}/maintenance?overdue=true`, target: 'list', dueDate: '2026-09-08', impact: 'customer' },
      })
      expect(overdue.action?.members).toHaveLength(3)
      expect(overdue.action?.members).toContain('Finish or re-date the overdue job: O two, Toilets (Ladies)')
      expect(signalByKey(result, 'maintenance.high_open')).toMatchObject({
        rag: 'amber',
        text: '3 high-priority jobs are open.',
        action: { text: 'Plan 3 open high-priority jobs', href: `${APP}/maintenance?priority=high`, target: 'list', dueDate: '2026-10-05' },
      })
      // Merged signals carry no entity, so they never collide with record-level signals.
      expect(result.signals.every((signal) => signal.entity === undefined)).toBe(true)
    })

    it(`amber: nothing marked done in ${MAINTENANCE.nothingDoneWeeks} weeks with ${MAINTENANCE.nothingDoneMinimumOpen} or more open`, async () => {
      // Friday 8 Jan 2027: the look-back starts 9 Oct 2026, after the tracker began.
      const later = new Date('2027-01-08T06:00:00Z')
      const openItems = Array.from({ length: 10 }, () => item({ priority: 'low', kind: 'improvement', reported_on: '2026-10-01' }))
      const result = await build(openItems, later)
      expect(signalByKey(result, 'maintenance.nothing_done')).toEqual({
        key: 'maintenance.nothing_done',
        rag: 'amber',
        kind: 'issue',
        text: 'Nothing has been marked done in 13 weeks, with 10 jobs open.',
        emailSafe: true,
        action: {
          text: 'Close finished jobs so the list stays accurate',
          href: `${APP}/maintenance`,
          target: 'list',
          impact: 'housekeeping',
        },
      })
      expect(result.notes).toEqual([])

      const nine = await build(openItems.slice(0, 9), later)
      expect(nine.signals.map((signal) => signal.key)).not.toContain('maintenance.nothing_done')

      const doneRecently = await build([...openItems, item({ status: 'done', completed_on: '2026-12-01', reported_on: '2026-11-01' })], later)
      expect(doneRecently.signals.map((signal) => signal.key)).not.toContain('maintenance.nothing_done')

      const doneLongAgo = await build([...openItems, item({ status: 'done', completed_on: '2026-10-08', reported_on: '2026-09-10' })], later)
      expect(doneLongAgo.signals.map((signal) => signal.key)).toContain('maintenance.nothing_done')
    })

    it('does not raise "nothing done" before the tracker has 13 weeks of history; it says so instead', async () => {
      const openItems = Array.from({ length: 12 }, () => item({ priority: 'low', kind: 'improvement' }))
      const result = await build(openItems)
      expect(result.signals.map((signal) => signal.key)).not.toContain('maintenance.nothing_done')
      expect(result.notes).toEqual([
        'Not enough history yet to check for unclosed jobs: nothing has been marked done since the tracker started on 6 Sep 2026.',
      ])
      // No note when a job has been closed, because the check would not fire anyway.
      const withDone = await build([...openItems, item({ status: 'done', completed_on: '2026-09-20' })])
      expect(withDone.notes).toEqual([])
    })

    it('green: "No new or overdue issues" only when nothing is overdue, no issue is new and nothing else fired', async () => {
      const improvementOnly = await build([item({ kind: 'improvement', priority: 'low', reported_on: '2026-09-20' })])
      expect(improvementOnly.signals.map((signal) => signal.key)).toEqual(['maintenance.all_clear'])

      const newIssue = await build([item({ kind: 'issue', priority: 'low', reported_on: '2026-09-20' })])
      expect(newIssue.signals).toEqual([])

      const withHigh = await build([item({ id: 'hi', priority: 'high', target_date: '2026-10-10' })])
      expect(withHigh.signals.map((signal) => signal.key)).toEqual(['maintenance.high_open.hi'])
    })
  })

  describe('counts', () => {
    it('counts new, closed, open, overdue and undated items at the week boundaries', async () => {
      const result = await build([
        item({ id: 'n1', kind: 'issue', reported_on: '2026-09-18' }),
        item({ id: 'n2', kind: 'improvement', reported_on: '2026-09-24' }),
        item({ id: 'n3', kind: 'issue', reported_on: '2026-09-21', status: 'cancelled' }),
        item({ id: 'old', kind: 'issue', reported_on: '2026-09-17' }),
        item({ id: 'today', kind: 'issue', reported_on: '2026-09-25' }),
        item({ id: 'd1', kind: 'improvement', status: 'done', completed_on: '2026-09-20', reported_on: '2026-09-01' }),
        item({ id: 'd2', kind: 'issue', status: 'done', completed_on: '2026-09-10', reported_on: '2026-09-01' }),
        item({ id: 'od', kind: 'issue', reported_on: '2026-09-01', target_date: '2026-09-12' }),
      ])
      expect(metric(result, 'Open')).toEqual({ label: 'Open', value: '5', comparison: '4 issues, 1 improvement' })
      expect(metric(result, 'New this week')).toEqual({ label: 'New this week', value: '3', comparison: '2 issues, 1 improvement' })
      expect(metric(result, 'Closed this week')).toEqual({ label: 'Closed this week', value: '1', comparison: '0 issues, 1 improvement' })
      expect(metric(result, 'Overdue')).toEqual({ label: 'Overdue', value: '1', comparison: 'most overdue 13 days' })
      expect(metric(result, 'No target date')).toEqual({ label: 'No target date', value: '4' })
      expect(list(result, 'New this week').items.map((entry) => entry.href?.split('/').pop())).toEqual(['n2', 'n3', 'n1'])
      expect(list(result, 'Closed this week').items.map((entry) => entry.href?.split('/').pop())).toEqual(['d1'])
      expect(result.headline).toBe('5 open jobs: 0 critical, 0 high, 1 overdue. 3 new and 1 closed this week.')
    })

    it('puts the four most important figures first for the email', async () => {
      const result = await build([item()])
      expect(result.metrics.slice(0, 4).map((entry) => entry.label)).toEqual(['Open', 'Overdue', 'Critical and high', 'New this week'])
    })

    it('splits open jobs by responsibility, and by area type so the categories add up to the open total', async () => {
      const result = await build([
        item({ area_id: 'area-bar', responsibility: 'us' }),
        item({ area_id: 'area-ladies', responsibility: 'greene_king' }),
        item({ area_id: 'area-kitchen', responsibility: 'to_confirm' }),
        item({ area_id: 'area-exterior', responsibility: 'us' }),
        item({ area_id: 'area-other', responsibility: 'us' }),
        item({ area_id: 'area-patio', responsibility: 'us' }),
        item({ area_id: 'area-missing', responsibility: 'us' }),
        item({ area_id: 'area-bar', status: 'cancelled' }),
      ])
      expect(metric(result, 'Whose job').value).toBe('Us 5 · Greene King 1 · To confirm 1')
      expect(metric(result, 'By area type').value).toBe('Customer-facing 2 · Operations 1 · Building 1 · Other 3')
      const categoryTotal = metric(result, 'By area type').value.match(/\d+/g)?.map(Number).reduce((a, b) => a + b, 0)
      expect(categoryTotal).toBe(Number(metric(result, 'Open').value))
      expect(result.notes).toEqual(['Counted as other until the area is given a category: Patio.'])
      expect(list(result, 'All open jobs').items.some((entry) => entry.text.includes('Area unknown'))).toBe(true)
    })

    it('reports ageing: oldest open, whole-day median and most overdue', async () => {
      const result = await build([
        item({ reported_on: '2025-04-28', priority: 'low', target_date: '2025-06-01' }),
        item({ reported_on: '2026-09-15' }),
        item({ reported_on: '2026-09-20' }),
        item({ reported_on: '2026-09-24' }),
      ])
      // Ages 515, 10, 5 and 1 days: the median of 10 and 5 rounds to 8.
      expect(metric(result, 'Oldest open')).toEqual({ label: 'Oldest open', value: '515 days', comparison: 'median age 8 days' })
      expect(metric(result, 'Overdue').comparison).toBe('most overdue 481 days')
      expect(metric(result, 'Critical and high')).toEqual({ label: 'Critical and high', value: '0', comparison: '0 critical, 0 high' })
    })
  })

  describe('lists', () => {
    it('prints one structured line per job with a link to the job, most urgent first', async () => {
      const result = await build([
        item({ id: 'h', title: 'Loose handrail', priority: 'high', status: 'scheduled', target_date: '2026-10-02', reported_on: '2026-09-11' }),
        item({ id: 'c', title: 'Gas smell', priority: 'critical', status: 'in_progress', area_id: 'area-kitchen', target_date: '2026-09-22', reported_on: '2026-09-20', responsibility: 'to_confirm' }),
        item({ id: 'm', title: 'Scuffed door', priority: 'medium', area_id: 'area-ladies', responsibility: 'greene_king', reported_on: '2026-09-25' }),
        item({ id: 'x', title: 'New sign', kind: 'improvement', priority: 'low', status: 'done', completed_on: '2026-09-23', area_id: 'area-exterior', reported_on: '2026-09-19' }),
      ])
      expect(list(result, 'Critical and high').items).toEqual([
        { text: 'Gas smell · Kitchen · In progress · Critical · 3 days overdue · responsibility to confirm', href: `${APP}/maintenance/c`, rag: 'red' },
        { text: 'Loose handrail · Main Bar · Scheduled · High · open 14 days · our responsibility', href: `${APP}/maintenance/h`, rag: 'amber' },
      ])
      expect(list(result, 'Overdue').items.map((entry) => entry.href)).toEqual([`${APP}/maintenance/c`])
      expect(list(result, 'Closed this week').items).toEqual([
        { text: 'New sign · Exterior and Building · Done · Low · closed Wed 23 Sep · our responsibility', href: `${APP}/maintenance/x`, rag: 'green' },
      ])
      expect(list(result, 'All open jobs').collapsed).toBe(true)
      expect(result.lists.filter((entry) => entry.collapsed).map((entry) => entry.title)).toEqual(['All open jobs'])
      expect(list(result, 'All open jobs').items.map((entry) => entry.text)).toEqual([
        'Gas smell · Kitchen · In progress · Critical · 3 days overdue · responsibility to confirm',
        'Loose handrail · Main Bar · Scheduled · High · open 14 days · our responsibility',
        "Scuffed door · Toilets (Ladies) · Reported · Medium · reported today · Greene King's responsibility",
      ])
      // Gas smell and New sign were reported this week; Scuffed door was reported today, which is not this week.
      expect(result.headline).toBe('3 open jobs: 1 critical, 1 high, 1 overdue. 2 new and 1 closed this week.')
    })

    it('clips very long titles', async () => {
      const longTitle = `${'word '.repeat(60)}end`
      const result = await build([item({ id: 'long', title: longTitle, priority: 'critical' })])
      const signal = signalByKey(result, 'maintenance.critical_open.long')
      expect(signal.text.length).toBeLessThan(MAINTENANCE.titleChars + 100)
      expect(signal.text).toContain('...')
    })
  })

  describe('email safety', () => {
    it('never prints descriptions, contractor details or who logged a job, and every signal is email safe', async () => {
      const result = await build([
        item({ priority: 'critical', target_date: '2026-09-01' }),
        item({ priority: 'high', target_date: '2026-09-01' }),
        item({ priority: 'medium', target_date: '2026-09-01' }),
        item({ priority: 'high' }),
        item({ status: 'done', completed_on: '2026-09-21' }),
      ])
      const json = JSON.stringify(result)
      for (const secret of ['Private description text', 'Contractor Person', '07700 900123', 'someone@example.test']) {
        expect(json).not.toContain(secret)
      }
      expect(result.signals.length).toBeGreaterThan(0)
      expect(result.signals.every((signal) => signal.emailSafe)).toBe(true)
      for (const signal of result.signals) {
        if (signal.action) expect(signal.action.href.startsWith(`${APP}/maintenance`)).toBe(true)
      }
      expectPrintable(result)
    })
  })

  describe('dates', () => {
    it('uses London calendar dates across the October clock change', async () => {
      // Friday 30 Oct 2026, 06:00 GMT: this week is Fri 23 Oct to Thu 29 Oct, containing 25 Oct.
      const now = new Date('2026-10-30T06:00:00Z')
      const result = await build([
        item({ id: 'first', reported_on: '2026-10-23' }),
        item({ id: 'before', reported_on: '2026-10-22' }),
        item({ id: 'due', priority: 'high', target_date: '2026-10-29', reported_on: '2026-10-01' }),
      ], now)
      expect(metric(result, 'New this week').value).toBe('1')
      expect(signalByKey(result, 'maintenance.high_overdue.due').text).toContain('1 day overdue')
    })

    it('gives the same answer in any process time zone', async () => {
      const fixture = [
        item({ id: 'a', reported_on: '2026-09-18', priority: 'high', target_date: '2026-09-24' }),
        item({ id: 'b', status: 'done', completed_on: '2026-09-24' }),
      ]
      const result = await build(fixture, new Date('2026-09-24T23:30:00Z'))
      // 00:30 London on Friday 25 Sep: today is the 25th even though UTC is still the 24th.
      expect(signalByKey(result, 'maintenance.high_overdue.a').text).toContain('1 day overdue')
      expect(metric(result, 'Closed this week').value).toBe('1')
    })
  })

  it('produces a red section through the engine when a critical job is open', async () => {
    const fake = db([item({ priority: 'critical' }), item({ priority: 'low', target_date: '2026-09-01' })])
    const report = await buildInsightsReport({
      createDb: () => fake.asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: APP,
      sections: [maintenanceSection],
      logFailure: () => undefined,
    })
    const section = report.sections[0]
    expect(section.status).toBe('red')
    expect(section.href).toBe(`${APP}/maintenance`)
    expect(report.actions.map((action) => action.sectionKey)).toEqual(['maintenance', 'maintenance'])
    expect(report.actions[0].rag).toBe('red')
  })
})
