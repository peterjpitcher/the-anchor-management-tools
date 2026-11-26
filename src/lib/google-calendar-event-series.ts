import 'server-only'

/**
 * Repeating events in the Pub Ops Google Calendar: ONE repeating entry per series, a weekly rule
 * with an end date if set and an excluded date for each skip (by hand, made a full event, or the
 * pub closed in special hours). Removed while the series is paused or ended.
 *
 * The entry id starts "aes", not "aev": the events orphan sweep deletes every "aev" entry that is
 * not built from a current events row, and a series has no events row.
 *
 * A content hash on the entry means an unchanged series is never written, so the 15-minute cron
 * does not send calendar change notifications every run.
 */
import { createHash } from 'crypto'
import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { getOAuth2Client } from '@/lib/google-calendar'
import { PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID } from '@/lib/google-calendar-targets'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { getTodayIsoDate, getIsoWeekday, shiftIsoDate } from '@/lib/dateUtils'
import { resolveSeriesOccurrences, seriesCrossesMidnight, describeSeriesSchedule } from '@/lib/events/series'
import { loadEventSeries, loadSeriesClosedDays, type EventSeriesWithSkips } from '@/lib/events/series-data'
import type { SeriesSpecialHoursDay } from '@/lib/events/series'

const CALENDAR_TIME_ZONE = 'Europe/London'
const SOURCE_PROPERTY = 'anchor_event_series'
/** How far ahead closures in special hours are written as excluded dates. */
const CLOSURE_HORIZON_DAYS = 400
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

const calendar = google.calendar('v3')

export type EventSeriesCalendarSyncResult =
  | { state: 'created' | 'updated' | 'deleted' | 'skipped'; seriesId: string; googleEventId: string; reason?: string }
  | { state: 'failed'; seriesId: string; googleEventId: string; reason: string }

export function generateEventSeriesCalendarEventId(seriesId: string): string {
  const digest = createHash('sha256').update(`anchor-event-series:${seriesId}`).digest('hex')
  return `aes${digest.slice(0, 48)}`
}

function hasCalendarAuthConfig(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
      (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN)
  )
}

function googleStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const e = error as { status?: number; code?: string | number; response?: { status?: number } }
  if (typeof e.status === 'number') return e.status
  if (typeof e.code === 'number') return e.code
  if (typeof e.response?.status === 'number') return e.response.status
  return undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The first date on or after `from` that falls on the weekday. */
function firstOnWeekday(from: string, weekday: number): string | null {
  for (let i = 0; i < 7; i += 1) {
    const date = shiftIsoDate(from, i)
    if (date && getIsoWeekday(date) === weekday) return date
  }
  return null
}

function compactDate(date: string): string {
  return date.replace(/-/g, '')
}

function compactTime(time: string): string {
  return `${time.slice(0, 2)}${time.slice(3, 5)}00`
}

export interface EventSeriesCalendarBody {
  id: string
  summary: string
  description: string
  location: string
  status: 'confirmed'
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  recurrence: string[]
  extendedProperties: { private: Record<string, string> }
}

/**
 * The calendar entry for a series, or null when it should not be on the calendar (paused, ended,
 * or its last date is before its first run). Pure: `today` and the closed days are passed in.
 */
export function buildEventSeriesCalendarBody(
  series: EventSeriesWithSkips,
  closedDays: readonly SeriesSpecialHoursDay[],
  today: string
): EventSeriesCalendarBody | null {
  if (series.status !== 'active') return null
  const firstDate = firstOnWeekday(series.startsOn, series.weekday)
  if (!firstDate) return null
  if (series.endsOn && series.endsOn < firstDate) return null

  const endDate = seriesCrossesMidnight(series) ? shiftIsoDate(firstDate, 1) : firstDate
  if (!endDate) return null

  // Every date the rule produces but the night does not run, as the resolver sees it.
  const horizon = shiftIsoDate(today, CLOSURE_HORIZON_DAYS) ?? today
  const rangeEnd = series.endsOn && series.endsOn < horizon ? series.endsOn : horizon
  const excluded = new Set(series.skips.map((skip) => skip.skipDate))
  const { skipped } = resolveSeriesOccurrences(series, series.skips, closedDays, firstDate, rangeEnd)
  for (const skip of skipped) excluded.add(skip.date)

  const rrule = [`FREQ=WEEKLY`, `BYDAY=${BYDAY[series.weekday - 1]}`]
  // UNTIL is in UTC for a timed event; the end of that London day in UTC is safely after the
  // start on the last date and before the next week's.
  if (series.endsOn) rrule.push(`UNTIL=${compactDate(series.endsOn)}T235959Z`)

  const recurrence = [`RRULE:${rrule.join(';')}`]
  const exdates = [...excluded]
    .filter((date) => date >= firstDate && getIsoWeekday(date) === series.weekday)
    .sort()
    .map((date) => `${compactDate(date)}T${compactTime(series.startTime)}`)
  if (exdates.length > 0) recurrence.push(`EXDATE;TZID=${CALENDAR_TIME_ZONE}:${exdates.join(',')}`)

  const id = generateEventSeriesCalendarEventId(series.id)
  const descriptionLines = [
    describeSeriesSchedule(series),
    series.shortDescription,
    series.audienceNote ?? '',
    series.isFree ? 'Free' : '',
    'Repeating event: change it in the management app, Events, Repeating events.',
  ].filter(Boolean)

  const content = {
    summary: series.name,
    description: descriptionLines.join('\n'),
    location: 'The Anchor',
    status: 'confirmed' as const,
    start: { dateTime: `${firstDate}T${series.startTime}:00`, timeZone: CALENDAR_TIME_ZONE },
    end: { dateTime: `${endDate}T${series.endTime}:00`, timeZone: CALENDAR_TIME_ZONE },
    recurrence,
  }
  const contentHash = createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 32)

  return {
    id,
    ...content,
    extendedProperties: { private: { source: SOURCE_PROPERTY, anchorEventSeriesId: series.id, contentHash } },
  }
}

type Auth = OAuth2Client

async function writeEntry(auth: Auth, seriesId: string, body: EventSeriesCalendarBody): Promise<EventSeriesCalendarSyncResult> {
  const googleEventId = body.id
  let exists = false
  try {
    const existing = await calendar.events.get({ auth, calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID, eventId: googleEventId })
    exists = true
    const sameHash = existing.data.extendedProperties?.private?.contentHash === body.extendedProperties.private.contentHash
    if (sameHash && existing.data.status !== 'cancelled') {
      return { state: 'skipped', seriesId, googleEventId, reason: 'unchanged' }
    }
  } catch (error) {
    const status = googleStatus(error)
    if (status !== 404 && status !== 410) {
      return { state: 'failed', seriesId, googleEventId, reason: errorMessage(error) }
    }
  }

  try {
    if (exists) {
      // A deleted entry comes back from get with status "cancelled"; updating it with
      // status "confirmed" restores it under the same id.
      await calendar.events.update({ auth, calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID, eventId: googleEventId, requestBody: body })
      return { state: 'updated', seriesId, googleEventId }
    }
    await calendar.events.insert({ auth, calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID, requestBody: body })
    return { state: 'created', seriesId, googleEventId }
  } catch (error) {
    return { state: 'failed', seriesId, googleEventId, reason: errorMessage(error) }
  }
}

async function removeEntry(auth: Auth, seriesId: string): Promise<EventSeriesCalendarSyncResult> {
  const googleEventId = generateEventSeriesCalendarEventId(seriesId)
  try {
    const existing = await calendar.events.get({ auth, calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID, eventId: googleEventId })
    if (existing.data.status === 'cancelled') return { state: 'skipped', seriesId, googleEventId, reason: 'already_removed' }
    await calendar.events.delete({ auth, calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID, eventId: googleEventId })
    return { state: 'deleted', seriesId, googleEventId }
  } catch (error) {
    const status = googleStatus(error)
    if (status === 404 || status === 410) return { state: 'skipped', seriesId, googleEventId, reason: 'already_missing' }
    return { state: 'failed', seriesId, googleEventId, reason: errorMessage(error) }
  }
}

async function syncOne(
  auth: Auth,
  series: EventSeriesWithSkips,
  closedDays: readonly SeriesSpecialHoursDay[],
  today: string
): Promise<EventSeriesCalendarSyncResult> {
  const body = buildEventSeriesCalendarBody(series, closedDays, today)
  const result = body ? await writeEntry(auth, series.id, body) : await removeEntry(auth, series.id)

  if (result.state === 'failed') {
    logger.warn('Failed to sync repeating event calendar entry', {
      metadata: { seriesId: series.id, googleEventId: result.googleEventId, error: result.reason },
    })
    return result
  }

  const storedId = body ? result.googleEventId : null
  if (series.googleCalendarEventId !== storedId) {
    const { error } = await createAdminClient()
      .from('event_series')
      .update({ google_calendar_event_id: storedId })
      .eq('id', series.id)
    if (error) {
      logger.warn('Failed to record repeating event calendar id', { metadata: { seriesId: series.id, error: error.message } })
    }
  }
  return result
}

/** Syncs one series' calendar entry (after a staff change). Never throws. */
export async function syncEventSeriesCalendarEntry(seriesId: string): Promise<EventSeriesCalendarSyncResult> {
  const googleEventId = generateEventSeriesCalendarEventId(seriesId)
  if (!hasCalendarAuthConfig()) return { state: 'skipped', seriesId, googleEventId, reason: 'calendar_not_configured' }
  try {
    const db = createAdminClient()
    const today = getTodayIsoDate()
    const [series] = await loadEventSeries(db, { id: seriesId })
    const auth = (await getOAuth2Client()) as unknown as Auth
    if (!series) return await removeEntry(auth, seriesId)
    const closedDays = await loadSeriesClosedDays(db, today, shiftIsoDate(today, CLOSURE_HORIZON_DAYS) ?? today)
    return await syncOne(auth, series, closedDays, today)
  } catch (error) {
    logger.warn('Repeating event calendar sync failed', { metadata: { seriesId, error: errorMessage(error) } })
    return { state: 'failed', seriesId, googleEventId, reason: errorMessage(error) }
  }
}

/**
 * For the 15-minute calendar cron: ends any run whose last date has passed, then re-syncs every
 * series, so a closure added in special hours becomes an excluded date. Unchanged entries are
 * skipped by their content hash.
 */
export async function syncAllEventSeriesCalendarEntries(): Promise<{
  ended: number
  results: EventSeriesCalendarSyncResult[]
}> {
  const db = createAdminClient()
  const today = getTodayIsoDate()

  const { data: endedRows, error: endError } = await db
    .from('event_series')
    .update({ status: 'ended' })
    .eq('status', 'active')
    .lt('ends_on', today)
    .select('id')
  if (endError) logger.warn('Failed to end finished repeating events', { metadata: { error: endError.message } })

  if (!hasCalendarAuthConfig()) return { ended: endedRows?.length ?? 0, results: [] }

  const series = await loadEventSeries(db)
  // Only series that are or were on the calendar need a call: an ended or paused series that
  // has no entry recorded is left alone.
  const relevant = series.filter((s) => s.status === 'active' || s.googleCalendarEventId)
  if (relevant.length === 0) return { ended: endedRows?.length ?? 0, results: [] }

  const closedDays = await loadSeriesClosedDays(db, today, shiftIsoDate(today, CLOSURE_HORIZON_DAYS) ?? today)
  const auth = (await getOAuth2Client()) as unknown as Auth
  const results: EventSeriesCalendarSyncResult[] = []
  for (const s of relevant) results.push(await syncOne(auth, s, closedDays, today))
  return { ended: endedRows?.length ?? 0, results }
}
