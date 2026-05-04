import 'server-only'

import { createHash } from 'crypto'
import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, addMinutes } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { getOAuth2Client } from '@/lib/google-calendar'
import { logger } from '@/lib/logger'

export const PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID =
  'f9712733d9040b99f0ac9846911447034a4d70e8a6f06b571be130014606c504@group.calendar.google.com'

const CALENDAR_TIME_ZONE = 'Europe/London'
const DEFAULT_EVENT_DURATION_MINUTES = 120
const SOURCE_PROPERTY = 'anchor_event_booking_aggregate'
const ACTIVE_BOOKING_STATUSES = new Set(['confirmed', 'pending_payment'])

const calendar = google.calendar('v3')

type CalendarAuth = Awaited<ReturnType<typeof getOAuth2Client>>

export type PubOpsEventCalendarSyncResult =
  | { state: 'created' | 'updated' | 'deleted' | 'skipped'; eventId: string; googleEventId: string; reason?: string }
  | { state: 'failed'; eventId: string; googleEventId: string; reason: string }

export type PubOpsEventCalendarEventRow = {
  id: string
  name: string | null
  date: string | null
  time: string | null
  start_datetime: string | null
  end_time: string | null
  duration_minutes: number | null
  description?: string | null
  brief?: string | null
  short_description?: string | null
  booking_url: string | null
  capacity: number | null
  event_status: string | null
  booking_mode?: string | null
  payment_mode?: string | null
}

export type PubOpsEventCalendarBookingRow = {
  id: string
  seats: number | null
  status: string | null
  is_reminder_only: boolean | null
  hold_expires_at?: string | null
}

export type PubOpsEventCalendarAggregate = {
  confirmedSeats: number
  pendingPaymentSeats: number
  totalActiveSeats: number
  activeBookingCount: number
}

export type PubOpsEventCalendarEntry =
  | {
      shouldDelete: false
      googleEventId: string
      aggregate: PubOpsEventCalendarAggregate
      requestBody: {
        id: string
        summary: string
        description: string
        start: { dateTime: string; timeZone: string }
        end: { dateTime: string; timeZone: string }
        location: string
        colorId: string
        extendedProperties: {
          private: Record<string, string>
        }
      }
    }
  | {
      shouldDelete: true
      googleEventId: string
      aggregate: PubOpsEventCalendarAggregate
      reason: 'event_cancelled' | 'no_active_seats' | 'missing_start'
    }

function calendarAuth(auth: CalendarAuth): OAuth2Client {
  return auth as unknown as OAuth2Client
}

function hasCalendarAuthConfig(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
      (process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REFRESH_TOKEN)
  )
}

export function generatePubOpsEventCalendarEventId(eventId: string): string {
  const digest = createHash('sha256').update(`anchor-event-booking:${eventId}`).digest('hex')
  return `aev${digest.slice(0, 48)}`
}

function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null
  const [hourRaw = '00', minuteRaw = '00', secondRaw] = value.split(':')
  const hour = hourRaw.padStart(2, '0')
  const minute = minuteRaw.padStart(2, '0')
  const second = (secondRaw || '00').padStart(2, '0')
  return `${hour}:${minute}:${second}`
}

function isFiniteDate(date: Date): boolean {
  return Number.isFinite(date.getTime())
}

function getEventStart(event: PubOpsEventCalendarEventRow): Date | null {
  if (event.start_datetime) {
    const parsed = new Date(event.start_datetime)
    if (isFiniteDate(parsed)) return parsed
  }

  if (!event.date || !event.time) {
    return null
  }

  const time = normalizeTime(event.time)
  if (!time) return null

  const parsed = fromZonedTime(`${event.date}T${time}`, CALENDAR_TIME_ZONE)
  return isFiniteDate(parsed) ? parsed : null
}

function getEventEnd(event: PubOpsEventCalendarEventRow, start: Date): Date {
  const eventDate =
    event.date || formatInTimeZone(start, CALENDAR_TIME_ZONE, 'yyyy-MM-dd')
  const endTime = normalizeTime(event.end_time)

  if (endTime) {
    let end = fromZonedTime(`${eventDate}T${endTime}`, CALENDAR_TIME_ZONE)
    if (isFiniteDate(end) && end.getTime() <= start.getTime()) {
      end = addDays(end, 1)
    }
    if (isFiniteDate(end) && end.getTime() > start.getTime()) {
      return end
    }
  }

  const durationMinutes = Number(event.duration_minutes)
  const safeDuration =
    Number.isFinite(durationMinutes) && durationMinutes > 0
      ? durationMinutes
      : DEFAULT_EVENT_DURATION_MINUTES

  return addMinutes(start, safeDuration)
}

function formatForCalendar(date: Date): string {
  return date.toISOString()
}

function isPendingPaymentHoldActive(booking: PubOpsEventCalendarBookingRow, now: Date): boolean {
  if (booking.status !== 'pending_payment') {
    return false
  }
  if (!booking.hold_expires_at) {
    return true
  }
  const expiresAt = new Date(booking.hold_expires_at)
  return !isFiniteDate(expiresAt) || expiresAt.getTime() > now.getTime()
}

function getSeatCount(value: number | null | undefined): number {
  const seats = Number(value ?? 0)
  if (!Number.isFinite(seats) || seats <= 0) return 0
  return Math.floor(seats)
}

export function aggregatePubOpsEventCalendarBookings(
  bookings: PubOpsEventCalendarBookingRow[],
  now = new Date()
): PubOpsEventCalendarAggregate {
  let confirmedSeats = 0
  let pendingPaymentSeats = 0
  let activeBookingCount = 0

  for (const booking of bookings) {
    if (booking.is_reminder_only === true) continue
    if (!booking.status || !ACTIVE_BOOKING_STATUSES.has(booking.status)) continue

    const seats = getSeatCount(booking.seats)
    if (seats <= 0) continue

    if (booking.status === 'confirmed') {
      confirmedSeats += seats
      activeBookingCount += 1
    } else if (isPendingPaymentHoldActive(booking, now)) {
      pendingPaymentSeats += seats
      activeBookingCount += 1
    }
  }

  return {
    confirmedSeats,
    pendingPaymentSeats,
    totalActiveSeats: confirmedSeats + pendingPaymentSeats,
    activeBookingCount,
  }
}

function pluralizeSeats(count: number): string {
  return `${count} ${count === 1 ? 'seat' : 'seats'}`
}

function truncateText(value: string | null | undefined, maxLength = 1500): string | null {
  const text = value?.trim()
  if (!text) return null
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trimEnd()}...`
}

function buildDescription(input: {
  event: PubOpsEventCalendarEventRow
  aggregate: PubOpsEventCalendarAggregate
  appBaseUrl: string
  syncedAt: Date
}): string {
  const { event, aggregate, appBaseUrl, syncedAt } = input
  const adminBaseUrl = appBaseUrl.replace(/\/+$/, '')
  const adminUrl = adminBaseUrl ? `${adminBaseUrl}/events/${event.id}` : `/events/${event.id}`
  const capacity = typeof event.capacity === 'number' && Number.isFinite(event.capacity)
    ? String(event.capacity)
    : 'Unlimited / not set'
  const details = truncateText(event.short_description || event.description || event.brief)

  return [
    `Event: ${event.name || 'Untitled event'}`,
    event.event_status ? `Status: ${event.event_status}` : null,
    event.booking_mode ? `Booking mode: ${event.booking_mode}` : null,
    event.payment_mode ? `Payment mode: ${event.payment_mode}` : null,
    `Capacity: ${capacity}`,
    details ? '' : null,
    details ? `Details:\n${details}` : null,
    '',
    `Confirmed seats: ${aggregate.confirmedSeats}`,
    `Pending payment held seats: ${aggregate.pendingPaymentSeats}`,
    `Total active seats: ${aggregate.totalActiveSeats}`,
    `Active booking rows: ${aggregate.activeBookingCount}`,
    '',
    event.booking_url ? `Public booking link: ${event.booking_url}` : 'Public booking link: not set',
    `Admin event link: ${adminUrl}`,
    '',
    `Last synced: ${syncedAt.toISOString()}`,
  ].filter((line): line is string => Boolean(line)).join('\n')
}

export function buildPubOpsEventCalendarEntry(input: {
  event: PubOpsEventCalendarEventRow
  bookings: PubOpsEventCalendarBookingRow[]
  appBaseUrl?: string
  now?: Date
}): PubOpsEventCalendarEntry {
  const now = input.now ?? new Date()
  const googleEventId = generatePubOpsEventCalendarEventId(input.event.id)
  const aggregate = aggregatePubOpsEventCalendarBookings(input.bookings, now)

  if (input.event.event_status === 'cancelled') {
    return { shouldDelete: true, googleEventId, aggregate, reason: 'event_cancelled' }
  }

  if (aggregate.totalActiveSeats <= 0) {
    return { shouldDelete: true, googleEventId, aggregate, reason: 'no_active_seats' }
  }

  const start = getEventStart(input.event)
  if (!start) {
    return { shouldDelete: true, googleEventId, aggregate, reason: 'missing_start' }
  }

  const end = getEventEnd(input.event, start)
  const appBaseUrl = input.appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || ''
  const seatLabel = pluralizeSeats(aggregate.totalActiveSeats)
  const summary = `${input.event.name || 'Untitled event'} - ${seatLabel} booked`

  return {
    shouldDelete: false,
    googleEventId,
    aggregate,
    requestBody: {
      id: googleEventId,
      summary,
      description: buildDescription({
        event: input.event,
        aggregate,
        appBaseUrl,
        syncedAt: now,
      }),
      start: {
        dateTime: formatForCalendar(start),
        timeZone: CALENDAR_TIME_ZONE,
      },
      end: {
        dateTime: formatForCalendar(end),
        timeZone: CALENDAR_TIME_ZONE,
      },
      location: 'The Anchor',
      colorId: aggregate.pendingPaymentSeats > 0 ? '5' : '10',
      extendedProperties: {
        private: {
          source: SOURCE_PROPERTY,
          anchorEventId: input.event.id,
        },
      },
    },
  }
}

function getGoogleErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as {
    code?: string | number
    status?: number
    response?: { status?: number; data?: { error?: { code?: number } } }
  }
  if (typeof candidate.status === 'number') return candidate.status
  if (typeof candidate.code === 'number') return candidate.code
  if (typeof candidate.response?.status === 'number') return candidate.response.status
  if (typeof candidate.response?.data?.error?.code === 'number') {
    return candidate.response.data.error.code
  }
  return undefined
}

function getGoogleErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function deletePubOpsEventCalendarEntry(
  auth: CalendarAuth,
  eventId: string,
  context?: Record<string, unknown>
): Promise<PubOpsEventCalendarSyncResult> {
  const googleEventId = generatePubOpsEventCalendarEventId(eventId)

  try {
    await calendar.events.delete({
      auth: calendarAuth(auth),
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      eventId: googleEventId,
    })
    return { state: 'deleted', eventId, googleEventId }
  } catch (error) {
    const status = getGoogleErrorStatus(error)
    if (status === 404 || status === 410) {
      return { state: 'skipped', eventId, googleEventId, reason: 'already_missing' }
    }

    logger.warn('Failed to delete Pub Ops event booking calendar entry', {
      metadata: {
        eventId,
        googleEventId,
        status,
        error: getGoogleErrorMessage(error),
        ...context,
      },
    })
    return {
      state: 'failed',
      eventId,
      googleEventId,
      reason: getGoogleErrorMessage(error),
    }
  }
}

export async function deletePubOpsEventCalendarEntryByEventId(
  eventId: string,
  context?: Record<string, unknown>
): Promise<PubOpsEventCalendarSyncResult> {
  const googleEventId = generatePubOpsEventCalendarEventId(eventId)

  if (!hasCalendarAuthConfig()) {
    return { state: 'skipped', eventId, googleEventId, reason: 'calendar_not_configured' }
  }

  try {
    const auth = await getOAuth2Client()
    return deletePubOpsEventCalendarEntry(auth, eventId, context)
  } catch (error) {
    logger.warn('Failed to authenticate for Pub Ops event booking calendar delete', {
      metadata: {
        eventId,
        googleEventId,
        error: getGoogleErrorMessage(error),
        ...context,
      },
    })
    return { state: 'failed', eventId, googleEventId, reason: getGoogleErrorMessage(error) }
  }
}

async function upsertPubOpsEventCalendarEntry(
  auth: CalendarAuth,
  eventId: string,
  entry: Extract<PubOpsEventCalendarEntry, { shouldDelete: false }>,
  context?: Record<string, unknown>
): Promise<PubOpsEventCalendarSyncResult> {
  try {
    const response = await calendar.events.update({
      auth: calendarAuth(auth),
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      eventId: entry.googleEventId,
      requestBody: entry.requestBody,
    })
    return {
      state: 'updated',
      eventId,
      googleEventId: response.data.id || entry.googleEventId,
    }
  } catch (updateError) {
    const status = getGoogleErrorStatus(updateError)
    if (status !== 404 && status !== 410) {
      logger.warn('Failed to update Pub Ops event booking calendar entry', {
        metadata: {
          eventId,
          googleEventId: entry.googleEventId,
          status,
          error: getGoogleErrorMessage(updateError),
          ...context,
        },
      })
      return {
        state: 'failed',
        eventId,
        googleEventId: entry.googleEventId,
        reason: getGoogleErrorMessage(updateError),
      }
    }
  }

  try {
    const response = await calendar.events.insert({
      auth: calendarAuth(auth),
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      requestBody: entry.requestBody,
    })
    return {
      state: 'created',
      eventId,
      googleEventId: response.data.id || entry.googleEventId,
    }
  } catch (insertError) {
    const status = getGoogleErrorStatus(insertError)
    if (status === 409) {
      try {
        const response = await calendar.events.update({
          auth: calendarAuth(auth),
          calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
          eventId: entry.googleEventId,
          requestBody: entry.requestBody,
        })
        return {
          state: 'updated',
          eventId,
          googleEventId: response.data.id || entry.googleEventId,
        }
      } catch (retryError) {
        logger.warn('Failed to update Pub Ops event booking calendar entry after insert conflict', {
          metadata: {
            eventId,
            googleEventId: entry.googleEventId,
            status: getGoogleErrorStatus(retryError),
            error: getGoogleErrorMessage(retryError),
            ...context,
          },
        })
        return {
          state: 'failed',
          eventId,
          googleEventId: entry.googleEventId,
          reason: getGoogleErrorMessage(retryError),
        }
      }
    }

    logger.warn('Failed to create Pub Ops event booking calendar entry', {
      metadata: {
        eventId,
        googleEventId: entry.googleEventId,
        status,
        error: getGoogleErrorMessage(insertError),
        ...context,
      },
    })
    return {
      state: 'failed',
      eventId,
      googleEventId: entry.googleEventId,
      reason: getGoogleErrorMessage(insertError),
    }
  }
}

export async function syncPubOpsEventCalendarByBookingId(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string,
  context?: Record<string, unknown>
): Promise<PubOpsEventCalendarSyncResult> {
  const fallbackEventId = `booking:${bookingId}`
  const fallbackGoogleEventId = generatePubOpsEventCalendarEventId(fallbackEventId)

  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('event_id')
      .eq('id', bookingId)
      .maybeSingle()

    if (error) {
      logger.warn('Failed to load event booking for Pub Ops calendar sync', {
        metadata: {
          bookingId,
          error: error.message,
          ...context,
        },
      })
      return { state: 'failed', eventId: fallbackEventId, googleEventId: fallbackGoogleEventId, reason: error.message }
    }

    if (!booking?.event_id) {
      return { state: 'skipped', eventId: fallbackEventId, googleEventId: fallbackGoogleEventId, reason: 'booking_event_missing' }
    }

    return syncPubOpsEventCalendarByEventId(supabase, booking.event_id, {
      bookingId,
      ...context,
    })
  } catch (error) {
    logger.warn('Unexpected Pub Ops calendar booking lookup failure', {
      metadata: {
        bookingId,
        error: getGoogleErrorMessage(error),
        ...context,
      },
    })
    return {
      state: 'failed',
      eventId: fallbackEventId,
      googleEventId: fallbackGoogleEventId,
      reason: getGoogleErrorMessage(error),
    }
  }
}

export async function syncPubOpsEventCalendarByEventId(
  supabase: SupabaseClient<any, 'public', any>,
  eventId: string,
  context?: Record<string, unknown>
): Promise<PubOpsEventCalendarSyncResult> {
  const googleEventId = generatePubOpsEventCalendarEventId(eventId)

  if (!hasCalendarAuthConfig()) {
    return { state: 'skipped', eventId, googleEventId, reason: 'calendar_not_configured' }
  }

  try {
    const auth = await getOAuth2Client()
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, name, date, time, start_datetime, end_time, duration_minutes, description, brief, short_description, booking_url, capacity, event_status, booking_mode, payment_mode')
      .eq('id', eventId)
      .maybeSingle()

    if (eventError) {
      logger.warn('Failed to load event for Pub Ops calendar sync', {
        metadata: {
          eventId,
          error: eventError.message,
          ...context,
        },
      })
      return { state: 'failed', eventId, googleEventId, reason: eventError.message }
    }

    if (!event) {
      return deletePubOpsEventCalendarEntry(auth, eventId, {
        reason: 'event_missing',
        ...context,
      })
    }

    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, seats, status, is_reminder_only, hold_expires_at')
      .eq('event_id', eventId)

    if (bookingsError) {
      logger.warn('Failed to load event bookings for Pub Ops calendar sync', {
        metadata: {
          eventId,
          error: bookingsError.message,
          ...context,
        },
      })
      return { state: 'failed', eventId, googleEventId, reason: bookingsError.message }
    }

    const entry = buildPubOpsEventCalendarEntry({
      event: event as PubOpsEventCalendarEventRow,
      bookings: (bookings || []) as PubOpsEventCalendarBookingRow[],
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || '',
    })

    if (entry.shouldDelete) {
      return deletePubOpsEventCalendarEntry(auth, eventId, {
        reason: entry.reason,
        ...context,
      })
    }

    return upsertPubOpsEventCalendarEntry(auth, eventId, entry, context)
  } catch (error) {
    logger.warn('Unexpected Pub Ops event booking calendar sync failure', {
      metadata: {
        eventId,
        googleEventId,
        error: getGoogleErrorMessage(error),
        ...context,
      },
    })
    return { state: 'failed', eventId, googleEventId, reason: getGoogleErrorMessage(error) }
  }
}
