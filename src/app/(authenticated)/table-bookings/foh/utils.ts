import { CSSProperties } from 'react'
import { fromZonedTime } from 'date-fns-tz'
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
        hour12: true
      })
      return `${formatter.format(new Date(start))} - ${formatter.format(new Date(end))}`
    } catch {
      return fallbackTime || 'Time unknown'
    }
  }

  return fallbackTime || 'Time unknown'
}

export function statusBadgeClass(status?: string | null): string {
  switch (status) {
    case 'private_block':
      return 'bg-slate-200 text-slate-800 border-slate-300'
    case 'seated':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    case 'left':
    case 'completed':
      return 'bg-gray-100 text-gray-600 border-gray-200'
    case 'confirmed':
    case 'pending':
      return 'bg-green-100 text-green-800 border-green-200'
    case 'pending_payment':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    case 'no_show':
      return 'bg-red-100 text-red-700 border-red-200'
    case 'cancelled':
      return 'bg-gray-100 text-gray-500 border-gray-200'
    case 'visited_waiting_for_review':
    case 'review_clicked':
      return 'bg-purple-100 text-purple-800 border-purple-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

export function statusBlockClass(status?: string | null): string {
  switch (status) {
    case 'private_block':
      return 'border-slate-400 bg-slate-300/90 text-slate-900'
    case 'seated':
      return 'border-emerald-300 bg-emerald-200/90 text-emerald-900'
    case 'left':
      return 'border-sky-300 bg-sky-200/90 text-sky-900'
    case 'confirmed':
      return 'border-green-300 bg-green-200/90 text-green-900'
    case 'pending_payment':
      return 'border-amber-300 bg-amber-200/90 text-amber-900'
    case 'no_show':
      return 'border-red-300 bg-red-200/90 text-red-900'
    case 'cancelled':
      return 'border-gray-300 bg-gray-200/90 text-gray-700'
    case 'completed':
      return 'border-blue-300 bg-blue-200/90 text-blue-900'
    case 'visited_waiting_for_review':
    case 'review_clicked':
      return 'border-purple-300 bg-purple-200/90 text-purple-900'
    default:
      return 'border-gray-300 bg-gray-200/90 text-gray-800'
  }
}

export function getSundayPreorderBorderStyle(booking: FohBooking): CSSProperties {
  if (booking.booking_type !== 'sunday_lunch') return {}
  if (booking.sunday_preorder_completed_at) {
    return { borderLeft: '4px solid #16a34a' }  // green — submitted
  }
  return { borderLeft: '4px solid #d97706' }  // amber — pending
}

export function getBookingVisualState(booking: FohBooking): BookingVisualState {
  if (booking.is_private_block || booking.status === 'private_block') {
    return 'private_block'
  }

  if (booking.status === 'no_show' || booking.no_show_at) {
    return 'no_show'
  }

  if (booking.left_at) {
    return 'left'
  }

  if (booking.seated_at) {
    return 'seated'
  }

  switch (booking.status) {
    case 'pending_payment':
      return 'pending_payment'
    case 'confirmed':
      return 'confirmed'
    case 'cancelled':
      return 'cancelled'
    case 'completed':
      return 'completed'
    case 'visited_waiting_for_review':
      return 'visited_waiting_for_review'
    case 'review_clicked':
      return 'review_clicked'
    default:
      return 'unknown'
  }
}

export function getBookingVisualLabel(booking: FohBooking): string {
  const visualState = getBookingVisualState(booking)
  switch (visualState) {
    case 'private_block':
      return 'Private block'
    case 'pending_payment':
      return 'Pending payment'
    case 'seated':
      return 'Seated'
    case 'left':
      return 'Left'
    case 'no_show':
      return 'No-show'
    case 'confirmed':
      return 'Booked'
    case 'cancelled':
      return 'Cancelled'
    case 'completed':
      return 'Completed'
    case 'visited_waiting_for_review':
      return 'Visited'
    case 'review_clicked':
      return 'Review clicked'
    default:
      return booking.status || 'Unknown'
  }
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
      hour12: true
    }).format(new Date(parsedMs))
  } catch {
    return null
  }
}

export function parseClockMinutes(clock: string | null | undefined): number | null {
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

export function getLondonMinuteOfDay(date: Date): number | null {
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

export function getDateOffsetDays(baseDateIso: string, candidateDateIso: string): number {
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

  let minStart = serviceStart
  let maxEnd = serviceEnd

  for (const lane of schedule.lanes) {
    for (const booking of lane.bookings) {
      const window = resolveBookingWindowMinutes(booking, schedule.date)
      if (!window) continue

      minStart = Math.min(minStart, window.start)
      maxEnd = Math.max(maxEnd, window.end)
    }
  }

  minStart = Math.max(0, Math.floor((minStart - 30) / 30) * 30)
  maxEnd = Math.ceil((maxEnd + 30) / 30) * 30

  if (maxEnd - minStart < 4 * 60) {
    maxEnd = minStart + 4 * 60
  }

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
    default:
      return 'Booking could not be created for the selected details.'
  }
}

export function mapFohEventBlockedReason(reason?: string | null): string {
  switch (reason) {
    case 'insufficient_capacity':
      return 'This event is full for the requested seats.'
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
        hour12: true
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

export function isoDateToUtcDayNumber(isoDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  const [yearText, monthText, dayText] = isoDate.split('-')
  const year = Number.parseInt(yearText, 10)
  const month = Number.parseInt(monthText, 10)
  const day = Number.parseInt(dayText, 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

export function diffCalendarDays(fromIsoDate: string, toIsoDate: string): number | null {
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
      return 'General entry'
    case 'mixed':
      return 'Mixed'
    case 'table':
    default:
      return 'Table'
  }
}

export function getTableDurationMinutes(input: {
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

export function eventPromptWindowLabel(eventOption: FohEventOption): string {
  const startMs = Date.parse(eventOption.start_datetime || '')
  const endMs = Date.parse(eventOption.end_datetime || '')
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return formatEventOptionDateTime(eventOption)
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
  return `${formatter.format(new Date(startMs - 15 * 60 * 1000))} - ${formatter.format(new Date(endMs))}`
}

export function isSundayDate(dateIso: string): boolean {
  const parsed = new Date(`${dateIso}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.getUTCDay() === 0
}

export function shiftIsoDate(dateIso: string, dayDelta: number): string {
  const parsed = new Date(`${dateIso}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime())) return dateIso
  parsed.setUTCDate(parsed.getUTCDate() + dayDelta)
  return parsed.toISOString().slice(0, 10)
}

export function minuteToBookingClock(totalMinutes: number): string {
  const minuteOfDay = ((Math.round(totalMinutes) % 1440) + 1440) % 1440
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function resolvePurposeWindowMinutes(input: {
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

export function findCurrentWalkInEventOption(input: {
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

export class BookingActionError extends Error {
  payload: Record<string, unknown> | null
  constructor(message: string, payload: Record<string, unknown> | null) {
    super(message)
    this.payload = payload
  }
}

export async function postBookingAction(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const response = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const errorMessage = payload && typeof payload.error === 'string' ? payload.error : 'Action failed'
    throw new BookingActionError(errorMessage, payload)
  }

  return payload
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
