import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), queue: vi.fn() }))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/manager-report/queue', () => ({ queueManagerReportEmail: mocks.queue }))

import { GET as maintenanceSnapshot } from '@/app/api/cron/maintenance-weekly-snapshot/route'
import { MANAGER_REPORT_SECTIONS } from '@/lib/manager-report/types'

type Row = Record<string, unknown>

const OPEN_STATUSES = ['reported', 'quoting', 'awaiting_landlord', 'scheduled', 'in_progress', 'on_hold']
const CLOSED_STATUSES = ['done', 'cancelled']

const AREAS: Row[] = [
  { id: 'area-cellar', name: 'Cellar' },
  { id: 'area-garden', name: 'Beer Garden and Terrace' },
]

function item(overrides: Partial<Row> & { id: string }): Row {
  return {
    reference: `M-${overrides.id}`,
    kind: 'issue',
    title: `Item ${overrides.id}`,
    area_id: 'area-cellar',
    status: 'reported',
    priority: 'medium',
    responsibility: 'us',
    target_date: null,
    created_at: `2026-01-01T00:00:00Z`,
    ...overrides,
  }
}

type FakeOptions = {
  items?: Row[]
  areas?: Row[]
  failTable?: string
  /** Rows any single request returns, however many were asked for. */
  serverCap?: number
  /** Force the reported exact count, to simulate a truncated read. */
  countOverride?: number
}

/**
 * Minimal PostgREST stand-in. It genuinely applies the not-in filter, the ordering
 * and the requested range, so completeness and pagination are proven rather than
 * assumed, and a server row cap smaller than the page size can be simulated.
 */
function fakeDb(options: FakeOptions = {}) {
  const itemPageRequests: Array<[number, number]> = []
  const tablesRead: string[] = []

  const from = (table: string) => {
    tablesRead.push(table)
    const source = () => (table === 'maintenance_items' ? options.items ?? [] : options.areas ?? AREAS)
    const filters: Array<(row: Row) => boolean> = []
    let headOnly = false
    let exactCount = false
    let orderColumns: string[] = []
    let range: [number, number] | null = null

    const builder: Record<string, unknown> = {}
    builder.select = (_columns: string, config?: { count?: string; head?: boolean }) => {
      headOnly = Boolean(config?.head)
      exactCount = config?.count === 'exact'
      return builder
    }
    builder.not = (column: string, operator: string, value: string) => {
      if (operator !== 'in') throw new Error(`fakeDb does not implement not(${operator})`)
      const excluded = value
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .split(',')
        .map((entry) => entry.trim().replace(/^"/, '').replace(/"$/, ''))
      filters.push((row) => !excluded.includes(String(row[column])))
      return builder
    }
    builder.eq = (column: string, value: unknown) => {
      filters.push((row) => row[column] === value)
      return builder
    }
    builder.order = (column: string) => {
      orderColumns.push(column)
      return builder
    }
    builder.range = (start: number, end: number) => {
      range = [start, end]
      if (table === 'maintenance_items') itemPageRequests.push([start, end])
      return builder
    }
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      if (options.failTable === table) {
        return Promise.resolve({ data: null, count: null, error: { message: 'Database unavailable' } }).then(resolve, reject)
      }
      const matching = source().filter((row) => filters.every((matches) => matches(row)))
      for (const column of [...orderColumns].reverse()) {
        matching.sort((left, right) => String(left[column] ?? '').localeCompare(String(right[column] ?? '')))
      }
      if (headOnly && exactCount) {
        const count = table === 'maintenance_items' && options.countOverride !== undefined
          ? options.countOverride
          : matching.length
        return Promise.resolve({ data: null, count, error: null }).then(resolve, reject)
      }
      let data = matching
      if (range) {
        const [start, end] = range
        const requested = end - start + 1
        data = matching.slice(start, start + Math.min(requested, options.serverCap ?? Number.MAX_SAFE_INTEGER))
      }
      return Promise.resolve({ data, count: null, error: null }).then(resolve, reject)
    }
    return builder
  }

  return { from: vi.fn(from), itemPageRequests, tablesRead }
}

const request = () => new Request('https://management.orangejelly.co.uk/api/cron/maintenance-weekly-snapshot')

function queuedInput() {
  return mocks.queue.mock.calls.at(-1)?.[0] as {
    section: string; key: string; to: string; subject: string; html: string; text: string
    metadata?: Record<string, unknown>
  }
}

describe('Friday maintenance snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Friday 11 September 2026, 08:00 London (British Summer Time).
    vi.setSystemTime(new Date('2026-09-11T07:00:00Z'))
    process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
    delete process.env.MANAGER_EMAIL
    mocks.auth.mockReturnValue({ authorized: true })
    mocks.db.mockReturnValue(fakeDb({ items: [] }))
    mocks.queue.mockResolvedValue({ success: true, queued: true })
  })
  afterEach(() => vi.useRealTimers())

  it('registers a maintenance section on the existing report', () => {
    expect(MANAGER_REPORT_SECTIONS).toContain('maintenance')
  })

  it('rejects unauthorised access before reading any data', async () => {
    mocks.auth.mockReturnValue({ authorized: false })
    expect((await maintenanceSnapshot(request())).status).toBe(401)
    expect(mocks.db).not.toHaveBeenCalled()
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  describe('schedule gate', () => {
    it.each([
      ['2026-03-27T08:00:00Z', 'Friday 08:00 London in Greenwich Mean Time'],
      ['2026-04-03T07:00:00Z', 'Friday 08:00 London in British Summer Time'],
      ['2026-10-30T08:00:00Z', 'Friday 08:00 London after the clocks go back'],
      ['2026-12-11T08:00:00Z', 'Friday 08:00 London in midwinter'],
    ])('runs at %s, %s', async (time) => {
      vi.setSystemTime(new Date(time))
      expect((await maintenanceSnapshot(request())).status).toBe(200)
      expect(mocks.queue).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['2026-09-11T08:00:00Z', 'Friday 09:00 London, the delivery hour not the snapshot hour'],
      ['2026-09-11T06:00:00Z', 'Friday 07:00 London'],
      ['2026-12-11T07:00:00Z', 'Friday 07:00 London in midwinter'],
      ['2026-09-10T07:00:00Z', 'Thursday 08:00 London'],
      ['2026-09-12T07:00:00Z', 'Saturday 08:00 London'],
    ])('does not run at %s, %s', async (time) => {
      vi.setSystemTime(new Date(time))
      const response = await maintenanceSnapshot(request())
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ skipped: true })
      expect(mocks.db).not.toHaveBeenCalled()
      expect(mocks.queue).not.toHaveBeenCalled()
    })
  })

  describe('completeness', () => {
    it('includes every open status, both kinds, all responsibilities, undated and future-dated items', async () => {
      const items = [
        ...OPEN_STATUSES.map((status, index) => item({ id: `s${index}`, status, reference: `M-100${index}` })),
        item({ id: 'improvement', kind: 'improvement', reference: 'M-2001', title: 'Repaint the terrace' }),
        item({ id: 'greene-king', responsibility: 'greene_king', reference: 'M-2002' }),
        item({ id: 'to-confirm', responsibility: 'to_confirm', reference: 'M-2003' }),
        item({ id: 'undated', target_date: null, reference: 'M-2004' }),
        item({ id: 'future', target_date: '2027-06-30', reference: 'M-2005' }),
        item({ id: 'onhold', status: 'on_hold', target_date: null, reference: 'M-2006' }),
        item({ id: 'lowest', priority: 'low', reference: 'M-2007' }),
        item({ id: 'critical', priority: 'critical', reference: 'M-2008', target_date: '2026-01-05' }),
        ...CLOSED_STATUSES.map((status) => item({
          id: `closed-${status}`, status, reference: `M-900${status}`, title: `Closed ${status}`,
        })),
      ]
      mocks.db.mockReturnValue(fakeDb({ items }))

      expect((await maintenanceSnapshot(request())).status).toBe(200)
      const input = queuedInput()

      const open = items.filter((row) => !CLOSED_STATUSES.includes(String(row.status)))
      expect(input.metadata?.outstanding_items).toBe(open.length)
      for (const row of open) {
        expect(input.text).toContain(String(row.reference))
        expect(input.html).toContain(String(row.reference))
      }
      for (const row of items.filter((candidate) => CLOSED_STATUSES.includes(String(candidate.status)))) {
        expect(input.text).not.toContain(String(row.reference))
        expect(input.html).not.toContain(String(row.reference))
      }
      for (const label of ['Reported', 'Quoting', 'With Greene King', 'Scheduled', 'In progress', 'On hold']) {
        expect(input.text).toContain(`Status: ${label}`)
      }
      for (const label of ['Responsibility: Us', 'Responsibility: Greene King', 'Responsibility: To confirm']) {
        expect(input.text).toContain(label)
      }
      expect(input.text).toContain('Issue')
      expect(input.text).toContain('Improvement')
      expect(input.text).toContain('Target date: not set')
      expect(input.text).toContain('Target date: 30 Jun 2027')
      expect(input.text).toContain('Cellar')
      expect(`${input.html}${input.text}`).not.toMatch(/undefined|NaN|Invalid Date/)
    })

    it('carries the reference, area, priority and an authenticated link for each item', async () => {
      mocks.db.mockReturnValue(fakeDb({
        items: [item({ id: 'abc-123', reference: 'M-0042', title: 'Cellar cooler failed', area_id: 'area-garden', priority: 'critical', target_date: '2026-09-19' })],
      }))
      await maintenanceSnapshot(request())
      const input = queuedInput()
      expect(input.text).toContain('M-0042: Cellar cooler failed')
      expect(input.text).toContain('Beer Garden and Terrace')
      expect(input.text).toContain('Priority: Critical')
      // en-GB abbreviates September as "Sept", not "Sep".
      expect(input.text).toContain('Target date: 19 Sept 2026')
      expect(input.html).toContain('href="https://management.orangejelly.co.uk/maintenance/abc-123"')
    })

    it('queues an explicit all-clear rather than nothing when nothing is outstanding', async () => {
      mocks.db.mockReturnValue(fakeDb({ items: [] }))
      expect((await maintenanceSnapshot(request())).status).toBe(200)
      const input = queuedInput()
      expect(input.subject).toBe('Maintenance: no outstanding items')
      expect(input.text).toContain('No outstanding maintenance items.')
      expect(input.metadata?.outstanding_items).toBe(0)
    })

    it('escapes item text and never reads or references photos', async () => {
      mocks.db.mockReturnValue(fakeDb({
        items: [item({ id: 'x1', title: '<img src=x onerror=alert(1)> & "Bar"', reference: 'M-0007' })],
        areas: [{ id: 'area-cellar', name: '<script>alert(1)</script>' }],
      }))
      await maintenanceSnapshot(request())
      const input = queuedInput()
      expect(input.html).not.toMatch(/<img|<script/)
      expect(input.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Bar&quot;')
      expect(mocks.db.mock.results[0].value.tablesRead).not.toContain('maintenance_photos')
      expect(`${input.html}${input.text}`).not.toMatch(/maintenance-photos|storage\/v1|X-Amz-|token=/)
    })
  })

  describe('pagination', () => {
    it('returns every item exactly once when the data spans several pages', async () => {
      const items = Array.from({ length: 1201 }, (_, index) => item({
        id: `bulk-${index}`, reference: `M-${String(index).padStart(5, '0')}`,
        created_at: `2026-01-01T00:00:${String(index).padStart(4, '0')}Z`,
      }))
      const db = fakeDb({ items })
      mocks.db.mockReturnValue(db)

      expect((await maintenanceSnapshot(request())).status).toBe(200)
      const input = queuedInput()
      expect(input.metadata?.outstanding_items).toBe(1201)
      expect(db.itemPageRequests.length).toBeGreaterThan(1)
      for (const row of items) {
        expect(input.text.split(`${row.reference}:`).length - 1).toBe(1)
      }
    })

    it('keeps paging when the server caps a page below the requested size', async () => {
      const items = Array.from({ length: 7 }, (_, index) => item({
        id: `capped-${index}`, reference: `M-3${index}`,
        created_at: `2026-01-01T00:00:0${index}Z`,
      }))
      const db = fakeDb({ items, serverCap: 2 })
      mocks.db.mockReturnValue(db)

      expect((await maintenanceSnapshot(request())).status).toBe(200)
      expect(queuedInput().metadata?.outstanding_items).toBe(7)
      // Four pages of at most two rows, then an empty page proving exhaustion.
      expect(db.itemPageRequests.length).toBe(5)
      expect(db.itemPageRequests.map(([start]) => start)).toEqual([0, 2, 4, 6, 7])
    })

    it('fails loudly rather than emailing a short list when the read is truncated', async () => {
      const items = Array.from({ length: 3 }, (_, index) => item({ id: `t${index}`, reference: `M-4${index}` }))
      mocks.db.mockReturnValue(fakeDb({ items, countOverride: 9 }))
      expect((await maintenanceSnapshot(request())).status).toBe(500)
      expect(mocks.queue).not.toHaveBeenCalled()
    })
  })

  describe('failure handling', () => {
    it('returns 500 and queues nothing when the items read fails', async () => {
      mocks.db.mockReturnValue(fakeDb({ failTable: 'maintenance_items' }))
      expect((await maintenanceSnapshot(request())).status).toBe(500)
      expect(mocks.queue).not.toHaveBeenCalled()
    })

    it('returns 500 and queues nothing when the areas read fails', async () => {
      mocks.db.mockReturnValue(fakeDb({ items: [item({ id: 'a1' })], failTable: 'maintenance_areas' }))
      expect((await maintenanceSnapshot(request())).status).toBe(500)
      expect(mocks.queue).not.toHaveBeenCalled()
    })

    it('returns 500 when the admin client itself throws', async () => {
      mocks.db.mockImplementation(() => { throw new Error('Missing Supabase environment variables') })
      expect((await maintenanceSnapshot(request())).status).toBe(500)
      expect(mocks.queue).not.toHaveBeenCalled()
    })

    it('reports a queue failure rather than claiming the snapshot was recorded', async () => {
      mocks.queue.mockResolvedValue({ success: false, error: 'Queue unavailable' })
      expect((await maintenanceSnapshot(request())).status).toBe(500)
    })
  })

  describe('duplicate protection', () => {
    it('produces the same section, key and recipient when the Friday run repeats', async () => {
      mocks.db.mockReturnValue(fakeDb({ items: [item({ id: 'dup-1' })] }))
      await maintenanceSnapshot(request())
      const first = queuedInput()
      await maintenanceSnapshot(request())
      const second = queuedInput()
      expect(mocks.queue).toHaveBeenCalledTimes(2)
      expect({ section: second.section, key: second.key, to: second.to })
        .toEqual({ section: first.section, key: first.key, to: first.to })
      expect(first.section).toBe('maintenance')
      expect(first.key).toBe('2026-09-11')
      expect(first.to).toBe('manager@the-anchor.pub')
    })

    it('reuses the report identifier, so a repeat run cannot add a second entry', async () => {
      const { managerReportId } = await vi.importActual<typeof import('@/lib/manager-report/queue')>('@/lib/manager-report/queue')
      mocks.db.mockReturnValue(fakeDb({ items: [item({ id: 'dup-2' })] }))
      await maintenanceSnapshot(request())
      const first = queuedInput()
      // Later the same Friday, with the item list changed underneath.
      vi.setSystemTime(new Date('2026-09-11T07:30:00Z'))
      mocks.db.mockReturnValue(fakeDb({ items: [item({ id: 'dup-2' }), item({ id: 'dup-3' })] }))
      await maintenanceSnapshot(request())
      const second = queuedInput()

      const id = (input: { section: string; key: string; to: string }) =>
        managerReportId(['manager_report_item', input.section, input.key, input.to])
      expect(id(second)).toBe(id(first))

      // The following Friday is a new snapshot, not a suppressed duplicate.
      vi.setSystemTime(new Date('2026-09-18T07:00:00Z'))
      await maintenanceSnapshot(request())
      const nextWeek = queuedInput()
      expect(nextWeek.key).toBe('2026-09-18')
      expect(id(nextWeek)).not.toBe(id(first))
    })

    it('honours the report recipient override', async () => {
      process.env.MANAGER_EMAIL = 'gm@the-anchor.pub'
      mocks.db.mockReturnValue(fakeDb({ items: [] }))
      await maintenanceSnapshot(request())
      expect(queuedInput().to).toBe('gm@the-anchor.pub')
      delete process.env.MANAGER_EMAIL
    })
  })
})
