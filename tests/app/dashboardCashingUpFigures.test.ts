import { describe, expect, it } from 'vitest'
import { addDays, differenceInCalendarDays, format, getISOWeek, setISOWeek, startOfWeek, subWeeks } from 'date-fns'
import { cashingUpRanges, loadCashingUpFigures } from '@/app/(authenticated)/dashboard/cashing-up-figures'
import { shiftIsoDate } from '@/lib/dateUtils'

/**
 * Page load performance, spec section 5.4: the dashboard's cashing-up card was four serial stages
 * and six queries. It is now the site, then one parallel batch with a single 14-day sessions read.
 * The figures must not move: this pins the new loader to the old code (kept below verbatim, as the
 * reference) over every day of more than a year, a 53-week year included, on random data.
 */

type Row = Record<string, unknown>

/** In-memory PostgREST stand-in with Postgres NULL rules (a NULL never passes `neq`). */
function fakeDb(tables: Record<string, Row[]>) {
  const queries: string[] = []
  function builder(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    let order: { column: string; ascending: boolean } | null = null
    let limit: number | null = null
    let columns = '*'
    const run = () => {
      let rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
      if (order) {
        const { column, ascending } = order
        rows = [...rows].sort((a, b) => {
          const left = a[column] as string
          const right = b[column] as string
          if (left === right) return 0
          return (left > right ? 1 : -1) * (ascending ? 1 : -1)
        })
      }
      if (limit !== null) rows = rows.slice(0, limit)
      const shaped = columns === '*'
        ? rows.map((row) => ({ ...row }))
        : rows.map((row) => Object.fromEntries(columns.split(',').map((c) => c.trim()).map((c) => [c, row[c]])))
      return shaped
    }
    const api: Record<string, unknown> = {
      select(cols?: string) { columns = cols ?? '*'; queries.push(table); return api },
      eq(column: string, value: unknown) { filters.push((row) => row[column] !== null && row[column] === value); return api },
      neq(column: string, value: unknown) { filters.push((row) => row[column] !== null && row[column] !== value); return api },
      is(column: string, value: unknown) { filters.push((row) => (value === null ? row[column] === null || row[column] === undefined : row[column] === value)); return api },
      gte(column: string, value: string) { filters.push((row) => row[column] !== null && (row[column] as string) >= value); return api },
      lte(column: string, value: string) { filters.push((row) => row[column] !== null && (row[column] as string) <= value); return api },
      order(column: string, options?: { ascending?: boolean }) { order = { column, ascending: options?.ascending !== false }; return api },
      limit(count: number) { limit = count; return api },
      single() {
        const rows = run()
        return Promise.resolve(rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116' } })
      },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: run(), error: null }).then(resolve) },
    }
    return api
  }
  return { client: { from: (table: string) => builder(table) }, queries }
}

/** The block as it was in dashboard-data.ts before 18 November 2026, unchanged apart from its frame. */
async function referenceFigures(supabase: any, todayIso: string) {
  const cashingUp = {
    thisWeekTotal: 0, thisWeekTarget: 0, lastWeekTotal: 0, lastYearTotal: 0,
    sessionsSubmittedCount: 0, completedThrough: null as string | null,
    dailySessions: [] as Array<{ date: string; amount: number; target: number }>,
  }
  const { data: site } = await supabase.from('sites').select('id').limit(1).single()
  if (!site) return null
  const today = new Date(todayIso)
  const todayStr = todayIso
  const weekStart = startOfWeek(today, { weekStartsOn: 1 })
  const { data: thisWeekData } = await supabase.from('cashup_sessions')
    .select('total_counted_amount, session_date, status')
    .eq('site_id', site.id)
    .is('voided_at', null)
    .gte('session_date', format(weekStart, 'yyyy-MM-dd'))
    .lte('session_date', todayStr)
  const completedSessions = (thisWeekData ?? []).filter((s: any) => s.status && s.status !== 'draft')
  const lastCompletedIso = completedSessions.length
    ? completedSessions.reduce((latest: string, s: any) => (s.session_date > latest ? s.session_date : latest), completedSessions[0].session_date)
    : null
  const lastCompletedDay = lastCompletedIso ? new Date(lastCompletedIso) : null
  const completedDaysThisWeek = lastCompletedDay && lastCompletedDay >= weekStart
    ? differenceInCalendarDays(lastCompletedDay, weekStart) + 1
    : 0
  cashingUp.completedThrough = completedDaysThisWeek > 0 ? format(lastCompletedDay!, 'EEEE') : null
  const thisWeekEnd = completedDaysThisWeek > 0 ? lastCompletedDay! : addDays(weekStart, -1)
  const thisWeekEndStr = format(thisWeekEnd, 'yyyy-MM-dd')
  const lastWeekStart = subWeeks(weekStart, 1)
  const lastWeekEnd = addDays(lastWeekStart, 6)
  const lastWeekStartStr = format(lastWeekStart, 'yyyy-MM-dd')
  const lastWeekEndStr = format(lastWeekEnd, 'yyyy-MM-dd')
  const thisWeekNum = getISOWeek(weekStart)
  const lastYearDate = new Date(weekStart.getFullYear() - 1, 5, 1)
  const lastYearWeekStart = startOfWeek(setISOWeek(lastYearDate, thisWeekNum), { weekStartsOn: 1 })
  const lastYearEnd = addDays(lastYearWeekStart, 6)
  const lastYearStartStr = format(lastYearWeekStart, 'yyyy-MM-dd')
  const lastYearEndStr = format(lastYearEnd, 'yyyy-MM-dd')
  const thisWeekCompleted = (thisWeekData ?? []).filter((s: any) => s.session_date <= thisWeekEndStr)
  const [lastWeekRes, lastYearRes, targetsRes] = await Promise.all([
    supabase.from('cashup_sessions').select('total_counted_amount, session_date').eq('site_id', site.id).is('voided_at', null)
      .gte('session_date', lastWeekStartStr).lte('session_date', lastWeekEndStr),
    supabase.from('cashup_sessions').select('total_counted_amount').eq('site_id', site.id).is('voided_at', null)
      .gte('session_date', lastYearStartStr).lte('session_date', lastYearEndStr),
    supabase.from('cashup_targets').select('*').eq('site_id', site.id).order('effective_from', { ascending: false }),
  ])
  const targets = targetsRes.data
  cashingUp.thisWeekTotal = thisWeekCompleted.reduce((sum: number, s: any) => sum + Number(s.total_counted_amount || 0), 0)
  cashingUp.lastWeekTotal = lastWeekRes.data?.reduce((sum: number, s: any) => sum + Number(s.total_counted_amount || 0), 0) || 0
  cashingUp.lastYearTotal = lastYearRes.data?.reduce((sum: number, s: any) => sum + Number(s.total_counted_amount || 0), 0) || 0
  cashingUp.sessionsSubmittedCount = thisWeekCompleted.filter((s: any) => s.status !== 'draft').length
  const fourteenDaysAgo = format(addDays(today, -13), 'yyyy-MM-dd')
  const { data: recentSessions } = await supabase.from('cashup_sessions')
    .select('total_counted_amount, session_date')
    .eq('site_id', site.id)
    .is('voided_at', null)
    .gte('session_date', fourteenDaysAgo)
    .lte('session_date', todayStr)
    .neq('status', 'draft')
    .order('session_date', { ascending: true })
  cashingUp.dailySessions = (recentSessions ?? [])
    .filter((s: any) => s.session_date)
    .map((s: any) => {
      const sessionDate = s.session_date as string
      const dayOfWeek = new Date(sessionDate + 'T12:00:00').getDay()
      const dayTarget = targets?.find((t: any) => t.day_of_week === dayOfWeek && t.effective_from <= sessionDate)
      return { date: sessionDate, amount: Number(s.total_counted_amount || 0), target: dayTarget ? Number(dayTarget.target_amount) : 0 }
    })
  let targetSum = 0
  if (completedDaysThisWeek > 0) {
    let d = new Date(weekStart)
    while (d <= thisWeekEnd) {
      const dayIso = format(d, 'yyyy-MM-dd')
      const dayOfWeek = d.getDay()
      const target = targets?.find((t: any) => t.day_of_week === dayOfWeek && t.effective_from <= dayIso)
      if (target) targetSum += target.target_amount
      d = addDays(d, 1)
    }
  }
  cashingUp.thisWeekTarget = targetSum
  return cashingUp
}

/** Deterministic pseudo-random numbers, so a failure reproduces. */
function prng(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function buildTables(seed: number, firstDay: string, lastDay: string): Record<string, Row[]> {
  const random = prng(seed)
  const sessions: Row[] = []
  for (let day = firstDay, i = 0; day <= lastDay; day = shiftIsoDate(day, 1)!, i += 1) {
    if (random() < 0.15) continue // no cash-up that day
    const status = [null, 'draft', 'submitted', 'approved', 'approved'][Math.floor(random() * 5)]
    const amount = random() < 0.1 ? null : random() < 0.5 ? Math.round(random() * 300000) / 100 : (Math.round(random() * 300000) / 100).toFixed(2)
    sessions.push({ id: `s-${i}`, site_id: 'site-1', session_date: day, status, total_counted_amount: amount, voided_at: random() < 0.08 ? '2026-01-01T00:00:00Z' : null })
    if (random() < 0.1) sessions.push({ id: `o-${i}`, site_id: 'site-2', session_date: day, status: 'approved', total_counted_amount: 999, voided_at: null })
  }
  const targets: Row[] = []
  for (const from of ['2024-01-01', '2025-09-15', '2026-04-06', '2026-11-11']) {
    for (let dow = 0; dow < 7; dow += 1) {
      if (random() < 0.2) continue
      targets.push({ id: `t-${from}-${dow}`, site_id: 'site-1', day_of_week: dow, effective_from: from, target_amount: Math.round(random() * 2000) })
    }
  }
  targets.push({ id: 't-other', site_id: 'site-2', day_of_week: 1, effective_from: '2020-01-01', target_amount: 77777 })
  return { sites: [{ id: 'site-1' }], cashup_sessions: sessions, cashup_targets: targets }
}

function everyDay(first: string, last: string): string[] {
  const days: string[] = []
  for (let day = first; day <= last; day = shiftIsoDate(day, 1)!) days.push(day)
  return days
}

describe('dashboard cashing-up figures', () => {
  const days = [
    ...everyDay('2025-12-15', '2027-01-20'), // a whole year, both clock changes, and ISO week 53 of 2026
    '2028-01-02', '2027-01-03', '2021-01-03', '2020-12-31', // more year-turn and week 53 edges
  ]

  it.each([1, 2, 3])('matches the old code on every day, data set %i', async (seed) => {
    const tables = buildTables(seed, '2019-06-01', '2028-01-31')
    for (const todayIso of days) {
      const expected = await referenceFigures(fakeDb(tables).client, todayIso)
      const actual = await loadCashingUpFigures(fakeDb(tables).client as any, todayIso)
      expect({ todayIso, ...actual }).toEqual({ todayIso, ...expected })
    }
  })

  it('agrees with the old date ranges exactly', () => {
    for (const todayIso of days) {
      const today = new Date(todayIso)
      const weekStart = startOfWeek(today, { weekStartsOn: 1 })
      const lastYearWeekStart = startOfWeek(setISOWeek(new Date(weekStart.getFullYear() - 1, 5, 1), getISOWeek(weekStart)), { weekStartsOn: 1 })
      expect(cashingUpRanges(todayIso)).toEqual({
        weekStart: format(weekStart, 'yyyy-MM-dd'),
        lastWeekStart: format(subWeeks(weekStart, 1), 'yyyy-MM-dd'),
        lastWeekEnd: format(addDays(subWeeks(weekStart, 1), 6), 'yyyy-MM-dd'),
        lastYearStart: format(lastYearWeekStart, 'yyyy-MM-dd'),
        lastYearEnd: format(addDays(lastYearWeekStart, 6), 'yyyy-MM-dd'),
        fourteenDaysAgo: format(addDays(today, -13), 'yyyy-MM-dd'),
      })
    }
  })

  it('keeps this week and last week inside the one 14-day read', () => {
    for (const todayIso of days) {
      const ranges = cashingUpRanges(todayIso)
      expect(ranges.lastWeekStart >= ranges.fourteenDaysAgo).toBe(true)
      expect(ranges.weekStart <= todayIso).toBe(true)
    }
  })

  it('reads the site, then four queries in one batch (was six in four stages)', async () => {
    const db = fakeDb(buildTables(1, '2026-01-01', '2026-12-31'))
    await loadCashingUpFigures(db.client as any, '2026-11-18')
    expect(db.queries).toEqual(['sites', 'cashup_sessions', 'cashup_sessions', 'cashup_targets'])
  })

  it('returns nothing without a site, as before', async () => {
    const tables = buildTables(1, '2026-01-01', '2026-12-31')
    tables.sites = []
    expect(await loadCashingUpFigures(fakeDb(tables).client as any, '2026-11-18')).toBeNull()
    expect(await referenceFigures(fakeDb(tables).client, '2026-11-18')).toBeNull()
  })
})
