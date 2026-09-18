import { describe, expect, it } from 'vitest'
import { buildInsightsReport } from '@/lib/insights/engine'
import { buildRotaSection, rotaSection } from '@/lib/insights/sections/rota'
import { mondayOf } from '@/lib/insights/windows'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { makeContext, TEST_APP_URL } from '../helpers/context'

// makeContext: Friday 25 Sep 2026 06:00 London. Today 2026-09-25; this week 18 to 24 Sep;
// next 14 days 25 Sep to 8 Oct; open shifts are read to Thu 19 Nov (the 56th day);
// last 4 weeks 28 Aug to 24 Sep; last 13 weeks 26 Jun to 24 Sep. This week began Mon 21 Sep,
// next week begins Mon 28 Sep and the week after Mon 5 Oct.

type Row = Record<string, unknown>

const APP = TEST_APP_URL
const PUBLISHED_AT = '2026-09-10T10:00:00.000Z'

// Distinct names so a leak is easy to spot. Only the leave requester may reach the email.
const EMPLOYEES: Row[] = [
  { employee_id: 'emp-1', first_name: 'Rowena', last_name: 'Quill', preferred_name: null },
  { employee_id: 'emp-2', first_name: 'Bartholomew', last_name: 'Finch', preferred_name: null },
  { employee_id: 'emp-3', first_name: 'Constance', last_name: 'Marsh', preferred_name: null },
  { employee_id: 'emp-4', first_name: 'Lettice', last_name: 'Dunn', preferred_name: null },
  { employee_id: 'emp-5', first_name: 'Winifred', last_name: 'Hale', preferred_name: null },
]
const PAGE_ONLY_NAMES = ['Rowena', 'Bartholomew', 'Constance', 'Winifred', 'Quill', 'Finch', 'Marsh', 'Hale']

let sequence = 0
function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}-${sequence}`
}

function week(weekStart: string, overrides: Row = {}): Row {
  return { id: `week-${weekStart}`, week_start: weekStart, status: 'published', published_at: PUBLISHED_AT, has_unpublished_changes: false, ...overrides }
}

function draft(weekStart: string): Row {
  return week(weekStart, { status: 'draft', published_at: null })
}

function shift(date: string, overrides: Row = {}): Row {
  return {
    id: nextId('shift'),
    week_id: `week-${mondayOf(date)}`,
    employee_id: 'emp-1',
    shift_date: date,
    start_time: '18:00:00',
    end_time: '23:00:00',
    unpaid_break_minutes: 0,
    department: 'bar',
    status: 'scheduled',
    notes: null,
    is_overnight: false,
    is_open_shift: false,
    name: null,
    reassignment_reason: null,
    acceptance_status: 'accepted',
    ...overrides,
  }
}

function openShift(date: string, overrides: Row = {}): Row {
  return shift(date, { employee_id: null, is_open_shift: true, acceptance_status: null, ...overrides })
}

function snapshot(live: Row, overrides: Row = {}): Row {
  const { reassignment_reason: _reason, ...rest } = live
  return { ...rest, published_at: PUBLISHED_AT, ...overrides }
}

function rejection(of: Row, rejectedAt: string, overrides: Row = {}): Row {
  return {
    id: nextId('rej'),
    shift_id: of.id,
    employee_id: 'emp-3',
    week_id: of.week_id,
    shift_date: of.shift_date,
    start_time: of.start_time,
    end_time: of.end_time,
    unpaid_break_minutes: 0,
    department: of.department,
    notes: null,
    is_overnight: false,
    name: null,
    rejection_note: 'A private reason',
    rejected_at: rejectedAt,
    rejected_by: 'emp-3',
    created_at: rejectedAt,
    ...overrides,
  }
}

function event(eventType: string, eventAt: string, overrides: Row = {}): Row {
  const id = nextId('evt')
  return {
    id,
    employee_id: 'emp-1',
    event_type: eventType,
    event_at: eventAt,
    source: eventType === 'shift_auto_accepted' ? 'rota-shift-acceptance-cron' : eventType === 'couldnt_work' ? 'rota_couldnt_work' : 'portal_accept',
    shift_id: `${id}-shift`,
    shift_date: '2026-09-30',
    department: 'bar',
    impacted_shift_count: 1,
    ...overrides,
  }
}

const HEALTH_DETAIL = 'A private health detail'

/** A shift reopened by Couldn't Work, as markEmployeeCouldntWork leaves it. */
function reopened(date: string, overrides: Row = {}): Row {
  return openShift(date, { reassignment_reason: `Couldn't Work: ${HEALTH_DETAIL}`, ...overrides })
}

/**
 * Couldn't Work as the app records it: a 'sick' marker row that is always department 'bar',
 * and an event copying the marker (so its department is always 'bar' too) that lists the
 * shifts it reopened in metadata.impacted_shift_ids.
 */
function couldntWork(date: string, affected: Row[], overrides: Row = {}): { marker: Row; event: Row } {
  const marker = shift(date, {
    department: 'bar',
    status: 'sick',
    name: "Couldn't Work",
    start_time: '00:00:00',
    end_time: '00:00:00',
    acceptance_status: null,
  })
  return {
    marker,
    event: event('couldnt_work', `${date}T08:00:00.000Z`, {
      shift_id: marker.id,
      shift_date: date,
      department: 'bar',
      impacted_shift_count: affected.length,
      metadata: { impacted_shift_ids: affected.map((row) => row.id) },
      note: HEALTH_DETAIL,
      ...overrides,
    }),
  }
}

function leave(overrides: Row = {}): Row {
  return {
    id: nextId('lv'),
    employee_id: 'emp-4',
    start_date: '2026-12-01',
    end_date: '2026-12-01',
    status: 'pending',
    leave_type: 'holiday',
    note: 'A private note',
    created_at: '2026-09-22T09:00:00.000Z',
    ...overrides,
  }
}

interface Fixture {
  weeks?: Row[]
  live?: Row[]
  /** Defaults to a snapshot of every live shift in a published week. */
  published?: Row[]
  rejections?: Row[]
  events?: Row[]
  leave?: Row[]
}

function makeDb(fixture: Fixture = {}): FakeDb {
  const weeks = fixture.weeks ?? []
  const live = fixture.live ?? []
  const publishedWeekIds = new Set(weeks.filter((row) => row.status === 'published').map((row) => row.id))
  return new FakeDb({
    rota_weeks: weeks,
    rota_shifts: live,
    rota_published_shifts: fixture.published ?? live.filter((row) => publishedWeekIds.has(row.week_id)).map((row) => snapshot(row)),
    rota_shift_rejections: fixture.rejections ?? [],
    employee_reliability_events: fixture.events ?? [],
    leave_requests: fixture.leave ?? [],
    leave_types: [
      { code: 'holiday', label: 'Holiday', consumes_allowance: true, paid: true, shown_on_rota: true, counts_in_reliability: true, allowed_at_onboarding: true, sort_order: 1, is_active: true },
      { code: 'unavailable', label: 'Not available to work', consumes_allowance: false, paid: false, shown_on_rota: true, counts_in_reliability: false, allowed_at_onboarding: true, sort_order: 2, is_active: true },
    ],
    employees: EMPLOYEES,
    departments: [
      { name: 'bar', label: 'Bar', sort_order: 0 },
      { name: 'kitchen', label: 'Kitchen', sort_order: 1 },
    ],
  })
}

/** Published to Sun 11 Oct, the week of 12 Oct a draft, three staffed shifts in the next 14 days. */
function healthy(): Required<Pick<Fixture, 'weeks' | 'live'>> {
  return {
    weeks: [week('2026-09-21'), week('2026-09-28'), week('2026-10-05'), draft('2026-10-12')],
    live: [
      shift('2026-09-26'),
      shift('2026-09-30', { employee_id: 'emp-2', department: 'kitchen' }),
      shift('2026-10-06'),
    ],
  }
}

async function build(fixture: Fixture = {}, now?: Date): Promise<SectionBuildResult> {
  return buildRotaSection(makeContext(makeDb(fixture), now))
}

function byKey(result: SectionBuildResult, prefix: string): InsightSignal[] {
  return result.signals.filter((signal) => signal.key.startsWith(prefix))
}

function list(result: SectionBuildResult, title: string) {
  return result.lists.find((entry) => entry.title === title)
}

function metric(result: SectionBuildResult, label: string) {
  return result.metrics.find((entry) => entry.label === label)
}

/** Everything that can reach the emailed or printed report. */
function emailVisible(result: SectionBuildResult): string {
  const parts: string[] = [result.headline, ...result.notes]
  for (const entry of result.metrics) parts.push(entry.label, entry.value, entry.comparison ?? '')
  for (const signal of result.signals) {
    if (signal.emailSafe) parts.push(signal.text)
    if (signal.action) parts.push(signal.action.text, ...(signal.action.members ?? []))
  }
  return parts.join('\n')
}

function expectClean(result: SectionBuildResult): void {
  const json = JSON.stringify(result)
  expect(json).not.toMatch(/undefined|NaN|Invalid Date/)
}

describe('rota section', () => {
  it('is registered under the rota key with the rota page', () => {
    expect(rotaSection).toMatchObject({ key: 'rota', title: 'Rota, shifts and leave', path: '/rota' })
  })

  it('reports a healthy rota as covered and published, with a win', async () => {
    const result = await build(healthy())
    expect(result.headline).toBe('All shifts in the next 14 days covered; rota published to Sun 11 Oct; no leave waiting.')
    expect(result.signals).toEqual([
      { key: 'rota.all_covered', rag: 'green', kind: 'win', text: 'All shifts in the next 14 days are covered.', emailSafe: true },
    ])
    expect(result.metrics.slice(0, 4)).toEqual([
      { label: 'Open shifts, next 14 days', value: 'None', comparison: 'none from Fri 9 Oct to Thu 19 Nov' },
      { label: 'Rota published to', value: 'Sun 11 Oct', comparison: 'the week of Mon 12 Oct is a draft' },
      { label: 'Leave requests waiting', value: 'None' },
      { label: 'Awaiting acceptance, next 16 days', value: 'None' },
    ])
    expect(list(result, 'Open shifts, next 14 days')).toMatchObject({ items: [], emptyText: 'All shifts in the next 14 days are covered.' })
    expect(list(result, 'Leave requests waiting')?.items).toEqual([])
    expectClean(result)
  })

  it('handles an empty database: nothing planned, nothing published, no win and no invented figures', async () => {
    const result = await build()
    expect(result.headline).toBe("No shifts planned in the next 14 days; this week's rota not published; no leave waiting.")
    expect(result.signals.map((signal) => [signal.key, signal.rag])).toEqual([
      ['rota.week_not_published.2026-09-21', 'red'],
      ['rota.week_not_published.2026-09-28', 'red'],
      ['rota.week_not_published.2026-10-05', 'amber'],
    ])
    expect(result.signals[0].text).toBe('The rota for the week of Mon 21 Sep has not been started, so staff cannot see it.')
    expect(metric(result, 'Rota published to')).toEqual({ label: 'Rota published to', value: 'Not published', comparison: 'the week of Mon 21 Sep is not published' })
    expect(result.notes).toContain('No shift acceptances or rejections were recorded in the last 4 weeks.')
    expect(result.metrics.some((entry) => entry.label.startsWith('Accepted by staff'))).toBe(false)
    expect(metric(result, 'Rejections this week')?.value).toBe('None')
    expect(metric(result, "Couldn't-work shifts this week")?.value).toBe('None')
    expectClean(result)
  })

  describe('cover', () => {
    it('raises one open shift in the next 14 days as a red record action, naming the rejecter on the page only', async () => {
      const base = healthy()
      const open = openShift('2026-09-27', { reassignment_reason: 'Rejected by staff: A private reason' })
      const result = await build({
        ...base,
        live: [...base.live, open],
        rejections: [rejection(open, '2026-09-10T10:00:00.000Z')],
      })
      expect(byKey(result, 'rota.open_shift')).toEqual([{
        key: `rota.open_shift.${open.id}`,
        entity: `shift:${open.id}`,
        rag: 'red',
        kind: 'issue',
        text: 'Open shift on Sun 27 Sep, 18:00 to 23:00 (Bar) needs cover.',
        emailSafe: true,
        action: {
          text: 'Find cover for Sun 27 Sep, 18:00 to 23:00 (Bar)',
          href: `${APP}/rota?week=2026-09-21&shift=${open.id}`,
          target: 'record',
          dueDate: '2026-09-27',
          impact: 'staffing',
        },
      }])
      expect(byKey(result, 'rota.all_covered')).toEqual([])
      expect(result.headline).toBe('1 open shift in the next 14 days; rota published to Sun 11 Oct; no leave waiting.')
      expect(metric(result, 'Open shifts, next 14 days')?.value).toBe('1')
      expect(list(result, 'Open shifts, next 14 days')?.items).toEqual([{
        text: 'Sun 27 Sep, 18:00 to 23:00 (Bar): rejected by Constance',
        href: `${APP}/rota?week=2026-09-21&shift=${open.id}`,
        rag: 'red',
      }])
      expect(emailVisible(result)).not.toContain('Constance')
      expect(JSON.stringify(result)).not.toContain('A private reason')
    })

    it('merges several open shifts into one red list action for the reassign page, with name-free members', async () => {
      const base = healthy()
      const opens = [
        openShift('2026-09-26', { name: 'Bar close' }),
        openShift('2026-10-01', { department: 'kitchen', start_time: '12:00:00', end_time: '16:00:00' }),
        openShift('2026-09-27'),
      ]
      const result = await build({
        ...base,
        live: [...base.live, ...opens],
        rejections: [rejection(opens[2], '2026-09-11T10:00:00.000Z')],
      })
      const open = byKey(result, 'rota.open_shift')
      expect(open).toHaveLength(1)
      expect(open[0]).toMatchObject({
        key: 'rota.open_shifts',
        rag: 'red',
        kind: 'issue',
        text: '3 open shifts in the next 14 days need cover.',
        emailSafe: true,
        action: {
          text: 'Find cover for 3 open shifts in the next 14 days',
          href: `${APP}/rota/reassign`,
          target: 'list',
          dueDate: '2026-09-26',
          impact: 'staffing',
          members: [
            'Find cover for Sat 26 Sep, 18:00 to 23:00 (Bar)',
            'Find cover for Sun 27 Sep, 18:00 to 23:00 (Bar)',
            'Find cover for Thu 1 Oct, 12:00 to 16:00 (Kitchen)',
          ],
        },
      })
      expect(open[0].entity).toBeUndefined()
      expect(list(result, 'Open shifts, next 14 days')?.items.map((item) => item.text)).toEqual([
        'Sat 26 Sep, 18:00 to 23:00 (Bar), Bar close: never filled',
        'Sun 27 Sep, 18:00 to 23:00 (Bar): rejected by Constance',
        'Thu 1 Oct, 12:00 to 16:00 (Kitchen): never filled',
      ])
      expect(emailVisible(result)).not.toContain('Constance')
    })

    it("says why each open shift is open from the reason's prefix only, never its free text", async () => {
      const base = healthy()
      // Rejected by Constance, covered, then reopened by Couldn't Work: the old rejection is not why.
      const reopenedShift = reopened('2026-09-26', { department: 'kitchen' })
      const { marker, event: cwEvent } = couldntWork('2026-09-26', [reopenedShift])
      const released = openShift('2026-09-27', { reassignment_reason: 'Released during employee separation' })
      // Rejected, though the rejection row itself was not found.
      const rejectedNoRow = openShift('2026-09-28', { reassignment_reason: 'Rejected by staff: A private reason' })
      const neverFilled = openShift('2026-09-29')
      const result = await build({
        ...base,
        live: [...base.live, marker, reopenedShift, released, rejectedNoRow, neverFilled],
        rejections: [rejection(reopenedShift, '2026-09-12T10:00:00.000Z')],
        events: [cwEvent],
      })
      expect(list(result, 'Open shifts, next 14 days')?.items.map((item) => item.text)).toEqual([
        "Sat 26 Sep, 18:00 to 23:00 (Kitchen): reopened because the person rostered couldn't work",
        'Sun 27 Sep, 18:00 to 23:00 (Bar): released when a staff member left',
        'Mon 28 Sep, 18:00 to 23:00 (Bar): rejected by a staff member',
        'Tue 29 Sep, 18:00 to 23:00 (Bar): never filled',
      ])
      // The marker row is not a shift that needs cover.
      expect(metric(result, 'Open shifts, next 14 days')?.value).toBe('4')
      const json = JSON.stringify(result)
      expect(json).not.toContain(HEALTH_DETAIL)
      expect(json).not.toContain('A private reason')
      expect(json).not.toContain('Constance')
      expect(result.notes).toEqual([])
    })

    it('counts an open shift in a week not yet published, and says so on the page', async () => {
      const base = healthy()
      const weeks = [week('2026-09-21'), week('2026-09-28'), draft('2026-10-05')]
      const open = openShift('2026-10-07')
      const result = await build({ weeks, live: [...base.live, open] })
      expect(byKey(result, 'rota.open_shift').map((signal) => signal.rag)).toEqual(['red'])
      expect(byKey(result, 'rota.week_not_published').map((signal) => [signal.key, signal.rag])).toEqual([
        ['rota.week_not_published.2026-10-05', 'amber'],
      ])
      expect(list(result, 'Open shifts, next 14 days')?.items[0].text).toBe('Wed 7 Oct, 18:00 to 23:00 (Bar): never filled (week not published yet)')
    })

    it('counts open shifts from day 15 to day 56 as one amber list action, and ignores shifts beyond', async () => {
      const base = healthy()
      const result = await build({
        ...base,
        live: [...base.live, openShift('2026-10-20'), openShift('2026-11-19'), openShift('2026-11-20'), openShift('2026-10-09', { status: 'cancelled' })],
      })
      expect(byKey(result, 'rota.open_shifts_later')).toEqual([{
        key: 'rota.open_shifts_later',
        rag: 'amber',
        kind: 'issue',
        text: '2 more open shifts from Fri 9 Oct to Thu 19 Nov need cover, the first on Tue 20 Oct.',
        emailSafe: true,
        action: {
          text: 'Find cover for 2 open shifts from Tue 20 Oct',
          href: `${APP}/rota/reassign`,
          target: 'list',
          dueDate: '2026-10-20',
          impact: 'staffing',
        },
      }])
      expect(metric(result, 'Open shifts, next 14 days')).toEqual({ label: 'Open shifts, next 14 days', value: 'None', comparison: 'plus 2 from Fri 9 Oct to Thu 19 Nov' })
      expect(byKey(result, 'rota.all_covered')).toHaveLength(1)
    })

    it('treats day 14 as the last day of the next 14 days', async () => {
      const base = healthy()
      const result = await build({ ...base, live: [...base.live, openShift('2026-10-08'), openShift('2026-10-09')] })
      expect(byKey(result, 'rota.open_shift.')).toHaveLength(1)
      expect(byKey(result, 'rota.open_shift.')[0].action?.dueDate).toBe('2026-10-08')
      expect(byKey(result, 'rota.open_shifts_later')[0].text).toContain('the first on Fri 9 Oct')
    })

    it('marks the section not checked when open shifts cannot be read', async () => {
      const fake = makeDb(healthy()).fail('rota_shifts')
      await expect(buildRotaSection(makeContext(fake))).rejects.toThrow()
    })
  })

  describe('publishing', () => {
    it('raises next week not published as red with a record action due the day before', async () => {
      const result = await build({ weeks: [week('2026-09-21'), draft('2026-09-28'), draft('2026-10-05')], live: healthy().live })
      const signals = byKey(result, 'rota.week_not_published')
      expect(signals.map((signal) => [signal.key, signal.rag])).toEqual([
        ['rota.week_not_published.2026-09-28', 'red'],
        ['rota.week_not_published.2026-10-05', 'amber'],
      ])
      expect(signals[0]).toEqual({
        key: 'rota.week_not_published.2026-09-28',
        entity: 'rota_week:2026-09-28',
        rag: 'red',
        kind: 'issue',
        text: 'The rota for the week of Mon 28 Sep is still a draft, so staff cannot see it.',
        emailSafe: true,
        action: {
          text: 'Publish the rota for the week of Mon 28 Sep',
          href: `${APP}/rota?week=2026-09-28`,
          target: 'record',
          dueDate: '2026-09-27',
          impact: 'staffing',
        },
      })
      expect(signals[1].action?.dueDate).toBe('2026-10-04')
      expect(result.headline).toContain('rota published to Sun 27 Sep')
      expect(metric(result, 'Rota published to')).toEqual({ label: 'Rota published to', value: 'Sun 27 Sep', comparison: 'weeks from Mon 28 Sep are drafts' })
    })

    it('says when a later week is published ahead of an unpublished one', async () => {
      const result = await build({ weeks: [week('2026-09-21'), draft('2026-09-28'), week('2026-10-05')] })
      expect(metric(result, 'Rota published to')?.comparison).toBe('the week of Mon 28 Sep is a draft, though a later week is published')
      expect(byKey(result, 'rota.week_not_published').map((signal) => signal.key)).toEqual(['rota.week_not_published.2026-09-28'])
    })

    it('treats a week marked published without a publish time as not published', async () => {
      const result = await build({ weeks: [week('2026-09-21'), week('2026-09-28', { published_at: null }), week('2026-10-05')] })
      const signal = byKey(result, 'rota.week_not_published')[0]
      expect(signal).toMatchObject({ key: 'rota.week_not_published.2026-09-28', rag: 'red', text: 'The rota for the week of Mon 28 Sep is marked published but was never sent to staff.' })
      expect(metric(result, 'Rota published to')?.comparison).toBe('the week of Mon 28 Sep is marked published but was never sent to staff')
      expect(byKey(result, 'rota.unpublished_changes')).toEqual([])
    })

    it('raises the current week as red when it is not published (a Monday run)', async () => {
      const monday = new Date('2026-09-28T05:00:00Z')
      const result = await build({ weeks: [draft('2026-09-28'), week('2026-10-05'), week('2026-10-12')] }, monday)
      const signal = byKey(result, 'rota.week_not_published')[0]
      expect(signal).toMatchObject({ key: 'rota.week_not_published.2026-09-28', rag: 'red', action: { dueDate: '2026-09-28' } })
      expect(result.headline).toContain("this week's rota not published")
      expect(metric(result, 'Rota published to')?.value).toBe('Not published')
    })

    it('raises unpublished changes in a published week as amber, from today onwards only', async () => {
      const base = healthy()
      const changed = shift('2026-09-29', { employee_id: 'emp-2' })
      const past = shift('2026-09-22')
      const ghost = shift('2026-10-01')
      const live = [...base.live, changed, { ...past, start_time: '12:00:00' }]
      const published = [
        ...base.live.map((row) => snapshot(row)),
        snapshot(changed, { start_time: '17:00:00' }),
        snapshot(past),
        snapshot(ghost),
      ]
      const result = await build({ weeks: base.weeks, live, published })
      expect(byKey(result, 'rota.unpublished_changes')).toEqual([{
        key: 'rota.unpublished_changes.2026-09-28',
        entity: 'rota_week:2026-09-28',
        rag: 'amber',
        kind: 'issue',
        text: 'The published rota for the week of Mon 28 Sep is out of date: 1 shift added or changed since publishing and 1 deleted shift still showing to staff.',
        emailSafe: true,
        action: {
          text: 'Republish the rota for the week of Mon 28 Sep',
          href: `${APP}/rota?week=2026-09-28`,
          target: 'record',
          dueDate: '2026-09-27',
          impact: 'staffing',
        },
      }])
    })
  })

  describe('leave', () => {
    it('makes leave starting within 7 days or waiting 7 days or more red, the rest amber, each linked to its row', async () => {
      const soon = leave({ start_date: '2026-09-30', end_date: '2026-10-02', created_at: '2026-09-23T09:00:00.000Z' })
      const edgeStart = leave({ start_date: '2026-10-02', end_date: '2026-10-02', created_at: '2026-09-24T09:00:00.000Z' })
      const edgeWait = leave({ start_date: '2026-11-02', end_date: '2026-11-02', created_at: '2026-09-18T09:00:00.000Z' })
      const sixDays = leave({ start_date: '2026-11-03', end_date: '2026-11-03', created_at: '2026-09-19T09:00:00.000Z' })
      const later = leave({ start_date: '2026-10-03', end_date: '2026-10-03', created_at: '2026-09-25T04:00:00.000Z', leave_type: 'unavailable' })
      const started = leave({ start_date: '2026-09-24', end_date: '2026-09-26', created_at: '2026-09-20T09:00:00.000Z' })
      const nextYear = leave({ start_date: '2027-01-04', end_date: '2027-01-08', created_at: '2026-09-22T09:00:00.000Z' })
      const declined = leave({ status: 'declined', start_date: '2026-09-28', end_date: '2026-09-28' })
      const result = await build({ ...healthy(), leave: [soon, edgeStart, edgeWait, sixDays, later, started, nextYear, declined] })

      const rags = Object.fromEntries(byKey(result, 'rota.leave_').map((signal) => [signal.entity, [signal.key.split('.')[1], signal.rag]]))
      expect(rags).toEqual({
        [`leave:${soon.id}`]: ['leave_urgent', 'red'],
        [`leave:${edgeStart.id}`]: ['leave_urgent', 'red'],
        [`leave:${edgeWait.id}`]: ['leave_urgent', 'red'],
        [`leave:${sixDays.id}`]: ['leave_pending', 'amber'],
        [`leave:${later.id}`]: ['leave_pending', 'amber'],
        [`leave:${started.id}`]: ['leave_urgent', 'red'],
        [`leave:${nextYear.id}`]: ['leave_pending', 'amber'],
      })

      const soonSignal = result.signals.find((signal) => signal.entity === `leave:${soon.id}`)
      expect(soonSignal).toEqual({
        key: `rota.leave_urgent.${soon.id}`,
        entity: `leave:${soon.id}`,
        rag: 'red',
        kind: 'issue',
        text: 'Leave request from Lettice (Holiday), Wed 30 Sep to Fri 2 Oct: waiting 2 days, starts in 5 days.',
        emailSafe: true,
        action: {
          text: 'Decide the leave request from Lettice (Wed 30 Sep to Fri 2 Oct)',
          href: `${APP}/rota/leave#leave-${soon.id}`,
          target: 'record',
          dueDate: '2026-09-30',
          impact: 'staffing',
        },
      })
      expect(result.signals.find((signal) => signal.entity === `leave:${later.id}`)?.text)
        .toBe('Leave request from Lettice (Not available to work), Sat 3 Oct: asked today, starts in 8 days.')
      const startedSignal = result.signals.find((signal) => signal.entity === `leave:${started.id}`)
      expect(startedSignal?.text).toContain('started yesterday')
      expect(startedSignal?.action?.dueDate).toBe('2026-09-25')
      expect(result.signals.find((signal) => signal.entity === `leave:${nextYear.id}`)?.text).toContain('Mon 4 Jan 2027 to Fri 8 Jan 2027')

      // Red leave outranks amber in the section's own order.
      const order = result.signals.map((signal) => signal.rag)
      expect(order.lastIndexOf('red')).toBeLessThan(order.indexOf('amber'))

      expect(metric(result, 'Leave requests waiting')).toEqual({ label: 'Leave requests waiting', value: '7', comparison: '4 urgent' })
      expect(result.headline).toContain('7 leave requests waiting')
      expect(list(result, 'Leave requests waiting')?.items).toHaveLength(7)
      expect(list(result, 'Leave requests waiting')?.items[0]).toMatchObject({ href: `${APP}/rota/leave#leave-${started.id}`, rag: 'red' })
      expect(JSON.stringify(result)).not.toContain('A private note')
    })

    it('reports the oldest wait when nothing is urgent', async () => {
      const result = await build({ ...healthy(), leave: [leave({ created_at: '2026-09-21T09:00:00.000Z' }), leave({ created_at: '2026-09-23T09:00:00.000Z' })] })
      expect(metric(result, 'Leave requests waiting')).toEqual({ label: 'Leave requests waiting', value: '2', comparison: 'oldest waiting 4 days' })
    })

    it("lists approved leave in the next 14 days as who's off, on the page only", async () => {
      const result = await build({
        ...healthy(),
        leave: [
          leave({ employee_id: 'emp-5', status: 'approved', start_date: '2026-09-20', end_date: '2026-09-26' }),
          leave({ employee_id: 'emp-5', status: 'approved', start_date: '2026-10-08', end_date: '2026-10-12', leave_type: 'unavailable' }),
          leave({ employee_id: 'emp-5', status: 'approved', start_date: '2026-09-14', end_date: '2026-09-24' }),
          leave({ employee_id: 'emp-5', status: 'approved', start_date: '2026-10-09', end_date: '2026-10-10' }),
        ],
      })
      expect(list(result, "Who's off, next 14 days")?.items).toEqual([
        { text: 'Winifred (Holiday), Sun 20 Sep to Sat 26 Sep' },
        { text: 'Winifred (Not available to work), Thu 8 Oct to Mon 12 Oct' },
      ])
      expect(byKey(result, 'rota.leave_')).toEqual([])
      expect(emailVisible(result)).not.toContain('Winifred')
    })
  })

  describe('acceptance', () => {
    it('shows 4-week shares by decision date against the 13-week rate, ignoring backfill and duplicate rows', async () => {
      const dup = event('shift_accepted', '2026-09-01T10:00:00.000Z')
      const events = [
        dup,
        { ...dup, id: 'evt-dup', event_at: '2026-09-02T10:00:00.000Z' },
        event('shift_accepted', '2026-09-05T10:00:00.000Z'),
        event('shift_accepted', '2026-09-24T21:30:00.000Z'),
        event('shift_auto_accepted', '2026-09-10T02:00:00.000Z'),
        event('shift_auto_accepted', '2026-08-28T02:00:00.000Z'),
        event('shift_accepted', '2026-09-03T10:00:00.000Z', { source: 'backfill' }),
        event('shift_auto_accepted', '2026-09-03T10:00:00.000Z', { source: 'backfill' }),
        // Outside the 4 weeks, inside the 13.
        event('shift_accepted', '2026-07-15T10:00:00.000Z'),
        event('shift_auto_accepted', '2026-07-20T02:00:00.000Z'),
        event('shift_auto_accepted', '2026-07-21T02:00:00.000Z'),
        event('shift_auto_accepted', '2026-07-22T02:00:00.000Z'),
        // Before both windows, and today (after the windows).
        event('shift_accepted', '2026-06-20T10:00:00.000Z'),
        event('shift_accepted', '2026-09-25T04:00:00.000Z'),
      ]
      const rejected = shift('2026-10-20')
      // One per department, so no department is named as hard to staff.
      const rejections = [
        rejection(rejected, '2026-09-08T10:00:00.000Z'),
        rejection(shift('2026-08-01', { department: 'kitchen' }), '2026-07-10T10:00:00.000Z'),
        rejection(shift('2026-08-02', { department: 'runner' }), '2026-07-11T10:00:00.000Z'),
      ]
      const result = await build({ ...healthy(), events, rejections })
      expect(metric(result, 'Accepted by staff, last 4 weeks')).toEqual({ label: 'Accepted by staff, last 4 weeks', value: '50% (3 of 6)', comparison: '13-week rate 33%' })
      expect(metric(result, 'Auto-accepted, last 4 weeks')).toEqual({ label: 'Auto-accepted, last 4 weeks', value: '33% (2 of 6)', comparison: '13-week rate 42%' })
      expect(metric(result, 'Rejected, last 4 weeks')).toEqual({ label: 'Rejected, last 4 weeks', value: '17% (1 of 6)', comparison: '13-week rate 25%' })
      // Acceptance never raises a signal of its own.
      expect(result.signals.map((signal) => signal.key)).toEqual(['rota.all_covered'])
    })

    it('counts shifts awaiting acceptance over the 16 days staff are warned about, with people on the page only', async () => {
      const base = healthy()
      const pendingA = shift('2026-09-27', { acceptance_status: 'pending' })
      const pendingB = shift('2026-10-03', { acceptance_status: 'pending' })
      const pendingC = shift('2026-09-29', { employee_id: 'emp-2', acceptance_status: 'pending' })
      // Day 15 of 16: the cohort the 14-day cutoff warning goes to, so it must be listed.
      const warned = shift('2026-10-09', { employee_id: 'emp-2', acceptance_status: 'pending' })
      // Day 17: not warned yet.
      const beyond = shift('2026-10-11', { acceptance_status: 'pending' })
      const result = await build({ weeks: base.weeks, live: [...base.live, pendingA, pendingB, pendingC, warned, beyond] })
      expect(metric(result, 'Awaiting acceptance, next 16 days')).toEqual({ label: 'Awaiting acceptance, next 16 days', value: '4 shifts', comparison: 'across 2 people' })
      expect(list(result, 'Awaiting acceptance, next 16 days')?.items).toEqual([
        { text: 'Rowena: 2 shifts, first Sun 27 Sep' },
        { text: 'Bartholomew: 2 shifts, first Tue 29 Sep' },
      ])
      expect(emailVisible(result)).not.toMatch(/Rowena|Bartholomew/)
    })
  })

  describe('rejections and couldn\'t-work shifts this week', () => {
    it('lists this week\'s rejections with whether each was covered, naming the rejecter on the page only', async () => {
      const base = healthy()
      const covered = shift('2026-10-10', { employee_id: 'emp-2' })
      const stillOpen = openShift('2026-10-12')
      const removed = shift('2026-10-14')
      const cancelled = shift('2026-10-15', { status: 'cancelled' })
      const result = await build({
        weeks: base.weeks,
        live: [...base.live, covered, stillOpen, cancelled],
        rejections: [
          rejection(covered, '2026-09-18T09:00:00.000Z'),
          rejection(stillOpen, '2026-09-24T22:30:00.000Z'),
          rejection(removed, '2026-09-20T09:00:00.000Z'),
          rejection(cancelled, '2026-09-21T09:00:00.000Z'),
          // Last week (London date 17 Sep) and today: not this week.
          rejection(covered, '2026-09-17T22:59:00.000Z', { employee_id: 'emp-2' }),
          rejection(covered, '2026-09-25T04:00:00.000Z', { employee_id: 'emp-2' }),
        ],
      })
      expect(metric(result, 'Rejections this week')).toEqual({
        label: 'Rejections this week',
        value: '4',
        comparison: '1 since covered, 1 still open, 1 shift cancelled, 1 shift since removed',
      })
      expect(list(result, 'Rejections this week')?.items).toEqual([
        { text: 'Sat 10 Oct, 18:00 to 23:00 (Bar): rejected by Constance, since covered', href: `${APP}/rota?week=2026-10-05&shift=${covered.id}` },
        { text: 'Wed 14 Oct, 18:00 to 23:00 (Bar): rejected by Constance, shift since removed' },
        { text: 'Thu 15 Oct, 18:00 to 23:00 (Bar): rejected by Constance, shift cancelled', href: `${APP}/rota?week=2026-10-12&shift=${cancelled.id}` },
        { text: 'Mon 12 Oct, 18:00 to 23:00 (Bar): rejected by Constance, still open', href: `${APP}/rota?week=2026-10-12&shift=${stillOpen.id}`, rag: 'red' },
      ])
      expect(emailVisible(result)).not.toContain('Constance')
    })

    it("counts couldn't-work shifts this week by the reopened shift's department, by shift date, ignoring backfill", async () => {
      const base = healthy()
      const bar19 = reopened('2026-09-19')
      const bar20 = reopened('2026-09-20', { is_open_shift: false, employee_id: 'emp-2' }) // since covered: still counts
      const kitchen22 = reopened('2026-09-22', { department: 'kitchen' })
      const backfilled = reopened('2026-09-21', { department: 'kitchen', is_open_shift: false, employee_id: 'emp-2' })
      // Still open with a Couldn't Work reason, but its event was never recorded: counts from the shift.
      const noEvent = reopened('2026-09-24', { department: 'kitchen' })
      const lastWeek = reopened('2026-09-17')
      const cases = [
        couldntWork('2026-09-19', [bar19]),
        couldntWork('2026-09-20', [bar20]),
        couldntWork('2026-09-22', [kitchen22]),
        couldntWork('2026-09-21', [backfilled], { source: 'backfill' }),
        couldntWork('2026-09-17', [lastWeek]),
        // Marked on a day with no shift: nothing was reopened, so nothing counts.
        couldntWork('2026-09-23', []),
      ]
      const result = await build({
        ...base,
        live: [...base.live, bar19, bar20, kitchen22, backfilled, noEvent, lastWeek, ...cases.map((entry) => entry.marker)],
        events: cases.map((entry) => entry.event),
      })
      expect(metric(result, "Couldn't-work shifts this week")).toEqual({ label: "Couldn't-work shifts this week", value: '4', comparison: 'Bar 2, Kitchen 2' })
      expect(JSON.stringify(result)).not.toContain(HEALTH_DETAIL)
      expect(result.notes.some((note) => note.includes('could not be matched'))).toBe(false)
    })

    it("never uses the marker's 'bar' department for a kitchen couldn't-work shift", async () => {
      const base = healthy()
      const kitchen = reopened('2026-09-22', { department: 'kitchen' })
      const { marker, event: cwEvent } = couldntWork('2026-09-22', [kitchen])
      const result = await build({ ...base, live: [...base.live, marker, kitchen], events: [cwEvent] })
      expect(cwEvent.department).toBe('bar')
      expect(metric(result, "Couldn't-work shifts this week")).toEqual({ label: "Couldn't-work shifts this week", value: '1', comparison: 'Kitchen 1' })
    })

    it("leaves out a couldn't-work shift that is no longer on the rota, with a note", async () => {
      const base = healthy()
      const gone = reopened('2026-09-22', { department: 'kitchen' })
      const kept = reopened('2026-09-23')
      const deleted = couldntWork('2026-09-22', [gone])
      const unlisted = couldntWork('2026-09-21', [], { impacted_shift_count: 1 })
      const found = couldntWork('2026-09-23', [kept])
      const result = await build({
        ...base,
        live: [...base.live, kept, deleted.marker, unlisted.marker, found.marker],
        events: [deleted.event, unlisted.event, found.event],
      })
      expect(metric(result, "Couldn't-work shifts this week")).toEqual({ label: "Couldn't-work shifts this week", value: '1', comparison: 'Bar 1' })
      expect(result.notes).toContain("2 couldn't-work shifts in the last 13 weeks could not be matched to a shift on the rota, so they are left out of the couldn't-work figures.")
    })

    it('buckets rejection times by London date across the October clock change', async () => {
      const now = new Date('2026-10-30T06:00:00Z') // Fri 30 Oct 06:00 GMT; this week 23 to 29 Oct.
      const target = shift('2026-11-20')
      const result = await build({
        weeks: [week('2026-10-26'), week('2026-11-02')],
        live: [target],
        rejections: [
          rejection(target, '2026-10-22T22:30:00.000Z'), // 23:30 BST on 22 Oct: last week
          rejection(target, '2026-10-22T23:30:00.000Z'), // 00:30 BST on 23 Oct: this week
          rejection(target, '2026-10-25T12:00:00.000Z'),
          rejection(target, '2026-10-29T23:30:00.000Z'), // 23:30 GMT on 29 Oct: this week
          rejection(target, '2026-10-30T00:30:00.000Z'), // today
        ],
      }, now)
      expect(metric(result, 'Rejections this week')?.value).toBe('3')
    })
  })

  describe('hard to staff', () => {
    it('names a department with at least 3 and half or more of 13 weeks of gaps, ignoring backfill', async () => {
      const barCouldntWork = reopened('2026-09-01', { is_open_shift: false, employee_id: 'emp-2' })
      const cw = couldntWork('2026-09-01', [barCouldntWork])
      const backfill = Array.from({ length: 5 }, () => {
        const covered = shift('2026-06-30', { department: 'kitchen', reassignment_reason: `Couldn't Work: ${HEALTH_DETAIL}` })
        return { covered, ...couldntWork('2026-06-30', [covered], { source: 'backfill' }) }
      })
      const result = await build({
        ...healthy(),
        rejections: [
          rejection(shift('2026-08-10'), '2026-07-20T10:00:00.000Z'),
          rejection(shift('2026-09-10'), '2026-08-20T10:00:00.000Z'),
          rejection(shift('2026-05-10', { department: 'kitchen' }), '2026-04-20T10:00:00.000Z'),
        ],
        live: [
          ...healthy().live,
          openShift('2026-08-15'),
          openShift('2026-09-01', { department: 'kitchen' }),
          openShift('2026-06-01', { department: 'kitchen' }),
          barCouldntWork,
          cw.marker,
          ...backfill.flatMap((entry) => [entry.covered, entry.marker]),
        ],
        events: [cw.event, ...backfill.map((entry) => entry.event)],
      })
      expect(byKey(result, 'rota.hard_to_staff')).toEqual([{
        key: 'rota.hard_to_staff.bar',
        entity: 'department:bar',
        rag: 'amber',
        kind: 'issue',
        text: "Bar is the hardest department to staff: 4 of 5 rejections, unfilled shifts and couldn't-work shifts in the last 13 weeks.",
        emailSafe: true,
        action: {
          text: 'Plan more cover for Bar shifts, which have 4 of 5 staffing gaps in 13 weeks',
          href: `${APP}/rota`,
          target: 'list',
          impact: 'staffing',
        },
      }])
      expect(list(result, 'Staffing gaps by department, last 13 weeks')?.items).toEqual([
        { text: "Bar: 2 rejections, 1 unfilled shift, 1 couldn't-work shift" },
        { text: "Kitchen: 0 rejections, 1 unfilled shift, 0 couldn't-work shifts" },
      ])
    })

    it("names kitchen for kitchen couldn't-work shifts behind a 'bar' marker, counting each reopened shift once", async () => {
      // Four kitchen shifts reopened by Couldn't Work and never covered again, as live in July.
      const kitchen = ['2026-07-12', '2026-07-15', '2026-07-16', '2026-07-17'].map((date) => reopened(date, { department: 'kitchen' }))
      const cases = kitchen.map((row) => couldntWork(row.shift_date as string, [row]))
      const result = await build({
        ...healthy(),
        live: [...healthy().live, ...kitchen, ...cases.map((entry) => entry.marker)],
        events: cases.map((entry) => entry.event),
        rejections: [
          rejection(shift('2026-08-10'), '2026-07-20T10:00:00.000Z'),
          rejection(shift('2026-08-11'), '2026-07-21T10:00:00.000Z'),
        ],
      })
      expect(cases.every((entry) => entry.event.department === 'bar' && entry.marker.department === 'bar')).toBe(true)
      expect(byKey(result, 'rota.hard_to_staff')).toEqual([expect.objectContaining({
        key: 'rota.hard_to_staff.kitchen',
        entity: 'department:kitchen',
        rag: 'amber',
        text: "Kitchen is the hardest department to staff: 4 of 6 rejections, unfilled shifts and couldn't-work shifts in the last 13 weeks.",
        emailSafe: true,
      })])
      expect(list(result, 'Staffing gaps by department, last 13 weeks')?.items).toEqual([
        { text: "Kitchen: 0 rejections, 0 unfilled shifts, 4 couldn't-work shifts" },
        { text: "Bar: 2 rejections, 0 unfilled shifts, 0 couldn't-work shifts" },
      ])
      expect(JSON.stringify(result)).not.toContain(HEALTH_DETAIL)
    })

    it('counts a rejected shift left open once, as a rejection, not again as unfilled', async () => {
      const rejectedOpen = ['2026-08-10', '2026-08-11', '2026-08-12'].map((date) =>
        openShift(date, { department: 'kitchen', reassignment_reason: 'Rejected by staff: A private reason' }))
      const result = await build({
        ...healthy(),
        live: [...healthy().live, ...rejectedOpen, openShift('2026-08-20')],
        rejections: rejectedOpen.map((row, index) => rejection(row, `2026-08-0${index + 1}T10:00:00.000Z`)),
      })
      expect(list(result, 'Staffing gaps by department, last 13 weeks')?.items).toEqual([
        { text: "Kitchen: 3 rejections, 0 unfilled shifts, 0 couldn't-work shifts" },
        { text: "Bar: 0 rejections, 1 unfilled shift, 0 couldn't-work shifts" },
      ])
      expect(byKey(result, 'rota.hard_to_staff')[0]?.text).toContain('3 of 4')
    })

    it('names nobody below the minimum or below half', async () => {
      const small = await build({ ...healthy(), rejections: [rejection(shift('2026-10-10'), '2026-09-01T10:00:00.000Z'), rejection(shift('2026-10-11'), '2026-09-02T10:00:00.000Z')] })
      expect(byKey(small, 'rota.hard_to_staff')).toEqual([])

      const spread = await build({
        ...healthy(),
        rejections: [
          ...['2026-10-10', '2026-10-11', '2026-10-12'].map((date, index) => rejection(shift(date), `2026-09-0${index + 1}T10:00:00.000Z`)),
          ...['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((date, index) => rejection(shift(date, { department: 'kitchen' }), `2026-09-0${index + 4}T10:00:00.000Z`)),
        ],
      })
      expect(byKey(spread, 'rota.hard_to_staff').map((signal) => signal.key)).toEqual(['rota.hard_to_staff.kitchen'])
    })
  })

  describe('not enough history', () => {
    it('shows 4-week figures without a 13-week rate and names no department before 13 weeks of records', async () => {
      const now = new Date('2026-07-10T05:00:00Z') // last 4 weeks from 12 Jun; 13 weeks from 10 Apr
      const result = await build({
        weeks: [week('2026-07-06'), week('2026-07-13'), week('2026-07-20')],
        live: [shift('2026-07-11')],
        events: [event('shift_accepted', '2026-06-20T10:00:00.000Z'), event('shift_auto_accepted', '2026-07-01T02:00:00.000Z')],
        rejections: [
          rejection(shift('2026-07-20'), '2026-06-20T10:00:00.000Z'),
          rejection(shift('2026-07-21'), '2026-06-21T10:00:00.000Z'),
          rejection(shift('2026-07-22'), '2026-06-22T10:00:00.000Z'),
        ],
      }, now)
      expect(metric(result, 'Accepted by staff, last 4 weeks')).toEqual({
        label: 'Accepted by staff, last 4 weeks',
        value: '20% (1 of 5)',
        comparison: 'not enough history yet for the 13-week rate',
      })
      expect(byKey(result, 'rota.hard_to_staff')).toEqual([])
      expect(list(result, 'Staffing gaps by department, last 13 weeks')).toBeUndefined()
      expect(result.notes).toEqual([
        'Not enough history yet for 13-week acceptance rates.',
        'Not enough history yet to judge which department is hardest to staff over 13 weeks.',
      ])
      expectClean(result)
    })

    it('shows no acceptance figures before 4 weeks of records', async () => {
      const now = new Date('2026-06-19T05:00:00Z')
      const result = await build({ weeks: [week('2026-06-15'), week('2026-06-22')], events: [event('shift_accepted', '2026-06-10T10:00:00.000Z')] }, now)
      expect(result.metrics.some((entry) => entry.label.includes('last 4 weeks'))).toBe(false)
      expect(result.notes[0]).toBe('Shift acceptance records began on Sat 6 Jun, so there is not enough history yet for the 4-week acceptance figures.')
    })
  })

  it('keeps every page-only name out of email-safe text in a busy week', async () => {
    const base = healthy()
    const open = openShift('2026-09-27')
    const covered = shift('2026-10-10', { employee_id: 'emp-2' })
    const result = await build({
      weeks: [week('2026-09-21'), week('2026-09-28'), draft('2026-10-05')],
      live: [...base.live, open, covered, shift('2026-09-28', { acceptance_status: 'pending' }), shift('2026-09-29', { employee_id: 'emp-2', acceptance_status: 'pending' })],
      rejections: [rejection(open, '2026-09-10T10:00:00.000Z'), rejection(covered, '2026-09-20T10:00:00.000Z')],
      leave: [
        leave({ start_date: '2026-09-30', end_date: '2026-09-30' }),
        leave({ employee_id: 'emp-5', status: 'approved', start_date: '2026-09-28', end_date: '2026-09-29' }),
      ],
      events: [event('shift_accepted', '2026-09-10T10:00:00.000Z')],
    })
    const visible = emailVisible(result)
    for (const name of PAGE_ONLY_NAMES) expect(visible).not.toContain(name)
    expect(visible).toContain('Lettice')
    // Every signal here is deliberately email safe; names live in the page lists.
    expect(result.signals.every((signal) => signal.emailSafe)).toBe(true)
    expect(JSON.stringify(result.lists)).toMatch(/Constance/)
    expectClean(result)
  })

  it('runs through the engine: red status, one primary action per record, links on the app origin', async () => {
    const base = healthy()
    const fake = makeDb({
      weeks: [week('2026-09-21'), draft('2026-09-28')],
      live: [...base.live, openShift('2026-09-26'), openShift('2026-09-27')],
      leave: [leave({ start_date: '2026-11-20', end_date: '2026-11-20' })],
    })
    const report = await buildInsightsReport({
      createDb: () => fake.asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: APP,
      sections: [rotaSection],
      logFailure: () => undefined,
    })
    const section = report.sections[0]
    expect(section.status).toBe('red')
    expect(section.href).toBe(`${APP}/rota`)
    // Both reds score 380 (due within 2 days, staffing); the earlier due date goes first.
    expect(report.actions.map((action) => [action.signalKey, action.rag, action.score])).toEqual([
      ['rota.open_shifts', 'red', 380],
      ['rota.week_not_published.2026-09-28', 'red', 380],
      ['rota.week_not_published.2026-10-05', 'amber', 240],
      ['rota.leave_pending.' + String(fake.tables.leave_requests[0].id), 'amber', 220],
    ])
    for (const action of report.actions) expect(action.href.startsWith(`${APP}/`)).toBe(true)
    expect(fake.calls.every((call) => call.kind === 'select')).toBe(true)
  })

  it('is not checked through the engine when a read fails', async () => {
    const fake = makeDb(healthy()).fail('leave_requests')
    const report = await buildInsightsReport({
      createDb: () => fake.asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: APP,
      sections: [rotaSection],
      logFailure: () => undefined,
    })
    expect(report.sections[0]).toMatchObject({ status: 'not_checked', failure: { reason: 'error' } })
  })
})
