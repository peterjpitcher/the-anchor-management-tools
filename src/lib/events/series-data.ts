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
  /** The descriptive fields a normal event has (migration 20261127121431). */
  details: EventSeriesDetails
  images: EventSeriesImages
}

/** Copy, price and promotion text, saved by the form. */
export interface EventSeriesDetails {
  brief: string | null
  performerName: string | null
  performerType: string | null
  /** Standard ticket price in pounds; null when free. */
  price: number | null
  metaTitle: string | null
  metaDescription: string | null
  longDescription: string | null
  highlights: string[]
  primaryKeywords: string[]
  secondaryKeywords: string[]
  localSeoKeywords: string[]
  imageAltText: string | null
  accessibilityNotes: string | null
  facebookEventName: string | null
  facebookEventDescription: string | null
  gbpEventTitle: string | null
  gbpEventDescription: string | null
  socialCopyWhatsapp: string | null
}

/** Public URLs of the uploaded pictures. Written only by the image actions, never by the form save. */
export interface EventSeriesImages {
  square: string | null
  landscape: string | null
  social: string | null
  story: string | null
  printPoster: string | null
}

export type EventSeriesImageVariant = 'square' | 'landscape' | 'social' | 'story' | 'print_poster'

/** The event_series column each picture is cached in. */
export const EVENT_SERIES_IMAGE_COLUMNS: Record<EventSeriesImageVariant, keyof EventSeriesRow> = {
  square: 'square_image_url',
  landscape: 'landscape_image_url',
  social: 'social_image_url',
  story: 'story_image_url',
  print_poster: 'print_poster_url',
}

export interface EventSeriesWithSkips extends EventSeries {
  skips: EventSeriesSkip[]
}

export const EVENT_SERIES_COLUMNS =
  'id, name, slug, category_id, weekday, start_time, end_time, starts_on, ends_on, short_description, page_path, is_free, audience_note, skip_when_closed, status, google_calendar_event_id, created_at, updated_at, ' +
  'brief, performer_name, performer_type, price, meta_title, meta_description, long_description, highlights, ' +
  'primary_keywords, secondary_keywords, local_seo_keywords, image_alt_text, accessibility_notes, ' +
  'facebook_event_name, facebook_event_description, gbp_event_title, gbp_event_description, social_copy_whatsapp, ' +
  'square_image_url, landscape_image_url, social_image_url, story_image_url, print_poster_url'

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
  brief: string | null
  performer_name: string | null
  performer_type: string | null
  /** numeric comes back from PostgREST as a number, or a string for large values. */
  price: number | string | null
  meta_title: string | null
  meta_description: string | null
  long_description: string | null
  highlights: string[] | null
  primary_keywords: string[] | null
  secondary_keywords: string[] | null
  local_seo_keywords: string[] | null
  image_alt_text: string | null
  accessibility_notes: string | null
  facebook_event_name: string | null
  facebook_event_description: string | null
  gbp_event_title: string | null
  gbp_event_description: string | null
  social_copy_whatsapp: string | null
  square_image_url: string | null
  landscape_image_url: string | null
  social_image_url: string | null
  story_image_url: string | null
  print_poster_url: string | null
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
    details: {
      brief: row.brief ?? null,
      performerName: row.performer_name ?? null,
      performerType: row.performer_type ?? null,
      price: row.price === null || row.price === undefined ? null : Number(row.price),
      metaTitle: row.meta_title ?? null,
      metaDescription: row.meta_description ?? null,
      longDescription: row.long_description ?? null,
      highlights: row.highlights ?? [],
      primaryKeywords: row.primary_keywords ?? [],
      secondaryKeywords: row.secondary_keywords ?? [],
      localSeoKeywords: row.local_seo_keywords ?? [],
      imageAltText: row.image_alt_text ?? null,
      accessibilityNotes: row.accessibility_notes ?? null,
      facebookEventName: row.facebook_event_name ?? null,
      facebookEventDescription: row.facebook_event_description ?? null,
      gbpEventTitle: row.gbp_event_title ?? null,
      gbpEventDescription: row.gbp_event_description ?? null,
      socialCopyWhatsapp: row.social_copy_whatsapp ?? null,
    },
    images: {
      square: row.square_image_url ?? null,
      landscape: row.landscape_image_url ?? null,
      social: row.social_image_url ?? null,
      story: row.story_image_url ?? null,
      printPoster: row.print_poster_url ?? null,
    },
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

  const rows = (seriesRows ?? []) as unknown as EventSeriesRow[]
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
