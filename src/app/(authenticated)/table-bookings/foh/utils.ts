import { fromZonedTime } from 'date-fns-tz'
import {
  getTableBookingStatusBadgeClasses,
  getTableBookingStatusBlockClasses,
  getTableBookingStatusLabel,
  getTableBookingVisualState,
} from '@/lib/table-bookings/ui'
import {
  postTableBookingAction,
  TableBookingActionError,
} from '@/lib/table-bookings/client-actions'
import type {
  FohBooking,
  FohEventOption,
  FohScheduleResponse,
  FohUpcomingEvent,
  BookingVisualState,
  ServiceWindow,
  TimelineRange,
  WalkInBookingPurpose,
} from './types'

export const DEFAULT_COUNTRY_CODE = '44'
export const FOH_AUTO_RETURN_IDLE_MS = 5 * 60 * 1000
export const FOH_AUTO_RETURN_POLL_MS = 30 * 1000

export function formatBookingWindow(start?: string | null, end?: string | null, fallbackTime?: string | null): string {
  if (start && end) {
    try {
      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: 'h12'
      })
      return `${formatter.format(new Date(start))} - ${formatter.format(new Date(end))}`
    } catch {
      return fallbackTime || 'Time unknown'
    }
  }

  return fallbackTime || 'Time unknown'
}

export function statusBadgeClass(status?: string | null): string {
  return getTableBookingStatusBadgeClasses(status)
}

export function statusBlockClass(status?: string | null): string {
  return getTableBookingStatusBlockClasses(status)
}

export function getBookingVisualState(booking: FohBooking): BookingVisualState {
  return getTableBookingVisualState(booking) as BookingVisualState
}

export function getBookingVisualLabel(booking: FohBooking): string {
  return getTableBookingStatusLabel(getBookingVisualState(booking))
}

export function formatLifecycleTime(isoValue?: string | null): string | null {
  if (!isoValue) return null
  const parsedMs = Date.parse(isoValue)
  if (!Number.isFinite(parsedMs)) return null

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h12'
    }).format(new Date(parsedMs))
  } catch {
    return null
  }
}

function parseClockMinutes(clock: string | null | undefined): number | null {
  if (!clock || typeof clock !== 'string') return null
  const [hoursRaw, minutesRaw] = clock.slice(0, 5).split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

export function formatLaneMinuteLabel(totalMinutes: number): string {
  const dayOffset = Math.floor(totalMinutes / 1440)
  const dayMinutes = ((totalMinutes % 1440) + 1440) % 1440
  const hour24 = Math.floor(dayMinutes / 60)
  const minute = dayMinutes % 60
  const ampm = hour24 >= 12 ? 'pm' : 'am'
  const hour12 = hour24 % 12 || 12
  const minuteText = String(minute).padStart(2, '0')
  const daySuffix = dayOffset > 0 ? ` +${dayOffset}d` : ''
  return `${hour12}:${minuteText}${ampm}${daySuffix}`
}

export function getLondonDateKey(date: Date): string | null {
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value
      }
      return acc
    }, {})

  const year = parts.year
  const month = parts.month
  const day = parts.day
  if (!year || !month || !day) return null
  return `${year}-${month}-${day}`
}

function getLondonMinuteOfDay(date: Date): number | null {
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value
      }
      return acc
    }, {})

  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null
  }

  return hour * 60 + minute
}

function getDateOffsetDays(baseDateIso: string, candidateDateIso: string): number {
  const baseMs = Date.parse(`${baseDateIso}T00:00:00Z`)
  const candidateMs = Date.parse(`${candidateDateIso}T00:00:00Z`)
  if (!Number.isFinite(baseMs) || !Number.isFinite(candidateMs)) return 0
  return Math.round((candidateMs - baseMs) / (24 * 60 * 60 * 1000))
}

export function minutesFromServiceDate(isoDateTime: string, serviceDateIso: string): number | null {
  const parsed = new Date(isoDateTime)
  if (!Number.isFinite(parsed.getTime())) return null

  const localDateKey = getLondonDateKey(parsed)
  const localMinuteOfDay = getLondonMinuteOfDay(parsed)
  if (!localDateKey || localMinuteOfDay == null) return null

  const dayOffset = getDateOffsetDays(serviceDateIso, localDateKey)
  return dayOffset * 1440 + localMinuteOfDay
}

export function resolveBookingWindowMinutes(booking: FohBooking, serviceDateIso: string): { start: number; end: number } | null {
  const startFromIso = booking.start_datetime
    ? minutesFromServiceDate(booking.start_datetime, serviceDateIso)
    : null
  const endFromIso = booking.end_datetime
    ? minutesFromServiceDate(booking.end_datetime, serviceDateIso)
    : null

  const fallbackStart = parseClockMinutes(booking.booking_time)
  const start = startFromIso ?? fallbackStart
  if (start == null) return null

  let end = endFromIso ?? (start + 90)
  if (end <= start) {
    end = start + 30
  }

  return { start, end }
}

export function buildTimelineRange(schedule: FohScheduleResponse['data'] | null): TimelineRange {
  if (!schedule) {
    return {
      startMin: 9 * 60,
      endMin: 23 * 60,
      ticks: Array.from({ length: 15 }, (_, index) => (9 + index) * 60)
    }
  }

  const serviceStart = parseClockMinutes(schedule.service_window?.start_time) ?? 9 * 60
  const serviceEndRaw = parseClockMinutes(schedule.service_window?.end_time) ?? 23 * 60
  const serviceEnd =
    schedule.service_window?.end_next_day || serviceEndRaw <= serviceStart
      ? serviceEndRaw + 1440
      : serviceEndRaw

  // Clamp timeline to service window — don't stretch to fit outlier bookings.
  // Bookings outside the window are still rendered but clipped by FohTimeline.
  const minStart = Math.max(0, Math.floor((serviceStart - 30) / 30) * 30)
  const maxEnd = Math.max(
    Math.ceil((serviceEnd + 30) / 30) * 30,
    minStart + 4 * 60
  )

  const ticks: number[] = []
  for (let minute = Math.ceil(minStart / 60) * 60; minute <= maxEnd; minute += 60) {
    ticks.push(minute)
  }

  return {
    startMin: minStart,
    endMin: maxEnd,
    ticks
  }
}

export function mapFohBlockedReason(blockedReason?: string | null, reason?: string | null): string {
  switch (blockedReason || reason) {
    case 'private_booking_blocked':
      return 'Selected table area is blocked for a private booking in that time window.'
    case 'outside_hours':
      return 'Selected time is outside pub or kitchen hours.'
    case 'cut_off':
      return 'Selected time is past the final booking cut-off for that service.'
    case 'no_table':
      return 'No suitable table is available for that booking window.'
    case 'too_large_party':
      return 'Party size is too large for online booking. Please call the venue.'
    case 'customer_conflict':
      return 'This customer already has an event booking at that time.'
    case 'in_past':
      return 'Selected time has already passed. Pick the current or next available time.'
    case 'slot_full':
      return 'This kitchen arrival window is full. Choose another time or use the pacing override if appropriate.'
    default:
      return 'Booking could not be created for the selected details.'
  }
}

export function mapFohEventBlockedReason(reason?: string | null): string {
  switch (reason) {
    case 'insufficient_capacity':
      return 'This event is full for the requested seats.'
    case 'table_capacity_insufficient':
      return 'The assigned table is too small for that party size. Move the booking to a larger table first.'
    case 'booking_closed':
      return 'Booking is closed for this event.'
    case 'not_bookable':
      return 'This event is not open for booking.'
    case 'event_started':
      return 'This event has already started.'
    case 'capacity_not_configured':
      return 'Event capacity is not configured.'
    case 'event_general_entry_only':
      return 'This event is set to general entry only.'
    case 'no_table':
      return 'No table is available for this event booking window.'
    case 'outside_hours':
    case 'outside_service_window':
      return 'Event table reservation is outside booking hours.'
    case 'cut_off':
      return 'Event table reservation is past the booking cut-off.'
    case 'event_not_found':
      return 'Selected event could not be found.'
    default:
      return 'Event booking could not be created.'
  }
}

export function formatGbp(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 2
  }).format(amount)
}

export function formatEventOptionDateTime(event: FohEventOption): string {
  if (event.start_datetime) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: 'h12'
      }).format(new Date(event.start_datetime))
    } catch {
      // Fall through to raw fields.
    }
  }

  if (event.time) {
    return `${event.date} ${event.time.slice(0, 5)}`
  }

  return event.date
}

export function getLondonDateIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value
      }
      return acc
    }, {})

  const year = parts.year || '1970'
  const month = parts.month || '01'
  const day = parts.day || '01'
  return `${year}-${month}-${day}`
}

function isoDateToUtcDayNumber(isoDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  const [yearText, monthText, dayText] = isoDate.split('-')
  const year = Number.parseInt(yearText, 10)
  const month = Number.parseInt(monthText, 10)
  const day = Number.parseInt(dayText, 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function diffCalendarDays(fromIsoDate: string, toIsoDate: string): number | null {
  const fromDay = isoDateToUtcDayNumber(fromIsoDate)
  const toDay = isoDateToUtcDayNumber(toIsoDate)
  if (fromDay == null || toDay == null) return null
  return toDay - fromDay
}

export function formatNextEventUrgency(event: FohUpcomingEvent, now = new Date()): string {
  const todayIso = getLondonDateIso(now)
  const daysUntil = diffCalendarDays(todayIso, event.date)
  if (daysUntil == null) {
    return 'Book Now'
  }
  if (daysUntil <= 0) {
    return 'Today: Last Chance to Book'
  }
  if (daysUntil === 1) {
    return '1 Day Left to Book'
  }
  return `${daysUntil} Days Left to Book`
}

export function formatEventPaymentMode(paymentMode: FohEventOption['payment_mode']): string {
  switch (paymentMode) {
    case 'prepaid':
      return 'Prepaid'
    case 'cash_only':
      return 'Cash on arrival'
    case 'free':
      return 'Free'
    default:
      return 'Booking'
  }
}

export function formatEventBookingMode(mode: FohEventOption['booking_mode']): string {
  switch (mode) {
    case 'general':
      return 'Tickets (no assigned seats)'
    case 'mixed':
      return 'Mixed'
    case 'communal':
      return 'Communal'
    case 'table':
    default:
      return 'Table'
  }
}

function getTableDurationMinutes(input: {
  purpose: 'food' | 'drinks'
  sundayLunch: boolean
}): number {
  if (input.sundayLunch) return 120
  return input.purpose === 'food' ? 120 : 90
}

export function getTableWindowMs(input: {
  bookingDate: string
  bookingTime: string
  purpose: 'food' | 'drinks'
  sundayLunch: boolean
}): { startMs: number; endMs: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.bookingDate)) {
    return null
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(input.bookingTime)) {
    return null
  }

  const normalizedTime = input.bookingTime.length === 5 ? `${input.bookingTime}:00` : input.bookingTime
  const startDate = fromZonedTime(`${input.bookingDate}T${normalizedTime}`, 'Europe/London')
  const startMs = startDate.getTime()
  if (!Number.isFinite(startMs)) return null

  const durationMinutes = getTableDurationMinutes({
    purpose: input.purpose,
    sundayLunch: input.sundayLunch
  })
  return {
    startMs,
    endMs: startMs + durationMinutes * 60 * 1000
  }
}

function eventPromptWindowLabel(eventOption: FohEventOption): string {
  const startMs = Date.parse(eventOption.start_datetime || '')
  const endMs = Date.parse(eventOption.end_datetime || '')
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return formatEventOptionDateTime(eventOption)
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12'
  })
  return `${formatter.format(new Date(startMs - 15 * 60 * 1000))} - ${formatter.format(new Date(endMs))}`
}

export function shiftIsoDate(dateIso: string, dayDelta: number): string {
  const parsed = new Date(`${dateIso}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime())) return dateIso
  parsed.setUTCDate(parsed.getUTCDate() + dayDelta)
  return parsed.toISOString().slice(0, 10)
}

function minuteToBookingClock(totalMinutes: number): string {
  const minuteOfDay = ((Math.round(totalMinutes) % 1440) + 1440) % 1440
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function resolvePurposeWindowMinutes(input: {
  serviceWindow: ServiceWindow | null | undefined
  purpose: 'food' | 'drinks'
  fallbackStartMin: number
  fallbackEndMin: number
}): { startMin: number; endMin: number } {
  const pubStartMin = parseClockMinutes(input.serviceWindow?.start_time) ?? input.fallbackStartMin
  const pubEndRaw = parseClockMinutes(input.serviceWindow?.end_time) ?? input.fallbackEndMin
  const pubEndMin =
    input.serviceWindow?.end_next_day || pubEndRaw <= pubStartMin
      ? pubEndRaw + 1440
      : pubEndRaw

  if (input.purpose !== 'food') {
    return { startMin: pubStartMin, endMin: pubEndMin }
  }

  if (input.serviceWindow?.kitchen_closed) {
    return { startMin: pubStartMin, endMin: pubEndMin }
  }

  const kitchenStartMin = parseClockMinutes(input.serviceWindow?.kitchen_start_time ?? null)
  const kitchenEndRaw = parseClockMinutes(input.serviceWindow?.kitchen_end_time ?? null)
  if (kitchenStartMin == null || kitchenEndRaw == null) {
    return { startMin: pubStartMin, endMin: pubEndMin }
  }

  const kitchenEndMin =
    input.serviceWindow?.kitchen_end_next_day || kitchenEndRaw <= kitchenStartMin
      ? kitchenEndRaw + 1440
      : kitchenEndRaw

  return { startMin: kitchenStartMin, endMin: kitchenEndMin }
}

export function suggestWalkInTime(input: {
  serviceDateIso: string
  now: Date
  serviceWindow: ServiceWindow | null | undefined
  timelineStartMin: number
  timelineEndMin: number
  purpose: 'food' | 'drinks'
}): string {
  const { startMin, endMin } = resolvePurposeWindowMinutes({
    serviceWindow: input.serviceWindow,
    purpose: input.purpose,
    fallbackStartMin: input.timelineStartMin,
    fallbackEndMin: input.timelineEndMin
  })

  const latestVisibleMinute = Math.max(startMin, endMin - 5)
  let minAllowedMinute = startMin

  const londonTodayIso = getLondonDateKey(input.now)
  const nowMinute = minutesFromServiceDate(input.now.toISOString(), input.serviceDateIso)
  if (londonTodayIso === input.serviceDateIso && nowMinute != null) {
    minAllowedMinute = Math.max(minAllowedMinute, nowMinute + 1)
  }

  minAllowedMinute = Math.min(minAllowedMinute, latestVisibleMinute)

  const latestBookableMinute = Math.max(minAllowedMinute, endMin - 30)
  const targetMinute = minAllowedMinute
  const boundedMinute = Math.min(Math.max(targetMinute, minAllowedMinute), latestBookableMinute)
  return minuteToBookingClock(boundedMinute)
}

function findCurrentWalkInEventOption(input: {
  eventOptions: FohEventOption[]
  serviceDateIso: string
  now: Date
}): FohEventOption | null {
  const nowMinute = minutesFromServiceDate(input.now.toISOString(), input.serviceDateIso)
  if (nowMinute == null) return null

  for (const eventOption of input.eventOptions) {
    if (eventOption.is_full) {
      continue
    }

    const eventStartMinute = eventOption.start_datetime
      ? minutesFromServiceDate(eventOption.start_datetime, input.serviceDateIso)
      : null
    const eventEndMinute = eventOption.end_datetime
      ? minutesFromServiceDate(eventOption.end_datetime, input.serviceDateIso)
      : null
    if (eventStartMinute == null || eventEndMinute == null) {
      continue
    }

    const eventPromptStartMinute = eventStartMinute - 15
    if (nowMinute >= eventPromptStartMinute && nowMinute <= eventEndMinute) {
      return eventOption
    }
  }

  return null
}

export function resolveWalkInDefaults(input: {
  serviceDateIso: string
  now: Date
  serviceWindow: ServiceWindow | null | undefined
  timelineStartMin: number
  timelineEndMin: number
  eventOptions: FohEventOption[]
}): {
  purpose: WalkInBookingPurpose
  eventId: string
  time: string
} {
  const activeEvent = findCurrentWalkInEventOption({
    eventOptions: input.eventOptions,
    serviceDateIso: input.serviceDateIso,
    now: input.now
  })

  if (activeEvent) {
    return {
      purpose: 'event',
      eventId: activeEvent.id,
      time: suggestWalkInTime({
        serviceDateIso: input.serviceDateIso,
        now: input.now,
        serviceWindow: input.serviceWindow,
        timelineStartMin: input.timelineStartMin,
        timelineEndMin: input.timelineEndMin,
        purpose: 'food'
      })
    }
  }

  const nowMinute = minutesFromServiceDate(input.now.toISOString(), input.serviceDateIso)
  const foodWindow = resolvePurposeWindowMinutes({
    serviceWindow: input.serviceWindow,
    purpose: 'food',
    fallbackStartMin: input.timelineStartMin,
    fallbackEndMin: input.timelineEndMin
  })
  const inFoodWindow =
    nowMinute != null &&
    nowMinute >= foodWindow.startMin &&
    nowMinute < foodWindow.endMin
  const purpose: WalkInBookingPurpose = inFoodWindow ? 'food' : 'drinks'

  return {
    purpose,
    eventId: '',
    time: suggestWalkInTime({
      serviceDateIso: input.serviceDateIso,
      now: input.now,
      serviceWindow: input.serviceWindow,
      timelineStartMin: input.timelineStartMin,
      timelineEndMin: input.timelineEndMin,
      purpose: purpose === 'drinks' ? 'drinks' : 'food'
    })
  }
}

export { TableBookingActionError as BookingActionError }

export async function postBookingAction(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  return postTableBookingAction(path, body)
}

export function splitName(fullName: string): { firstName?: string; lastName?: string } {
  const cleaned = fullName.trim()
  if (!cleaned) return {}

  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}

  if (parts.length === 1) {
    return { firstName: parts[0] }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  }
}

// ---------------------------------------------------------------------------
// Changing a booking's time from the floor.
//
// The candidate grid is worked out in the browser from the schedule the page has
// already loaded, rather than through another request. Every window that can block
// a table is already in `schedule.lanes[]`: real bookings, private-hire blocks and
// communal event blocks all arrive with a start and an end. On an iPad mid-service
// an instant grid beats a round trip, and the database trigger stays the authority
// either way, so the worst a stale client can do is earn a 409.
// ---------------------------------------------------------------------------

/**
 * Does this booking still hold its table?
 *
 * Mirrors `public.is_booking_live(status, left_at, hold_expires_at, payment_status)`,
 * which is what the `enforce_booking_table_assignment_integrity_v05` trigger uses to
 * decide whether an existing assignment blocks a new one. If the two ever drift, the
 * grid starts offering times the server then refuses, so keep them in step: the SQL
 * lives in `supabase/migrations/20260801000600_booking_liveness_helpers.sql`.
 *
 * `referenceNow` is passed in rather than read from the clock so the result is stable
 * across a render and testable without faking time.
 */
export function isFohBookingLive(booking: FohBooking, referenceNow: Date): boolean {
  const status = (booking.status || '').toLowerCase()
  if (status === 'cancelled' || status === 'no_show') return false
  if (booking.left_at) return false

  const isHold = status === 'pending_payment' || status === 'pending_card_capture'
  if (isHold && booking.hold_expires_at) {
    const expiresMs = Date.parse(booking.hold_expires_at)
    const paid = (booking.payment_status || '').toLowerCase() === 'completed'
    if (Number.isFinite(expiresMs) && expiresMs <= referenceNow.getTime() && !paid) {
      return false
    }
  }

  return true
}

export type TimeSlotBlockReason = 'private' | 'event' | 'taken'

export type TimeSlotOption = {
  /** Minutes from midnight on the service date. Can exceed 1440 on a late window. */
  minutes: number
  /** London clock time, "HH:MM", which is what the endpoint takes. */
  time: string
  available: boolean
  /** Why it cannot be used. Null when it can. */
  blockedBy: TimeSlotBlockReason | null
  /** True for the booking's own current time, which is shown but not offered. */
  isCurrent: boolean
}

type BusyInterval = { start: number; end: number; reason: TimeSlotBlockReason }

/**
 * The windows that would block this booking if it moved, across every table it sits on.
 *
 * A booking joined across two tables is returned once per lane by the schedule API, so the
 * lanes are filtered by the booking's own `assigned_table_ids` and the booking itself is
 * always excluded. A booking with no table (unassigned, or outside seating) has nothing to
 * clash with and yields no intervals.
 */
export function collectBusyIntervals(input: {
  schedule: FohScheduleResponse['data'] | null
  booking: FohBooking
  serviceDateIso: string
  referenceNow: Date
}): BusyInterval[] {
  const { schedule, booking, serviceDateIso, referenceNow } = input
  if (!schedule) return []

  const tableIds = new Set(booking.assigned_table_ids ?? [])
  if (tableIds.size === 0) return []

  const intervals: BusyInterval[] = []
  const seen = new Set<string>()

  for (const lane of schedule.lanes) {
    if (!tableIds.has(lane.table_id)) continue

    for (const other of lane.bookings) {
      if (other.id === booking.id) continue

      // Blocks are synthesised per table, so the same private booking legitimately appears
      // on several lanes. De-duplicate per lane+block so one clash is not counted twice.
      const key = `${lane.table_id}:${other.id}`
      if (seen.has(key)) continue
      seen.add(key)

      const reason: TimeSlotBlockReason = other.is_private_block
        ? 'private'
        : other.is_communal_event_block
          ? 'event'
          : 'taken'

      // Private and communal blocks are not bookings and carry no liveness fields; they
      // always block. Real bookings block only while they still hold the table.
      if (reason === 'taken' && !isFohBookingLive(other, referenceNow)) continue

      const window = resolveBookingWindowMinutes(other, serviceDateIso)
      if (!window) continue

      intervals.push({ start: window.start, end: window.end, reason })
    }
  }

  return intervals
}

/**
 * Every time this booking could move to, marked free or blocked.
 *
 * Slots run on `stepMinutes` across the visible timeline. A candidate is rejected when the
 * booking's whole window would not fit before the end of the timeline, and when it overlaps
 * anything busy. Overlap is half-open, `[start, end)`, matching the SQL trigger, so a booking
 * ending at 19:00 does not block one starting at 19:00.
 *
 * The booking's current time is included even when it is off-grid, because live data holds
 * times like 20:19 and 20:55, and a picker that quietly dropped the current time would look
 * broken.
 */
export function buildTimeChangeOptions(input: {
  schedule: FohScheduleResponse['data'] | null
  booking: FohBooking
  timeline: TimelineRange
  serviceDateIso: string
  referenceNow: Date
  stepMinutes?: number
}): TimeSlotOption[] {
  const { schedule, booking, timeline, serviceDateIso, referenceNow, stepMinutes = 15 } = input

  const currentWindow = resolveBookingWindowMinutes(booking, serviceDateIso)
  if (!currentWindow) return []

  const durationMinutes = Math.max(15, currentWindow.end - currentWindow.start)
  const busy = collectBusyIntervals({ schedule, booking, serviceDateIso, referenceNow })

  const candidates = new Set<number>()
  const firstSlot = Math.ceil(timeline.startMin / stepMinutes) * stepMinutes
  for (let minute = firstSlot; minute + durationMinutes <= timeline.endMin; minute += stepMinutes) {
    candidates.add(minute)
  }
  // Always offer the booking back to where it started, grid-aligned or not.
  candidates.add(currentWindow.start)

  return Array.from(candidates)
    .sort((left, right) => left - right)
    .map((minutes) => {
      const isCurrent = minutes === currentWindow.start
      const end = minutes + durationMinutes

      // Reason priority: a private block is the least negotiable thing on the timeline and
      // an event block the next, so they win over an ordinary clash when windows overlap.
      const clashes = busy.filter((interval) => interval.start < end && interval.end > minutes)
      const blockedBy: TimeSlotBlockReason | null =
        clashes.find((c) => c.reason === 'private')?.reason
        ?? clashes.find((c) => c.reason === 'event')?.reason
        ?? clashes.find((c) => c.reason === 'taken')?.reason
        ?? null

      return {
        minutes,
        time: formatMinutesAsClock(minutes),
        available: blockedBy == null && !isCurrent,
        blockedBy,
        isCurrent,
      }
    })
}

/** Minutes from midnight to a London "HH:MM" clock, wrapping past a midnight-crossing window. */
export function formatMinutesAsClock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440
  const hours = Math.floor(wrapped / 60)
  const mins = wrapped % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

/**
 * Whether the floor may re-time this booking at all.
 *
 * The same rules the endpoint enforces, so the button is never offered for something the
 * server would refuse. The server is still the authority; this only keeps staff from
 * tapping into a guaranteed error.
 */
export const FOH_TIME_CHANGE_EDITABLE_STATUSES = new Set([
  'confirmed',
  'pending_payment',
  'pending_card_capture',
  'visited_waiting_for_review',
  'review_clicked',
])

export function getFohTimeChangeBlocker(booking: FohBooking): string | null {
  if (booking.is_private_block) return 'Managed by the private booking.'
  if (booking.is_communal_event_block || booking.id.startsWith('communal-') || booking.id.startsWith('standing-')) {
    return 'Managed from the event.'
  }
  if (booking.left_at) return 'This party has already left.'
  // The schedule API does not expose event_id, but it rewrites both type and purpose to
  // 'event' for a booking that has one, and carries the event name. An event diner's table
  // is tied to their ticket, so re-timing only the table half would split the pair; the
  // endpoint refuses it too.
  if (booking.booking_purpose === 'event' || booking.booking_type === 'event' || booking.event_name) {
    return 'Tied to an event. Change it from the event.'
  }
  const status = (booking.status || '').toLowerCase()
  if (!FOH_TIME_CHANGE_EDITABLE_STATUSES.has(status)) {
    return 'This booking is closed.'
  }
  return null
}
