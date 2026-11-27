'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/supabase/current-user'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getTodayIsoDate, isValidIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import {
  isSeriesWeekday,
  nextSeriesOccurrence,
  resolveSeriesOccurrences,
  type SeriesOccurrence,
  type SeriesSkippedDate,
  type SeriesSpecialHoursDay,
} from '@/lib/events/series'
import {
  EVENT_SERIES_COLUMNS,
  loadEventSeries,
  loadSeriesClosedDays,
  loadSeriesOccurrencesInRange,
  mapEventSeriesRow,
  type EventSeries,
  type EventSeriesRow,
  type EventSeriesWithSkips,
} from '@/lib/events/series-data'
import { syncEventSeriesCalendarEntry } from '@/lib/google-calendar-event-series'
import { getErrorMessage } from '@/lib/errors'

type ActionResult<T = undefined> = Promise<{ success?: boolean; error?: string; data?: T }>

/** How far ahead the staff screens look for dates to show, skip and preview. */
const STAFF_WINDOW_DAYS = 400

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
const isoDate = z.string().refine(isValidIsoDate, 'Enter a real date')
const optionalText = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((value) => (value ? value : null))

/** Optional text with its own cap; empty becomes null. */
function textUpTo(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullish()
    .transform((value) => (value ? value : null))
}

/** A list of short phrases; blanks dropped, each trimmed. */
function phraseList(maxItems: number, maxChars = 120) {
  return z
    .array(z.string())
    .nullish()
    .transform((values) => (values ?? []).map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(maxChars, `Keep each to ${maxChars} characters`)).max(maxItems, `Use ${maxItems} or fewer`))
}

/** The descriptive fields a normal event has. Limits match the events service (src/services/events.ts). */
const detailsSchema = z.object({
  brief: textUpTo(5000),
  performerName: textUpTo(255),
  performerType: textUpTo(255),
  price: z.number().positive('The price must be more than zero').max(10000).nullish().transform((v) => v ?? null),
  metaTitle: textUpTo(255),
  metaDescription: textUpTo(500),
  longDescription: textUpTo(10000),
  highlights: phraseList(10, 200),
  primaryKeywords: phraseList(3),
  secondaryKeywords: phraseList(6),
  localSeoKeywords: phraseList(4),
  imageAltText: textUpTo(200),
  accessibilityNotes: textUpTo(1000),
  facebookEventName: textUpTo(255),
  facebookEventDescription: textUpTo(5000),
  gbpEventTitle: textUpTo(255),
  gbpEventDescription: textUpTo(1500),
  socialCopyWhatsapp: textUpTo(300),
})

const seriesInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower case letters, numbers and hyphens'),
    categoryId: z.string().uuid().nullish().transform((value) => value ?? null),
    weekday: z.number().int().min(1).max(7),
    startTime: z.string().regex(timePattern, 'Use a time like 19:00'),
    endTime: z.string().regex(timePattern, 'Use a time like 22:00'),
    startsOn: isoDate,
    endsOn: isoDate.nullish().transform((value) => value ?? null),
    shortDescription: z.string().trim().min(1, 'A short description is required').max(500),
    pagePath: z
      .string()
      .trim()
      .regex(/^\/[A-Za-z0-9/_-]*$/, 'The page must start with "/"')
      .nullish()
      .or(z.literal(''))
      .transform((value) => (value ? value : null)),
    isFree: z.boolean(),
    audienceNote: optionalText,
    skipWhenClosed: z.boolean(),
    /** Left out, the stored details are kept as they are (an older screen or the agent bridge). */
    details: detailsSchema.optional(),
  })
  .refine((v) => v.isFree || !v.details || v.details.price !== null, { message: 'Enter the ticket price, or tick Free', path: ['details', 'price'] })
  .refine((v) => v.startTime !== v.endTime, { message: 'The start and end times are the same', path: ['endTime'] })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, { message: 'The last date is before the first', path: ['endsOn'] })

export type EventSeriesInput = z.input<typeof seriesInputSchema>

/** Each field's name as the repeating event form shows it, so an error says which box to fix. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  slug: 'Slug',
  categoryId: 'Category',
  weekday: 'Day',
  startTime: 'Start time',
  endTime: 'End time',
  startsOn: 'First date',
  endsOn: 'Last date',
  shortDescription: 'Short description',
  pagePath: 'Website page',
  audienceNote: 'Who it is for',
  brief: 'Brief',
  performerName: 'Host or performer',
  performerType: 'Host or performer type',
  price: 'Price',
  metaTitle: 'Meta title',
  metaDescription: 'Meta description',
  longDescription: 'Long description',
  highlights: 'Highlights',
  primaryKeywords: 'Focus keywords',
  secondaryKeywords: 'Supporting keywords',
  localSeoKeywords: 'Local keywords',
  imageAltText: 'Image alt text',
  accessibilityNotes: 'Accessibility notes',
  facebookEventName: 'Facebook event name',
  facebookEventDescription: 'Facebook event description',
  gbpEventTitle: 'Google Business Profile title',
  gbpEventDescription: 'Google Business Profile description',
  socialCopyWhatsapp: 'WhatsApp message',
  date: 'Date',
  reason: 'Reason',
}

/**
 * The first problem with the form, led by the field's name ("Supporting keywords: use 6 or
 * fewer"). A message that already names its field is left as it is.
 */
function describeSeriesIssue(error: z.ZodError, fallback: string): string {
  const issue = error.issues[0]
  if (!issue) return fallback
  const key = [...issue.path].reverse().find((part): part is string => typeof part === 'string')
  const label = key ? FIELD_LABELS[key] : undefined
  if (!label) return issue.message

  let message = issue.message
  if (issue.code === 'too_big') {
    const perItem = typeof issue.path[issue.path.length - 1] === 'number'
    message = perItem
      ? `Keep each to ${issue.maximum} characters`
      : issue.type === 'string'
        ? `Use ${issue.maximum} characters or fewer`
        : issue.type === 'array'
          ? `Use ${issue.maximum} or fewer`
          : issue.message
  }
  if (message.toLowerCase().includes(label.toLowerCase())) return message
  return `${label}: ${message.charAt(0).toLowerCase()}${message.slice(1)}`
}

function toRow(input: z.output<typeof seriesInputSchema>) {
  return {
    ...ruleRow(input),
    ...(input.details ? detailsRow(input.details, input.isFree) : input.isFree ? { price: null } : {}),
  }
}

function detailsRow(d: z.output<typeof detailsSchema>, isFree: boolean) {
  return {
    brief: d.brief,
    performer_name: d.performerName,
    performer_type: d.performerType,
    price: isFree ? null : d.price,
    meta_title: d.metaTitle,
    meta_description: d.metaDescription,
    long_description: d.longDescription,
    highlights: d.highlights,
    primary_keywords: d.primaryKeywords,
    secondary_keywords: d.secondaryKeywords,
    local_seo_keywords: d.localSeoKeywords,
    image_alt_text: d.imageAltText,
    accessibility_notes: d.accessibilityNotes,
    facebook_event_name: d.facebookEventName,
    facebook_event_description: d.facebookEventDescription,
    gbp_event_title: d.gbpEventTitle,
    gbp_event_description: d.gbpEventDescription,
    social_copy_whatsapp: d.socialCopyWhatsapp,
  }
}

function ruleRow(input: z.output<typeof seriesInputSchema>) {
  return {
    name: input.name,
    slug: input.slug,
    category_id: input.categoryId,
    weekday: input.weekday,
    start_time: input.startTime,
    end_time: input.endTime,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    short_description: input.shortDescription,
    page_path: input.pagePath,
    is_free: input.isFree,
    audience_note: input.audienceNote,
    skip_when_closed: input.skipWhenClosed,
    // Image URLs are deliberately absent from every row the form writes: the image actions own them,
    // so saving the form can never blank the artwork.
  }
}

async function requirePermission(action: 'view' | 'manage'): Promise<{ userId: string; email: string | null } | { error: string }> {
  const { user } = await getCurrentUser()
  if (!user) return { error: 'Unauthorized' }
  const allowed = await checkUserPermission('events', action, user.id)
  if (!allowed) return { error: 'Insufficient permissions' }
  return { userId: user.id, email: user.email ?? null }
}

async function audit(
  actor: { userId: string; email: string | null },
  operation: string,
  seriesId: string,
  details: { old_values?: Record<string, unknown>; new_values?: Record<string, unknown>; additional_info?: Record<string, unknown> }
): Promise<void> {
  await logAuditEvent({
    user_id: actor.userId,
    ...(actor.email ? { user_email: actor.email } : {}),
    operation_type: operation,
    resource_type: 'event_series',
    resource_id: seriesId,
    operation_status: 'success',
    ...details,
  })
}

/** Keeps the one repeating Pub Ops calendar entry in step. A calendar failure never undoes a save. */
async function afterSeriesChange(seriesId: string): Promise<string | undefined> {
  revalidatePath('/events')
  try {
    const result = await syncEventSeriesCalendarEntry(seriesId)
    if (result.state === 'failed') return 'Saved, but the Pub Ops calendar could not be updated. It will retry within 15 minutes.'
  } catch (error) {
    console.error('[event-series] calendar sync failed', { seriesId, message: getErrorMessage(error) })
    return 'Saved, but the Pub Ops calendar could not be updated. It will retry within 15 minutes.'
  }
  return undefined
}

export interface EventSeriesListItem extends EventSeriesWithSkips {
  nextOccurrence: SeriesOccurrence | null
  /** Upcoming occurrences and skipped dates, for the preview and the skip picker. */
  upcoming: SeriesOccurrence[]
  upcomingSkipped: SeriesSkippedDate[]
}

export interface EventSeriesListData {
  series: EventSeriesListItem[]
  /** Fully closed days ahead, so the drawer preview can run the same resolver on unsaved values. */
  closedDays: SeriesSpecialHoursDay[]
  today: string
}

/** Every repeating event with its next date and the dates ahead. Needs events:view. */
export async function listEventSeries(): ActionResult<EventSeriesListData> {
  const actor = await requirePermission('view')
  if ('error' in actor) return { error: actor.error }

  try {
    const db = createAdminClient()
    const today = getTodayIsoDate()
    const horizon = shiftIsoDate(today, STAFF_WINDOW_DAYS) ?? today
    // Closures from yesterday, where nextSeriesOccurrence starts (a night past midnight).
    const [series, closedDays] = await Promise.all([
      loadEventSeries(db),
      loadSeriesClosedDays(db, shiftIsoDate(today, -1) ?? today, horizon),
    ])

    const items = series.map((s) => {
      // A paused or ended series resolves to nothing; show staff what it would run on if resumed.
      const asActive = { ...s, status: 'active' as const }
      const { occurrences, skipped } = resolveSeriesOccurrences(asActive, s.skips, closedDays, today, horizon)
      return {
        ...s,
        nextOccurrence: s.status === 'active' ? nextSeriesOccurrence(s, s.skips, closedDays) : null,
        upcoming: occurrences,
        upcomingSkipped: skipped,
      }
    })
    return { success: true, data: { series: items, closedDays, today } }
  } catch (error) {
    console.error('[event-series] list failed', { message: getErrorMessage(error) })
    return { error: 'Repeating events could not be loaded' }
  }
}

/** Creates a repeating event. Needs events:manage. */
export async function createEventSeries(input: EventSeriesInput): ActionResult<{ series: EventSeries; warning?: string }> {
  const actor = await requirePermission('manage')
  if ('error' in actor) return { error: actor.error }

  const parsed = seriesInputSchema.safeParse(input)
  if (!parsed.success) return { error: describeSeriesIssue(parsed.error, 'Check the form') }

  const db = createAdminClient()
  const { data, error } = await db
    .from('event_series')
    .insert({ ...toRow(parsed.data), status: 'active', created_by: actor.userId })
    .select(EVENT_SERIES_COLUMNS)
    .single()
  if (error || !data) {
    if (error?.code === '23505') return { error: 'Another repeating event already uses that slug' }
    console.error('[event-series] create failed', { code: error?.code, message: error?.message, details: error?.details })
    return { error: 'The repeating event could not be saved' }
  }

  const series = mapEventSeriesRow(data as unknown as EventSeriesRow)
  await audit(actor, 'create', series.id, { new_values: toRow(parsed.data) })
  const warning = await afterSeriesChange(series.id)
  return { success: true, data: { series, warning } }
}

/** Edits a repeating event. Refuses a weekday change while dates ahead are skipped on the old day. */
export async function updateEventSeries(id: string, input: EventSeriesInput): ActionResult<{ warning?: string }> {
  const actor = await requirePermission('manage')
  if ('error' in actor) return { error: actor.error }
  if (!z.string().uuid().safeParse(id).success) return { error: 'Repeating event not found' }

  const parsed = seriesInputSchema.safeParse(input)
  if (!parsed.success) return { error: describeSeriesIssue(parsed.error, 'Check the form') }

  const db = createAdminClient()
  const [existing] = await loadEventSeries(db, { id })
  if (!existing) return { error: 'Repeating event not found' }

  if (existing.weekday !== parsed.data.weekday) {
    const today = getTodayIsoDate()
    const stranded = existing.skips.filter((skip) => skip.skipDate >= today)
    if (stranded.length > 0) {
      return { error: 'Undo the skipped dates ahead before changing the day, as they are on the old day' }
    }
  }

  const { error } = await db.from('event_series').update(toRow(parsed.data)).eq('id', id)
  if (error) {
    if (error.code === '23505') return { error: 'Another repeating event already uses that slug' }
    console.error('[event-series] update failed', { code: error.code, message: error.message, details: error.details })
    return { error: 'The repeating event could not be saved' }
  }

  const { skips: _skips, ...oldValues } = existing
  await audit(actor, 'update', id, { old_values: oldValues, new_values: toRow(parsed.data) })
  const warning = await afterSeriesChange(id)
  return { success: true, data: { warning } }
}

const skipSchema = z.object({
  seriesId: z.string().uuid(),
  date: isoDate,
  reason: optionalText,
})

/** Skips one date. The date must fall on the series weekday. */
export async function skipEventSeriesDate(input: z.input<typeof skipSchema>): ActionResult<{ warning?: string }> {
  const actor = await requirePermission('manage')
  if ('error' in actor) return { error: actor.error }
  const parsed = skipSchema.safeParse(input)
  if (!parsed.success) return { error: describeSeriesIssue(parsed.error, 'Check the date') }

  const db = createAdminClient()
  const [series] = await loadEventSeries(db, { id: parsed.data.seriesId })
  if (!series) return { error: 'Repeating event not found' }
  if (!isSeriesWeekday(series, parsed.data.date)) {
    return { error: 'That date is not on the day this night runs' }
  }
  if (series.skips.some((skip) => skip.skipDate === parsed.data.date)) {
    return { error: 'That date is already skipped' }
  }

  const { error } = await db.from('event_series_skips').insert({
    series_id: series.id,
    skip_date: parsed.data.date,
    reason: parsed.data.reason,
    created_by: actor.userId,
  })
  if (error) {
    console.error('[event-series] skip failed', { code: error.code, message: error.message })
    return { error: 'The date could not be skipped' }
  }

  await audit(actor, 'skip_date', series.id, { new_values: { skip_date: parsed.data.date, reason: parsed.data.reason } })
  const warning = await afterSeriesChange(series.id)
  return { success: true, data: { warning } }
}

/** Undoes a skip. A date made into a full event is restored by deleting that event instead. */
export async function unskipEventSeriesDate(input: { seriesId: string; date: string }): ActionResult<{ warning?: string }> {
  const actor = await requirePermission('manage')
  if ('error' in actor) return { error: actor.error }
  const parsed = skipSchema.pick({ seriesId: true, date: true }).safeParse(input)
  if (!parsed.success) return { error: 'Check the date' }

  const db = createAdminClient()
  const [series] = await loadEventSeries(db, { id: parsed.data.seriesId })
  if (!series) return { error: 'Repeating event not found' }
  const skip = series.skips.find((s) => s.skipDate === parsed.data.date)
  if (!skip) return { error: 'That date is not skipped' }
  if (skip.replacedByEventId) {
    return { error: 'This date is a full event now. Delete that event to bring the date back.' }
  }

  const { error } = await db
    .from('event_series_skips')
    .delete()
    .eq('series_id', series.id)
    .eq('skip_date', parsed.data.date)
    .is('replaced_by_event_id', null)
  if (error) {
    console.error('[event-series] unskip failed', { code: error.code, message: error.message })
    return { error: 'The skip could not be undone' }
  }

  await audit(actor, 'unskip_date', series.id, { old_values: { skip_date: skip.skipDate, reason: skip.reason } })
  const warning = await afterSeriesChange(series.id)
  return { success: true, data: { warning } }
}

/** Pauses (hides from the website and calendar) or resumes a repeating event. */
export async function setEventSeriesPaused(input: { seriesId: string; paused: boolean }): ActionResult<{ warning?: string }> {
  const actor = await requirePermission('manage')
  if ('error' in actor) return { error: actor.error }
  if (!z.string().uuid().safeParse(input.seriesId).success) return { error: 'Repeating event not found' }

  const db = createAdminClient()
  const [series] = await loadEventSeries(db, { id: input.seriesId })
  if (!series) return { error: 'Repeating event not found' }
  if (series.status === 'ended') return { error: 'This run has ended. Set a later last date to restart it.' }

  const status = input.paused ? 'paused' : 'active'
  const { error } = await db.from('event_series').update({ status }).eq('id', series.id)
  if (error) {
    console.error('[event-series] pause failed', { code: error.code, message: error.message })
    return { error: 'The repeating event could not be updated' }
  }

  await audit(actor, input.paused ? 'pause' : 'resume', series.id, {
    old_values: { status: series.status },
    new_values: { status },
  })
  const warning = await afterSeriesChange(series.id)
  return { success: true, data: { warning } }
}

/**
 * Ends the run after a date (it still runs on that date). A last date already past ends it now;
 * otherwise the calendar cron sets it to ended once the date has gone. A null date carries on
 * again (and restarts an ended run).
 */
export async function endEventSeries(input: { seriesId: string; lastDate: string | null }): ActionResult<{ warning?: string }> {
  const actor = await requirePermission('manage')
  if ('error' in actor) return { error: actor.error }
  if (!z.string().uuid().safeParse(input.seriesId).success) return { error: 'Repeating event not found' }
  if (input.lastDate !== null && !isValidIsoDate(input.lastDate)) return { error: 'Enter a real date' }

  const db = createAdminClient()
  const [series] = await loadEventSeries(db, { id: input.seriesId })
  if (!series) return { error: 'Repeating event not found' }
  if (input.lastDate && input.lastDate < series.startsOn) return { error: 'The last date is before the first' }

  const today = getTodayIsoDate()
  const status =
    input.lastDate && input.lastDate < today ? 'ended' : series.status === 'ended' ? 'active' : series.status
  const { error } = await db.from('event_series').update({ ends_on: input.lastDate, status }).eq('id', series.id)
  if (error) {
    console.error('[event-series] end failed', { code: error.code, message: error.message })
    return { error: 'The repeating event could not be updated' }
  }

  await audit(actor, input.lastDate ? 'end' : 'unend', series.id, {
    old_values: { ends_on: series.endsOn, status: series.status },
    new_values: { ends_on: input.lastDate, status },
  })
  const warning = await afterSeriesChange(series.id)
  return { success: true, data: { warning } }
}

/**
 * Takes a date out of the run because it is now a full event ("Make this date a full event").
 * Turns an existing hand skip for that date into the replacement, so the night is never shown twice.
 * Deleting the event deletes this skip (ON DELETE CASCADE) and the date comes back.
 */
export async function markEventSeriesDateReplaced(input: {
  seriesId: string
  date: string
  eventId: string
}): ActionResult<{ warning?: string }> {
  const actor = await requirePermission('manage')
  if ('error' in actor) return { error: actor.error }
  const parsed = z
    .object({ seriesId: z.string().uuid(), date: isoDate, eventId: z.string().uuid() })
    .safeParse(input)
  if (!parsed.success) return { error: 'Check the date' }

  const db = createAdminClient()
  const [series] = await loadEventSeries(db, { id: parsed.data.seriesId })
  if (!series) return { error: 'Repeating event not found' }
  if (!isSeriesWeekday(series, parsed.data.date)) return { error: 'That date is not on the day this night runs' }

  const { data: event, error: eventError } = await db
    .from('events')
    .select('id, date')
    .eq('id', parsed.data.eventId)
    .maybeSingle()
  if (eventError || !event) return { error: 'The new event could not be found' }
  // The drawer lets staff change the date before saving. Only a full event on this very date
  // replaces the night; otherwise the date would vanish from the run with nothing in its place.
  if (event.date !== parsed.data.date) {
    return {
      error: `The new event is on ${event.date}, not ${parsed.data.date}, so the repeating night on ${parsed.data.date} is unchanged. Skip it by hand if it is not running.`,
    }
  }

  const { error } = await db.from('event_series_skips').upsert(
    {
      series_id: series.id,
      skip_date: parsed.data.date,
      replaced_by_event_id: parsed.data.eventId,
      created_by: actor.userId,
    },
    { onConflict: 'series_id,skip_date' }
  )
  if (error) {
    console.error('[event-series] replace failed', { code: error.code, message: error.message })
    return { error: 'The event was created, but the date is still in the repeating run. Skip it by hand.' }
  }

  await audit(actor, 'replace_date', series.id, {
    new_values: { skip_date: parsed.data.date, replaced_by_event_id: parsed.data.eventId },
  })
  const warning = await afterSeriesChange(series.id)
  return { success: true, data: { warning } }
}

export interface EventSeriesNight {
  seriesId: string
  name: string
  date: string
  startTime: string
  endTime: string
}

/**
 * Every night of every running repeating event between two dates, for the Events calendar view.
 * Needs events:view. At most 400 days at a time.
 */
export async function listEventSeriesNights(input: { from: string; to: string }): ActionResult<EventSeriesNight[]> {
  const actor = await requirePermission('view')
  if ('error' in actor) return { error: actor.error }
  if (!isValidIsoDate(input.from) || !isValidIsoDate(input.to) || input.to < input.from) return { error: 'Check the dates' }
  const limit = shiftIsoDate(input.from, STAFF_WINDOW_DAYS)
  if (limit && input.to > limit) return { error: 'Ask for 400 days or fewer' }

  try {
    const occurrences = await loadSeriesOccurrencesInRange(input.from, input.to, createAdminClient())
    return {
      success: true,
      data: occurrences.map((o) => ({ seriesId: o.seriesId, name: o.name, date: o.date, startTime: o.startTime, endTime: o.endTime })),
    }
  } catch (error) {
    console.error('[event-series] nights failed', { message: getErrorMessage(error) })
    return { error: 'Repeating events could not be loaded' }
  }
}
