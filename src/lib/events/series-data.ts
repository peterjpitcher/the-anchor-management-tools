import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  resolveSeriesOccurrences,
  type EventSeriesRule,
  type EventSeriesSkip,
  type EventSeriesStatus,
  type SeriesOccurrence,
  type SeriesSpecialHoursDay,
} from '@/lib/events/series'

/** A repeating event as the app uses it (camelCase, mapped by hand from event_series). */
export interface EventSeries extends EventSeriesRule {
  name: string
  slug: string
  categoryId: string | null
  shortDescription: string
  pagePath: string | null
  isFree: boolean
  audienceNote: string | null
  googleCalendarEventId: string | null
  createdAt: string
  updatedAt: string
}

export interface EventSeriesWithSkips extends EventSeries {
  skips: EventSeriesSkip[]
}

export const EVENT_SERIES_COLUMNS =
  'id, name, slug, category_id, weekday, start_time, end_time, starts_on, ends_on, short_description, page_path, is_free, audience_note, skip_when_closed, status, google_calendar_event_id, created_at, updated_at'

export interface EventSeriesRow {
  id: string
  name: string
  slug: string
  category_id: string | null
  weekday: number
  start_time: string
  end_time: string
  starts_on: string
  ends_on: string | null
  short_description: string
  page_path: string | null
  is_free: boolean
  audience_note: string | null
  skip_when_closed: boolean
  status: string
  google_calendar_event_id: string | null
  created_at: string
  updated_at: string
}

interface EventSeriesSkipRow {
  series_id: string
  skip_date: string
  reason: string | null
  replaced_by_event_id: string | null
}

function toStatus(value: string): EventSeriesStatus {
  return value === 'paused' || value === 'ended' ? value : 'active'
}

export function mapEventSeriesRow(row: EventSeriesRow): EventSeries {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    categoryId: row.category_id,
    weekday: row.weekday,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    shortDescription: row.short_description,
    pagePath: row.page_path,
    isFree: row.is_free,
    audienceNote: row.audience_note,
    skipWhenClosed: row.skip_when_closed,
    status: toStatus(row.status),
    googleCalendarEventId: row.google_calendar_event_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

type Db = SupabaseClient

/** Every series (optionally one status) with its skips, ordered by name. Throws on a read failure. */
export async function loadEventSeries(
  db: Db = createAdminClient(),
  options: { statuses?: EventSeriesStatus[]; id?: string } = {}
): Promise<EventSeriesWithSkips[]> {
  let query = db.from('event_series').select(EVENT_SERIES_COLUMNS).order('name', { ascending: true })
  if (options.statuses?.length) query = query.in('status', options.statuses)
  if (options.id) query = query.eq('id', options.id)
  const { data: seriesRows, error } = await query
  if (error) throw new Error(`event_series read failed: ${error.message}`)

  const rows = (seriesRows ?? []) as EventSeriesRow[]
  if (rows.length === 0) return []

  const { data: skipRows, error: skipError } = await db
    .from('event_series_skips')
    .select('series_id, skip_date, reason, replaced_by_event_id')
    .in('series_id', rows.map((row) => row.id))
    .order('skip_date', { ascending: true })
  if (skipError) throw new Error(`event_series_skips read failed: ${skipError.message}`)

  const skipsBySeries = new Map<string, EventSeriesSkip[]>()
  for (const skip of (skipRows ?? []) as EventSeriesSkipRow[]) {
    const list = skipsBySeries.get(skip.series_id) ?? []
    list.push({ skipDate: skip.skip_date, reason: skip.reason, replacedByEventId: skip.replaced_by_event_id })
    skipsBySeries.set(skip.series_id, list)
  }

  return rows.map((row) => ({ ...mapEventSeriesRow(row), skips: skipsBySeries.get(row.id) ?? [] }))
}

/** Days the pub is fully closed in special hours between two dates. Throws on a read failure. */
export async function loadSeriesClosedDays(
  db: Db,
  from: string,
  to: string
): Promise<SeriesSpecialHoursDay[]> {
  const { data, error } = await db
    .from('special_hours')
    .select('date, is_closed')
    .gte('date', from)
    .lte('date', to)
  if (error) throw new Error(`special_hours read failed: ${error.message}`)
  return ((data ?? []) as Array<{ date: string; is_closed: boolean | null }>).map((row) => ({
    date: row.date,
    isClosed: row.is_closed === true,
  }))
}

export interface SeriesOccurrenceWithSeries extends SeriesOccurrence {
  seriesId: string
  name: string
  categoryId: string | null
}

/**
 * Every occurrence of every active series between two dates, sorted by start. For the staff
 * screens that describe a day (FOH, rota, private-hire night, Events calendar).
 */
export async function loadSeriesOccurrencesInRange(
  from: string,
  to: string,
  db: Db = createAdminClient()
): Promise<SeriesOccurrenceWithSeries[]> {
  const series = await loadEventSeries(db, { statuses: ['active'] })
  if (series.length === 0) return []
  const closedDays = await loadSeriesClosedDays(db, from, to)
  const result: SeriesOccurrenceWithSeries[] = []
  for (const s of series) {
    for (const occurrence of resolveSeriesOccurrences(s, s.skips, closedDays, from, to).occurrences) {
      result.push({ ...occurrence, seriesId: s.id, name: s.name, categoryId: s.categoryId })
    }
  }
  return result.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}
