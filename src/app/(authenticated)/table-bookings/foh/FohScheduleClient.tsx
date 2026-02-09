'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'
import Image from 'next/image'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

type FohBooking = {
  id: string
  booking_reference: string | null
  guest_name?: string | null
  event_name?: string | null
  booking_time: string
  party_size: number | null
  booking_type: string | null
  booking_purpose: string | null
  status: string | null
  notes: string | null
  seated_at?: string | null
  left_at?: string | null
  no_show_at?: string | null
  start_datetime?: string | null
  end_datetime?: string | null
  assignment_count?: number | null
  assigned_table_ids?: string[]
  is_private_block?: boolean
  private_booking_id?: string | null
}

type FohLane = {
  table_id: string
  table_name: string
  table_number?: string | null
  capacity: number | null
  area_id?: string | null
  area: string | null
  is_bookable?: boolean
  bookings: FohBooking[]
}

type ServiceWindow = {
  start_time: string
  end_time: string
  end_next_day: boolean
  kitchen_start_time?: string | null
  kitchen_end_time?: string | null
  kitchen_end_next_day?: boolean
  kitchen_closed?: boolean
  source: string
}

type FohScheduleResponse = {
  success: boolean
  data?: {
    date: string
    service_window: ServiceWindow
    lanes: FohLane[]
    unassigned_bookings: FohBooking[]
  }
  error?: string
}

type FohCreateBookingResponse = {
  success: boolean
  data?: {
    state: 'confirmed' | 'pending_card_capture' | 'blocked'
    table_booking_id: string | null
    booking_reference: string | null
    reason: string | null
    blocked_reason:
      | 'outside_hours'
      | 'cut_off'
      | 'no_table'
      | 'private_booking_blocked'
      | 'too_large_party'
      | 'customer_conflict'
      | 'in_past'
      | 'blocked'
      | null
    next_step_url: string | null
    hold_expires_at: string | null
    table_name: string | null
    sunday_preorder_state?:
      | 'not_applicable'
      | 'captured'
      | 'capture_blocked'
      | 'link_sent'
      | 'link_not_sent'
    sunday_preorder_reason?: string | null
  }
  error?: string
}

type FohCreateEventBookingResponse = {
  success: boolean
  data?: {
    state: 'confirmed' | 'pending_payment' | 'full_with_waitlist_option' | 'blocked'
    booking_id: string | null
    reason: string | null
    seats_remaining: number | null
    next_step_url: string | null
    manage_booking_url: string | null
    event_name: string | null
    payment_mode: 'free' | 'cash_only' | 'prepaid' | null
    booking_mode: 'table' | 'general' | 'mixed' | null
    table_booking_id: string | null
    table_name: string | null
  }
  error?: string
}

type FohEventOption = {
  id: string
  name: string
  date: string
  time: string | null
  start_datetime: string | null
  end_datetime: string | null
  payment_mode: 'free' | 'cash_only' | 'prepaid' | null
  price_per_seat: number | null
  capacity: number | null
  seats_remaining: number | null
  is_full: boolean
  booking_mode: 'table' | 'general' | 'mixed'
}

type FohUpcomingEvent = {
  id: string
  name: string
  date: string
  time: string | null
  start_datetime: string | null
}

type FohUpcomingEventsResponse = {
  success: boolean
  data?: FohUpcomingEvent[]
  error?: string
}

type SundayMenuItem = {
  menu_dish_id: string
  name: string
  price: number
  category_code: string | null
  category_name: string | null
  item_type: 'main' | 'side' | 'extra'
  sort_order: number
}

type FohCustomerSearchResult = {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string
  mobile_number: string | null
  mobile_e164: string | null
  display_phone: string | null
}

type TimelineRange = {
  startMin: number
  endMin: number
  ticks: number[]
}

type SelectedBookingContext = {
  booking: FohBooking
  laneTableId: string | null
  laneTableName: string | null
}

type FohStyleVariant = 'default' | 'manager_kiosk'
type FohCreateMode = 'booking' | 'walk_in'
type WalkInBookingPurpose = 'food' | 'drinks' | 'event'

type WalkInTargetTable = {
  id: string
  name: string
}

type BookingVisualState =
  | 'private_block'
  | 'pending_card_capture'
  | 'confirmed'
  | 'seated'
  | 'left'
  | 'no_show'
  | 'cancelled'
  | 'completed'
  | 'visited_waiting_for_review'
  | 'review_clicked'
  | 'unknown'

function formatBookingWindow(start?: string | null, end?: string | null, fallbackTime?: string | null): string {
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

function statusBadgeClass(status?: string | null): string {
  switch (status) {
    case 'private_block':
      return 'bg-slate-200 text-slate-800 border-slate-300'
    case 'seated':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    case 'left':
      return 'bg-sky-100 text-sky-800 border-sky-200'
    case 'confirmed':
      return 'bg-green-100 text-green-800 border-green-200'
    case 'pending_card_capture':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    case 'no_show':
      return 'bg-red-100 text-red-800 border-red-200'
    case 'cancelled':
      return 'bg-gray-100 text-gray-700 border-gray-200'
    case 'completed':
      return 'bg-blue-100 text-blue-800 border-blue-200'
    case 'visited_waiting_for_review':
    case 'review_clicked':
      return 'bg-purple-100 text-purple-800 border-purple-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

function statusBlockClass(status?: string | null): string {
  switch (status) {
    case 'private_block':
      return 'border-slate-400 bg-slate-300/90 text-slate-900'
    case 'seated':
      return 'border-emerald-300 bg-emerald-200/90 text-emerald-900'
    case 'left':
      return 'border-sky-300 bg-sky-200/90 text-sky-900'
    case 'confirmed':
      return 'border-green-300 bg-green-200/90 text-green-900'
    case 'pending_card_capture':
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

function getBookingVisualState(booking: FohBooking): BookingVisualState {
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
    case 'pending_card_capture':
      return 'pending_card_capture'
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

function getBookingVisualLabel(booking: FohBooking): string {
  const visualState = getBookingVisualState(booking)
  switch (visualState) {
    case 'private_block':
      return 'Private block'
    case 'pending_card_capture':
      return 'Pending card'
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

function formatLifecycleTime(isoValue?: string | null): string | null {
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

function parseClockMinutes(clock: string | null | undefined): number | null {
  if (!clock || typeof clock !== 'string') return null
  const [hoursRaw, minutesRaw] = clock.slice(0, 5).split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function formatLaneMinuteLabel(totalMinutes: number): string {
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

function getLondonDateKey(date: Date): string | null {
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

function minutesFromServiceDate(isoDateTime: string, serviceDateIso: string): number | null {
  const parsed = new Date(isoDateTime)
  if (!Number.isFinite(parsed.getTime())) return null

  const localDateKey = getLondonDateKey(parsed)
  const localMinuteOfDay = getLondonMinuteOfDay(parsed)
  if (!localDateKey || localMinuteOfDay == null) return null

  const dayOffset = getDateOffsetDays(serviceDateIso, localDateKey)
  return dayOffset * 1440 + localMinuteOfDay
}

function resolveBookingWindowMinutes(booking: FohBooking, serviceDateIso: string): { start: number; end: number } | null {
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

function buildTimelineRange(schedule: FohScheduleResponse['data'] | null): TimelineRange {
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

function mapFohBlockedReason(blockedReason?: string | null, reason?: string | null): string {
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

function mapFohEventBlockedReason(reason?: string | null): string {
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

function formatGbp(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 2
  }).format(amount)
}

function formatEventOptionDateTime(event: FohEventOption): string {
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

function formatUpcomingTickerEvent(event: FohUpcomingEvent): string {
  if (event.start_datetime) {
    try {
      const dateLabel = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }).format(new Date(event.start_datetime))
      return `${dateLabel} ${event.name}`
    } catch {
      // Fallback to raw fields below.
    }
  }

  if (event.time) {
    return `${event.date} ${event.time.slice(0, 5)} ${event.name}`
  }

  return `${event.date} ${event.name}`
}

function formatEventPaymentMode(paymentMode: FohEventOption['payment_mode']): string {
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

function formatEventBookingMode(mode: FohEventOption['booking_mode']): string {
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

function getTableDurationMinutes(input: {
  purpose: 'food' | 'drinks'
  sundayLunch: boolean
}): number {
  if (input.sundayLunch) return 120
  return input.purpose === 'food' ? 120 : 90
}

function getTableWindowMs(input: {
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
    hour12: true
  })
  return `${formatter.format(new Date(startMs - 15 * 60 * 1000))} - ${formatter.format(new Date(endMs))}`
}

function isSundayDate(dateIso: string): boolean {
  const parsed = new Date(`${dateIso}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.getUTCDay() === 0
}

function shiftIsoDate(dateIso: string, dayDelta: number): string {
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

function suggestWalkInTime(input: {
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

function resolveWalkInDefaults(input: {
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

async function postBookingAction(path: string, body?: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const errorMessage = payload && typeof payload.error === 'string' ? payload.error : 'Action failed'
    throw new Error(errorMessage)
  }

  return payload
}

function splitName(fullName: string): { firstName?: string; lastName?: string } {
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

export function FohScheduleClient({
  initialDate,
  canEdit,
  styleVariant = 'default'
}: {
  initialDate: string
  canEdit: boolean
  styleVariant?: FohStyleVariant
}) {
  const supabase = useMemo(() => createSupabaseClient(), [])
  const isManagerKioskStyle = styleVariant === 'manager_kiosk'
  const panelSurfaceClass = isManagerKioskStyle
    ? 'rounded-xl border border-green-200 bg-white shadow-sm'
    : 'rounded-lg border border-gray-200 bg-white'
  const [date, setDate] = useState(initialDate)
  const [schedule, setSchedule] = useState<FohScheduleResponse['data'] | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [bookingActionInFlight, setBookingActionInFlight] = useState<string | null>(null)
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({})
  const [selectedBookingContext, setSelectedBookingContext] = useState<SelectedBookingContext | null>(null)

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [createMode, setCreateMode] = useState<FohCreateMode>('booking')
  const [walkInTargetTable, setWalkInTargetTable] = useState<WalkInTargetTable | null>(null)
  const [submittingFoodOrderAlert, setSubmittingFoodOrderAlert] = useState(false)
  const [submittingBooking, setSubmittingBooking] = useState(false)
  const [searchingCustomers, setSearchingCustomers] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<FohCustomerSearchResult[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<FohCustomerSearchResult | null>(null)
  const [sundayMenuItems, setSundayMenuItems] = useState<SundayMenuItem[]>([])
  const [loadingSundayMenu, setLoadingSundayMenu] = useState(false)
  const [hasLoadedSundayMenu, setHasLoadedSundayMenu] = useState(false)
  const [sundayMenuError, setSundayMenuError] = useState<string | null>(null)
  const [sundayPreorderQuantities, setSundayPreorderQuantities] = useState<Record<string, string>>({})
  const [eventOptions, setEventOptions] = useState<FohEventOption[]>([])
  const [loadingEventOptions, setLoadingEventOptions] = useState(false)
  const [eventOptionsError, setEventOptionsError] = useState<string | null>(null)
  const [walkInPurposeAutoSelectionEnabled, setWalkInPurposeAutoSelectionEnabled] = useState(false)
  const [tableEventPromptAcknowledgedEventId, setTableEventPromptAcknowledgedEventId] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState(() => new Date())
  const [upcomingEvents, setUpcomingEvents] = useState<FohUpcomingEvent[]>([])

  const [createForm, setCreateForm] = useState({
    booking_date: initialDate,
    event_id: '',
    phone: '',
    default_country_code: '44',
    customer_name: '',
    first_name: '',
    last_name: '',
    time: '19:00',
    party_size: '2',
    purpose: 'food' as 'food' | 'drinks' | 'event',
    sunday_lunch: false,
    sunday_preorder_mode: 'send_link' as 'send_link' | 'capture_now',
    notes: ''
  })

  const fetchSchedule = useCallback(async (requestedDate: string) => {
    const response = await fetch(`/api/foh/schedule?date=${encodeURIComponent(requestedDate)}`, {
      cache: 'no-store'
    })

    const payload = (await response.json()) as FohScheduleResponse
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error || 'Failed to load Front of House schedule')
    }

    return payload.data
  }, [])

  const fetchUpcomingEvents = useCallback(async () => {
    const response = await fetch('/api/foh/events/upcoming?limit=4', {
      cache: 'no-store'
    })

    const payload = (await response.json()) as FohUpcomingEventsResponse
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Failed to load upcoming events')
    }

    return Array.isArray(payload.data) ? payload.data : []
  }, [])

  useEffect(() => {
    let isCancelled = false

    async function load() {
      setLoading(true)
      setErrorMessage(null)
      try {
        const payload = await fetchSchedule(date)

        if (!isCancelled) {
          setSchedule(payload)
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load Front of House schedule')
          setSchedule(null)
        }
      } finally {
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      isCancelled = true
    }
  }, [date, fetchSchedule])

  const reloadSchedule = useCallback(
    async ({ requestedDate = date, surfaceError = true }: { requestedDate?: string; surfaceError?: boolean } = {}) => {
      try {
        const data = await fetchSchedule(requestedDate)
        setSchedule(data)
      } catch (error) {
        if (surfaceError) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to reload Front of House schedule')
        }
        throw error
      }
    },
    [date, fetchSchedule]
  )

  useEffect(() => {
    let cancelled = false
    let refreshTimeoutId: number | null = null
    let pollIntervalId: number | null = null
    let channel: RealtimeChannel | null = null

    const queueRefresh = () => {
      if (cancelled) return
      if (refreshTimeoutId != null) return

      refreshTimeoutId = window.setTimeout(() => {
        refreshTimeoutId = null
        void reloadSchedule({ requestedDate: date, surfaceError: false }).catch(() => {
          // Best-effort realtime refresh; date-based loader handles surfaced errors.
        })
      }, 300)
    }

    channel = supabase
      .channel(`foh-schedule-live-${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_bookings', filter: `booking_date=eq.${date}` },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'booking_table_assignments' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tables' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customers' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'private_bookings' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'private_booking_items' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'venue_space_table_areas' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_areas' },
        queueRefresh
      )
      .subscribe()

    pollIntervalId = window.setInterval(queueRefresh, 60_000)

    return () => {
      cancelled = true
      if (refreshTimeoutId != null) {
        window.clearTimeout(refreshTimeoutId)
      }
      if (pollIntervalId != null) {
        window.clearInterval(pollIntervalId)
      }
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [date, reloadSchedule, supabase])

  useEffect(() => {
    let intervalId: number | null = null

    const tick = () => {
      setClockNow(new Date())
    }

    tick()

    const delayToNextMinute = 60_000 - (Date.now() % 60_000)
    const timeoutId = window.setTimeout(() => {
      tick()
      intervalId = window.setInterval(tick, 60_000)
    }, delayToNextMinute)

    return () => {
      window.clearTimeout(timeoutId)
      if (intervalId != null) {
        window.clearInterval(intervalId)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadUpcomingEvents = async () => {
      try {
        const rows = await fetchUpcomingEvents()
        if (!cancelled) {
          setUpcomingEvents(rows.slice(0, 4))
        }
      } catch {
        if (!cancelled) {
          setUpcomingEvents([])
        }
      }
    }

    void loadUpcomingEvents()

    return () => {
      cancelled = true
    }
  }, [clockNow, fetchUpcomingEvents])

  useEffect(() => {
    if (selectedCustomer) {
      setCustomerResults([])
      return
    }

    const query = customerQuery.trim()
    if (query.length < 2) {
      setCustomerResults([])
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setSearchingCustomers(true)

      try {
        const params = new URLSearchParams({
          q: query,
          default_country_code: createForm.default_country_code || '44'
        })

        const response = await fetch(`/api/foh/customers/search?${params.toString()}`, {
          cache: 'no-store'
        })

        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error((payload && payload.error) || 'Customer search failed')
        }

        if (!cancelled) {
          const rows = Array.isArray(payload?.data) ? payload.data : []
          setCustomerResults(rows as FohCustomerSearchResult[])
        }
      } catch {
        if (!cancelled) {
          setCustomerResults([])
        }
      } finally {
        if (!cancelled) {
          setSearchingCustomers(false)
        }
      }
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [customerQuery, createForm.default_country_code, selectedCustomer])

  useEffect(() => {
    if (isSundayDate(createForm.booking_date)) return

    setCreateForm((current) => ({
      ...current,
      sunday_lunch: false,
      sunday_preorder_mode: 'send_link'
    }))
    setSundayPreorderQuantities({})
  }, [createForm.booking_date])

  useEffect(() => {
    if (!isCreateModalOpen || !createForm.sunday_lunch || !isSundayDate(createForm.booking_date)) {
      return
    }

    if (hasLoadedSundayMenu || loadingSundayMenu) {
      return
    }

    let cancelled = false
    const controller = new AbortController()
    let timeoutId: number | null = null

    const loadSundayMenu = async () => {
      setLoadingSundayMenu(true)
      setSundayMenuError(null)
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            controller.abort()
            reject(new Error('Loading Sunday lunch menu timed out. Please retry.'))
          }, 12_000)
        })

        const response = (await Promise.race([
          fetch('/api/foh/sunday-preorder/menu', {
            cache: 'no-store',
            signal: controller.signal
          }),
          timeoutPromise
        ])) as Response

        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }

        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || 'Failed to load Sunday lunch menu')
        }

        if (!cancelled) {
          const rows = Array.isArray(payload?.data) ? payload.data : []
          setSundayMenuItems(rows as SundayMenuItem[])
        }
      } catch (error) {
        if (!cancelled) {
          setSundayMenuError(error instanceof Error ? error.message : 'Failed to load Sunday lunch menu')
        }
      } finally {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }
        if (!cancelled) {
          setLoadingSundayMenu(false)
          setHasLoadedSundayMenu(true)
        }
      }
    }

    void loadSundayMenu()

    return () => {
      cancelled = true
      if (timeoutId != null) {
        window.clearTimeout(timeoutId)
      }
      controller.abort()
    }
  }, [
    createForm.booking_date,
    createForm.sunday_lunch,
    hasLoadedSundayMenu,
    isCreateModalOpen
  ])

  useEffect(() => {
    if (!isCreateModalOpen) {
      return
    }

    const bookingDate = createForm.booking_date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
      setEventOptions([])
      setEventOptionsError('Please choose a valid event date')
      return
    }

    let cancelled = false
    const controller = new AbortController()

    const loadEvents = async () => {
      setLoadingEventOptions(true)
      setEventOptionsError(null)

      try {
        const params = new URLSearchParams({ date: bookingDate })
        const response = await fetch(`/api/foh/events?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal
        })
        const payload = await response.json().catch(() => null)

        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || 'Failed to load events')
        }

        if (cancelled) return
        const rows = Array.isArray(payload?.data) ? (payload.data as FohEventOption[]) : []
        setEventOptions(rows)
        setCreateForm((current) => {
          if (current.purpose !== 'event') {
            return current
          }
          if (rows.some((item) => item.id === current.event_id)) {
            return current
          }
          const nextEventId = rows.find((item) => !item.is_full)?.id || rows[0]?.id || ''
          return {
            ...current,
            event_id: nextEventId
          }
        })
      } catch (error) {
        if (cancelled) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        setEventOptions([])
        setEventOptionsError(error instanceof Error ? error.message : 'Failed to load events')
      } finally {
        if (!cancelled) {
          setLoadingEventOptions(false)
        }
      }
    }

    void loadEvents()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [createForm.booking_date, createForm.purpose, isCreateModalOpen])

  useEffect(() => {
    if (isCreateModalOpen) return
    setCreateForm((current) => ({
      ...current,
      booking_date: date
    }))
  }, [date, isCreateModalOpen])

  const tables = useMemo(() => {
    if (!schedule) return []
    return schedule.lanes.map((lane) => ({
      id: lane.table_id,
      name: lane.table_name
    }))
  }, [schedule])

  const timeline = useMemo(() => buildTimelineRange(schedule), [schedule])
  const totals = useMemo(() => {
    if (!schedule) {
      return { bookings: 0, covers: 0 }
    }

    const uniqueBookings = new Map<string, FohBooking>()
    for (const lane of schedule.lanes) {
      for (const booking of lane.bookings) {
        if (!uniqueBookings.has(booking.id)) {
          uniqueBookings.set(booking.id, booking)
        }
      }
    }
    for (const booking of schedule.unassigned_bookings || []) {
      if (!uniqueBookings.has(booking.id)) {
        uniqueBookings.set(booking.id, booking)
      }
    }

    const activeBookings = Array.from(uniqueBookings.values()).filter((booking) => {
      if (booking.is_private_block) {
        return false
      }
      const status = (booking.status || '').toLowerCase()
      return status !== 'cancelled' && status !== 'no_show'
    })

    return {
      bookings: activeBookings.length,
      covers: activeBookings.reduce((sum, booking) => {
        const partySize = Number(booking.party_size || 1)
        return sum + (Number.isFinite(partySize) && partySize > 0 ? partySize : 1)
      }, 0)
    }
  }, [schedule])
  const upcomingTickerText = useMemo(() => {
    if (upcomingEvents.length === 0) {
      return 'Reminder: no upcoming scheduled events right now.'
    }

    return `Reminder: book guests in for ${upcomingEvents.map((event) => formatUpcomingTickerEvent(event)).join(' • ')}`
  }, [upcomingEvents])
  const upcomingTickerAnimationDurationSeconds = useMemo(
    () => Math.max(28, Math.round(upcomingTickerText.length * 0.24)),
    [upcomingTickerText]
  )

  const sundaySelected = isSundayDate(createForm.booking_date)
  const sundayMenuByCategory = useMemo(() => {
    return sundayMenuItems.reduce<Record<string, SundayMenuItem[]>>((acc, item) => {
      const category = item.category_name || 'Other'
      if (!acc[category]) {
        acc[category] = []
      }
      acc[category].push(item)
      return acc
    }, {})
  }, [sundayMenuItems])
  const sundaySelectedItemCount = useMemo(() => {
    return sundayMenuItems.reduce((count, item) => {
      const quantity = Number.parseInt(sundayPreorderQuantities[item.menu_dish_id] || '0', 10)
      return count + (Number.isFinite(quantity) && quantity > 0 ? 1 : 0)
    }, 0)
  }, [sundayMenuItems, sundayPreorderQuantities])
  const selectedEventOption = useMemo(
    () => eventOptions.find((eventOption) => eventOption.id === createForm.event_id) || null,
    [createForm.event_id, eventOptions]
  )
  const overlappingEventForTable = useMemo(() => {
    if (createForm.purpose === 'event') return null
    const tablePurpose = createForm.purpose === 'drinks' ? 'drinks' : 'food'

    const tableWindow = getTableWindowMs({
      bookingDate: createForm.booking_date,
      bookingTime: createForm.time,
      purpose: tablePurpose,
      sundayLunch: createForm.sunday_lunch
    })
    if (!tableWindow) return null

    for (const eventOption of eventOptions) {
      if (eventOption.booking_mode === 'general') {
        continue
      }
      const eventStartMs = Date.parse(eventOption.start_datetime || '')
      const eventEndMs = Date.parse(eventOption.end_datetime || '')
      if (!Number.isFinite(eventStartMs) || !Number.isFinite(eventEndMs)) {
        continue
      }

      const eventPromptStartMs = eventStartMs - 15 * 60 * 1000
      const overlaps = tableWindow.startMs < eventEndMs && tableWindow.endMs > eventPromptStartMs
      if (overlaps) {
        return eventOption
      }
    }

    return null
  }, [
    createForm.booking_date,
    createForm.purpose,
    createForm.sunday_lunch,
    createForm.time,
    eventOptions
  ])
  const selectedBooking = selectedBookingContext?.booking ?? null
  const selectedBookingVisualState = selectedBooking ? getBookingVisualState(selectedBooking) : 'unknown'
  const selectedBookingVisualLabel = selectedBooking ? getBookingVisualLabel(selectedBooking) : 'Unknown'
  const selectedBookingSeatedTime = formatLifecycleTime(selectedBooking?.seated_at)
  const selectedBookingLeftTime = formatLifecycleTime(selectedBooking?.left_at)
  const selectedBookingNoShowTime = formatLifecycleTime(selectedBooking?.no_show_at)
  const selectedMoveTarget = selectedBooking ? moveTargets[selectedBooking.id] || '' : ''
  const selectedMoveOptions = useMemo(() => {
    if (!selectedBooking) return []

    const assignedTableIds = new Set(selectedBooking.assigned_table_ids || [])
    return tables.filter((table) => !assignedTableIds.has(table.id))
  }, [selectedBooking, tables])

  useEffect(() => {
    if (!overlappingEventForTable) {
      setTableEventPromptAcknowledgedEventId(null)
      return
    }

    if (
      tableEventPromptAcknowledgedEventId &&
      tableEventPromptAcknowledgedEventId !== overlappingEventForTable.id
    ) {
      setTableEventPromptAcknowledgedEventId(null)
    }
  }, [overlappingEventForTable, tableEventPromptAcknowledgedEventId])

  function openBookingDetails(
    booking: FohBooking,
    context: {
      laneTableId: string | null
      laneTableName: string | null
    }
  ) {
    setSelectedBookingContext({
      booking,
      laneTableId: context.laneTableId,
      laneTableName: context.laneTableName
    })
    setErrorMessage(null)
    setStatusMessage(null)
  }

  function closeBookingDetails() {
    setSelectedBookingContext(null)
    setBookingActionInFlight(null)
  }

  async function runAction(
    action: () => Promise<void>,
    successMessage: string,
    inFlightLabel?: string
  ): Promise<boolean> {
    setErrorMessage(null)
    setStatusMessage(null)
    setBookingActionInFlight(inFlightLabel || successMessage)

    try {
      await action()
      await reloadSchedule()
      setStatusMessage(successMessage)
      return true
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Action failed')
      return false
    } finally {
      setBookingActionInFlight(null)
    }
  }

  function onMoveTargetChange(bookingId: string, tableId: string) {
    setMoveTargets((current) => ({
      ...current,
      [bookingId]: tableId
    }))
  }

  function resetCreateModalState() {
    setCreateForm((current) => ({
      booking_date: date,
      event_id: '',
      phone: '',
      default_country_code: current.default_country_code || '44',
      customer_name: '',
      first_name: '',
      last_name: '',
      time: current.time || '19:00',
      party_size: current.party_size || '2',
      purpose: 'food',
      sunday_lunch: false,
      sunday_preorder_mode: 'send_link',
      notes: ''
    }))
    setCreateMode('booking')
    setWalkInTargetTable(null)
    setCustomerQuery('')
    setCustomerResults([])
    setSelectedCustomer(null)
    setHasLoadedSundayMenu(false)
    setSundayMenuItems([])
    setSundayPreorderQuantities({})
    setSundayMenuError(null)
    setEventOptions([])
    setEventOptionsError(null)
    setWalkInPurposeAutoSelectionEnabled(false)
    setTableEventPromptAcknowledgedEventId(null)
  }

  const resolveCurrentWalkInDefaults = useCallback(
    (serviceDateIso: string, now: Date) =>
      resolveWalkInDefaults({
        serviceDateIso,
        now,
        serviceWindow: schedule?.service_window,
        timelineStartMin: timeline.startMin,
        timelineEndMin: timeline.endMin,
        eventOptions
      }),
    [eventOptions, schedule?.service_window, timeline.endMin, timeline.startMin]
  )

  useEffect(() => {
    if (!isCreateModalOpen || createMode !== 'walk_in' || !walkInPurposeAutoSelectionEnabled) {
      return
    }

    setCreateForm((current) => {
      const defaults = resolveCurrentWalkInDefaults(current.booking_date, clockNow)
      const nextPurpose = defaults.purpose
      const nextEventId = nextPurpose === 'event' ? defaults.eventId : ''
      const nextTime = nextPurpose === 'event' ? current.time : defaults.time

      if (
        current.purpose === nextPurpose &&
        current.event_id === nextEventId &&
        current.time === nextTime
      ) {
        return current
      }

      return {
        ...current,
        purpose: nextPurpose,
        event_id: nextEventId,
        time: nextTime,
        sunday_lunch: false
      }
    })
  }, [
    clockNow,
    createMode,
    isCreateModalOpen,
    resolveCurrentWalkInDefaults,
    walkInPurposeAutoSelectionEnabled
  ])

  function openCreateModal(options?: {
    mode?: FohCreateMode
    laneTableId?: string
    laneTableName?: string
    suggestedTime?: string
  }) {
    const requestedMode = options?.mode || 'booking'
    const walkInMode = requestedMode === 'walk_in'

    setErrorMessage(null)
    setStatusMessage(null)
    setCreateMode(requestedMode)
    setWalkInTargetTable(
      walkInMode && options?.laneTableId
        ? {
            id: options.laneTableId,
            name: options.laneTableName || 'selected table'
          }
        : null
    )
    const walkInDefaults = walkInMode
      ? resolveCurrentWalkInDefaults(date, clockNow)
      : null
    setCreateForm((current) => ({
      ...current,
      booking_date: date,
      time: walkInMode
        ? options?.suggestedTime || walkInDefaults?.time || current.time
        : options?.suggestedTime || current.time,
      purpose:
        walkInMode
          ? walkInDefaults?.purpose || 'food'
          : current.purpose,
      event_id: walkInMode ? walkInDefaults?.eventId || '' : current.event_id,
      sunday_lunch: walkInMode ? false : current.sunday_lunch,
      phone: walkInMode ? '' : current.phone,
      customer_name: walkInMode ? '' : current.customer_name,
      first_name: walkInMode ? '' : current.first_name,
      last_name: walkInMode ? '' : current.last_name,
      notes: walkInMode ? '' : current.notes
    }))

    if (walkInMode) {
      setCustomerQuery('')
      setCustomerResults([])
      setSelectedCustomer(null)
      setWalkInPurposeAutoSelectionEnabled(true)
    } else {
      setWalkInPurposeAutoSelectionEnabled(false)
    }

    setIsCreateModalOpen(true)
  }

  function closeCreateModal() {
    setIsCreateModalOpen(false)
    resetCreateModalState()
  }

  function openWalkInModalFromLane(lane: { table_id: string; table_name: string }) {
    if (!canEdit) return

    openCreateModal({
      mode: 'walk_in',
      laneTableId: lane.table_id,
      laneTableName: lane.table_name
    })
  }

  async function sendFoodOrderAlert() {
    if (!canEdit || submittingFoodOrderAlert) {
      return
    }

    setErrorMessage(null)
    setStatusMessage(null)
    setSubmittingFoodOrderAlert(true)

    try {
      const response = await fetch('/api/foh/food-order-alert', {
        method: 'POST'
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to send food order alert')
      }

      setStatusMessage('Food order alert sent.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send food order alert')
    } finally {
      setSubmittingFoodOrderAlert(false)
    }
  }

  async function handleCreateBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setErrorMessage(null)
    setStatusMessage(null)
    const isWalkIn = createMode === 'walk_in'

    const bookingDate = createForm.booking_date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
      setErrorMessage('Please pick a valid booking date')
      return
    }

    const effectiveBookingTime = isWalkIn
      ? suggestWalkInTime({
          serviceDateIso: bookingDate,
          now: new Date(),
          serviceWindow: schedule?.service_window,
          timelineStartMin: timeline.startMin,
          timelineEndMin: timeline.endMin,
          purpose: createForm.purpose === 'drinks' ? 'drinks' : 'food'
        })
      : createForm.time

    if (isWalkIn && createForm.time !== effectiveBookingTime) {
      setCreateForm((current) => ({
        ...current,
        time: effectiveBookingTime
      }))
    }

    if (!isWalkIn && !selectedCustomer && !createForm.phone.trim()) {
      setErrorMessage('Select a customer or provide a phone number')
      return
    }

    const nameParts = splitName(createForm.customer_name)
    const firstName = createForm.first_name.trim() || nameParts.firstName || undefined
    const lastName = createForm.last_name.trim() || nameParts.lastName || undefined

    if (createForm.purpose === 'event') {
      const seats = Number.parseInt(createForm.party_size, 10)
      if (!Number.isFinite(seats) || seats < 1) {
        setErrorMessage('Please enter a valid number of seats')
        return
      }

      if (!createForm.event_id) {
        setErrorMessage('Please select an event')
        return
      }

      setSubmittingBooking(true)

      try {
        const response = await fetch('/api/foh/event-bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: isWalkIn ? undefined : selectedCustomer?.id || undefined,
            phone: createForm.phone.trim() || undefined,
            default_country_code: createForm.default_country_code || undefined,
            first_name: firstName,
            last_name: lastName,
            walk_in: isWalkIn || undefined,
            walk_in_guest_name: isWalkIn ? createForm.customer_name.trim() || undefined : undefined,
            event_id: createForm.event_id,
            seats
          })
        })

        const payload = (await response.json()) as FohCreateEventBookingResponse
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to create event booking')
        }

        if (!payload.success || !payload.data) {
          throw new Error('Failed to create event booking')
        }

        if (payload.data.state === 'blocked') {
          setErrorMessage(mapFohEventBlockedReason(payload.data.reason))
          return
        }

        if (payload.data.state === 'full_with_waitlist_option') {
          const remainingText =
            typeof payload.data.seats_remaining === 'number'
              ? ` (${payload.data.seats_remaining} seats left)`
              : ''
          setErrorMessage(`This event is full for that seat request${remainingText}.`)
          return
        }

        const bookingRef = payload.data.booking_id || 'booking'
        const eventNameText = payload.data.event_name ? ` for ${payload.data.event_name}` : ''
        const outcome =
          payload.data.state === 'pending_payment'
            ? 'reserved and awaiting payment'
            : isWalkIn
              ? 'created, confirmed and seated'
              : 'created and confirmed'
        let tableText = payload.data.table_name ? ` Table: ${payload.data.table_name}.` : ''
        let walkInTableMoveText = ''

        if (isWalkIn && walkInTargetTable?.id && payload.data.table_booking_id) {
          try {
            await postBookingAction(`/api/foh/bookings/${payload.data.table_booking_id}/move-table`, {
              table_id: walkInTargetTable.id
            })
            tableText = ` Table: ${walkInTargetTable.name}.`
          } catch (moveError) {
            const moveMessage = moveError instanceof Error ? moveError.message : 'table assignment update failed'
            walkInTableMoveText = ` (booking created but not moved to ${walkInTargetTable.name}: ${moveMessage})`
          }
        }

        const paymentLinkText = payload.data.next_step_url ? ` Payment link: ${payload.data.next_step_url}` : ''
        const manageLinkText = payload.data.manage_booking_url
          ? ` Manage link: ${payload.data.manage_booking_url}`
          : ''
        const bookingLabel = isWalkIn ? 'Walk-in event booking' : 'Event booking'

        setStatusMessage(
          `${bookingLabel} ${bookingRef}${eventNameText} was ${outcome}.${tableText}${walkInTableMoveText}${paymentLinkText}${manageLinkText}`
        )
        closeCreateModal()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to create event booking')
      } finally {
        setSubmittingBooking(false)
      }

      return
    }

    const partySize = Number.parseInt(createForm.party_size, 10)
    if (!Number.isFinite(partySize) || partySize < 1) {
      setErrorMessage('Please enter a valid party size')
      return
    }

    if (
      !isWalkIn &&
      overlappingEventForTable &&
      tableEventPromptAcknowledgedEventId !== overlappingEventForTable.id
    ) {
      setErrorMessage('Please confirm whether this booking is for the overlapping event.')
      return
    }

    let sundayPreorderItems: Array<{ menu_dish_id: string; quantity: number }> = []
    if (createForm.sunday_lunch && createForm.sunday_preorder_mode === 'capture_now') {
      if (sundayMenuItems.length === 0) {
        setErrorMessage('Sunday lunch menu is unavailable right now. Choose "Send link by text" instead.')
        return
      }

      sundayPreorderItems = sundayMenuItems
        .map((item) => {
          const quantity = Number.parseInt(sundayPreorderQuantities[item.menu_dish_id] || '0', 10)
          if (!Number.isFinite(quantity) || quantity <= 0) {
            return null
          }
          return {
            menu_dish_id: item.menu_dish_id,
            quantity
          }
        })
        .filter((item): item is { menu_dish_id: string; quantity: number } => Boolean(item))

      if (sundayPreorderItems.length === 0) {
        setErrorMessage('Add at least one Sunday lunch item or choose "Send link by text".')
        return
      }
    }

    setSubmittingBooking(true)

    try {
      const response = await fetch('/api/foh/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: isWalkIn ? undefined : selectedCustomer?.id || undefined,
          phone: createForm.phone.trim() || undefined,
          default_country_code: createForm.default_country_code || undefined,
          first_name: firstName,
          last_name: lastName,
          walk_in: isWalkIn || undefined,
          walk_in_guest_name: isWalkIn ? createForm.customer_name.trim() || undefined : undefined,
          date: bookingDate,
          time: effectiveBookingTime,
          party_size: partySize,
          purpose: createForm.purpose === 'drinks' ? 'drinks' : 'food',
          notes: createForm.notes || undefined,
          sunday_lunch: createForm.sunday_lunch,
          sunday_preorder_mode: createForm.sunday_lunch ? createForm.sunday_preorder_mode : undefined,
          sunday_preorder_items: sundayPreorderItems.length > 0 ? sundayPreorderItems : undefined
        })
      })

      const payload = (await response.json()) as FohCreateBookingResponse
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to create booking')
      }

      if (!payload.success || !payload.data) {
        throw new Error('Failed to create booking')
      }

      if (payload.data.state === 'blocked') {
        setErrorMessage(mapFohBlockedReason(payload.data.blocked_reason, payload.data.reason))
        return
      }

      const bookingRef = payload.data.booking_reference || payload.data.table_booking_id || 'booking'
      const outcome =
        payload.data.state === 'pending_card_capture'
          ? 'created and awaiting card capture'
          : isWalkIn
            ? 'created, confirmed and seated'
            : 'created and confirmed'
      let tableText = payload.data.table_name ? ` on ${payload.data.table_name}` : ''
      let walkInTableMoveText = ''

      if (isWalkIn && walkInTargetTable?.id && payload.data.table_booking_id) {
        try {
          await postBookingAction(`/api/foh/bookings/${payload.data.table_booking_id}/move-table`, {
            table_id: walkInTargetTable.id
          })
          tableText = ` on ${walkInTargetTable.name}`
        } catch (moveError) {
          const moveMessage = moveError instanceof Error ? moveError.message : 'table assignment update failed'
          walkInTableMoveText = ` (created but not moved to ${walkInTargetTable.name}: ${moveMessage})`
        }
      }

      let sundayPreorderText = ''
      if (createForm.sunday_lunch) {
        if (payload.data.sunday_preorder_state === 'captured') {
          sundayPreorderText = ' Sunday pre-order captured.'
        } else if (payload.data.sunday_preorder_state === 'link_sent') {
          sundayPreorderText = ' Sunday pre-order link sent by text.'
        } else if (payload.data.sunday_preorder_state === 'capture_blocked') {
          sundayPreorderText = ' Sunday pre-order could not be captured.'
        } else if (payload.data.sunday_preorder_state === 'link_not_sent') {
          sundayPreorderText = ' Sunday pre-order link could not be sent.'
        }
      }

      await reloadSchedule()
      const bookingLabel = isWalkIn ? 'Walk-in booking' : 'Table booking'
      setStatusMessage(`${bookingLabel} ${bookingRef}${tableText}${walkInTableMoveText} was ${outcome}.${sundayPreorderText}`)
      closeCreateModal()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create booking')
    } finally {
      setSubmittingBooking(false)
    }
  }

  const timelineDuration = Math.max(1, timeline.endMin - timeline.startMin)
  const currentTimelineLeftPct = useMemo(() => {
    const serviceDateIso = schedule?.date || date
    const nowMinute = minutesFromServiceDate(clockNow.toISOString(), serviceDateIso)
    if (nowMinute == null) return null
    if (nowMinute < timeline.startMin || nowMinute > timeline.endMin) return null
    return ((nowMinute - timeline.startMin) / timelineDuration) * 100
  }, [clockNow, date, schedule, timeline.endMin, timeline.startMin, timelineDuration])
  const pageWrapperClass = cn(
    isManagerKioskStyle ? 'space-y-2 rounded-xl bg-sidebar p-2 sm:p-3' : 'space-y-6'
  )
  const serviceCardClass = cn(panelSurfaceClass, isManagerKioskStyle ? 'p-2' : 'p-4')
  const serviceHeaderClass = cn(
    'flex flex-col sm:flex-row sm:justify-between',
    isManagerKioskStyle ? 'gap-1.5 sm:items-center' : 'gap-3 sm:items-end'
  )
  const serviceDateLabelClass = cn(
    'block text-sm font-medium text-gray-900',
    isManagerKioskStyle && 'sr-only'
  )
  const serviceDateControlsClass = cn(
    'flex items-center gap-2 whitespace-nowrap overflow-x-auto',
    isManagerKioskStyle ? 'mt-0' : 'mt-1'
  )
  const totalsBadgeClass = cn(
    'rounded-md border px-2 py-1 text-[11px] font-medium',
    isManagerKioskStyle
      ? 'border-green-300 bg-green-50 text-green-900'
      : 'border-gray-300 bg-gray-100 text-gray-700'
  )
  const tickerContainerClass = cn(
    'mb-2 overflow-hidden rounded-md border',
    isManagerKioskStyle
      ? 'border-green-300 bg-green-50 text-green-900'
      : 'border-sidebar/30 bg-sidebar/5 text-sidebar'
  )
  const tickerTextClass = cn(
    'flex min-w-full w-max items-center whitespace-nowrap pr-6',
    isManagerKioskStyle ? 'py-1.5 text-[11px] font-semibold' : 'py-2 text-sm font-medium'
  )
  const daySwitchButtonClass = cn(
    'rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50',
    isManagerKioskStyle ? 'px-1.5 py-1 text-xs' : 'px-2.5 py-2'
  )
  const dateInputClass = cn(
    'rounded-md border border-gray-300 text-sm',
    isManagerKioskStyle ? 'px-1.5 py-1 text-xs' : 'px-3 py-2'
  )
  const unassignedCardClass = cn(
    'rounded-lg border border-amber-200 bg-amber-50',
    isManagerKioskStyle ? 'p-2' : 'p-4'
  )
  const swimlaneCardClass = cn(
    panelSurfaceClass,
    isManagerKioskStyle ? 'p-2' : 'p-4'
  )
  const swimlaneHeaderRowClass = cn(
    'flex items-center justify-between',
    isManagerKioskStyle ? 'mb-2' : 'mb-3'
  )
  const tableHeaderCellClass = cn(
    'font-semibold uppercase tracking-wide text-gray-600',
    isManagerKioskStyle ? 'px-2 py-1.5 text-[10px]' : 'px-3 py-2 text-xs'
  )
  const timelineHeaderTrackClass = cn(
    'relative',
    isManagerKioskStyle ? 'h-10 px-1.5' : 'h-10 px-2'
  )
  const laneMetaCellClass = cn(
    'space-y-1 bg-white',
    isManagerKioskStyle ? 'px-2 py-1.5' : 'px-3 py-2'
  )
  const laneTimelineClass = cn(
    'relative overflow-hidden bg-gray-50/60',
    isManagerKioskStyle ? 'h-12 pt-1' : 'h-14',
    canEdit && 'cursor-pointer hover:bg-sidebar/5'
  )
  const laneEmptyClass = cn(
    'absolute inset-0 flex items-center text-gray-400',
    isManagerKioskStyle ? 'px-2 text-[10px]' : 'px-3 text-xs'
  )
  const bookingBlockBaseClass = isManagerKioskStyle
    ? 'absolute top-1 h-10 overflow-hidden rounded-md border px-1 py-0.5 text-left text-[9px] shadow-sm transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-sidebar/40'
    : 'absolute top-1 h-12 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[10px] shadow-sm transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-sidebar/40'
  const timelineTickLabelClass = cn(
    'absolute -translate-x-1/2 font-medium text-gray-500',
    isManagerKioskStyle ? 'top-0.5 text-[9px]' : 'pt-0.5 text-[10px]'
  )
  const nowLineLabelClass = cn(
    'absolute left-0 -translate-x-1/2 rounded bg-red-600 text-white font-semibold',
    isManagerKioskStyle ? 'top-0.5 px-1 py-px text-[8px]' : 'top-0.5 px-1.5 py-px text-[9px]'
  )

  return (
    <div className={pageWrapperClass}>
      <div className={serviceCardClass}>
        <div className={tickerContainerClass}>
          <div
            className={tickerTextClass}
            style={{
              animation: `fohTickerMarquee ${upcomingTickerAnimationDurationSeconds}s linear infinite`
            }}
          >
            <span className="pr-10">{upcomingTickerText}</span>
            <span aria-hidden className="pr-10">
              {upcomingTickerText}
            </span>
          </div>
        </div>

        <div className={serviceHeaderClass}>
          <div>
            <label htmlFor="foh-date" className={serviceDateLabelClass}>
              Service date
            </label>
            <div className={serviceDateControlsClass}>
              <button
                type="button"
                onClick={() => setDate((current) => shiftIsoDate(current, -1))}
                className={daySwitchButtonClass}
                aria-label="Previous day"
              >
                Previous
              </button>
              <input
                id="foh-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={dateInputClass}
              />
              <button
                type="button"
                onClick={() => setDate((current) => shiftIsoDate(current, 1))}
                className={daySwitchButtonClass}
                aria-label="Next day"
              >
                Next
              </button>
              <span className={totalsBadgeClass}>Total bookings: {totals.bookings}</span>
              <span className={totalsBadgeClass}>Total covers: {totals.covers}</span>
            </div>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void sendFoodOrderAlert()}
                disabled={submittingFoodOrderAlert}
                aria-label="Send food order SMS alert"
                className={cn(
                  'inline-flex items-center gap-2 rounded-md border-2 border-red-900 bg-red-600 px-3.5 py-2 text-sm font-extrabold uppercase tracking-wide text-white shadow-sm ring-1 ring-red-200 transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70',
                  isManagerKioskStyle && 'px-2 py-1 text-[10px] font-black'
                )}
              >
                <Image
                  src="/logo.png"
                  alt=""
                  width={20}
                  height={20}
                  aria-hidden
                  className={cn('h-4 w-auto rounded-sm bg-white px-0.5 py-0.5', isManagerKioskStyle && 'h-3.5')}
                />
                <span>{submittingFoodOrderAlert ? 'Sending…' : 'Food Order'}</span>
              </button>
              <button
                type="button"
                onClick={() => openCreateModal({ mode: 'walk_in' })}
                className={cn(
                  'rounded-md border border-green-300 bg-white px-4 py-2 text-sm font-medium text-sidebar hover:bg-green-50',
                  isManagerKioskStyle && 'px-2.5 py-1 text-[11px] font-semibold'
                )}
              >
                Add walk-in
              </button>
              <button
                type="button"
                onClick={() => openCreateModal({ mode: 'booking' })}
                className={cn(
                  'rounded-md px-4 py-2 text-sm text-white',
                  isManagerKioskStyle
                    ? 'bg-sidebar px-2.5 py-1 text-[11px] font-semibold hover:bg-green-700'
                    : 'bg-sidebar font-medium hover:bg-sidebar/90'
                )}
              >
                Add booking
              </button>
            </div>
          )}
        </div>

        {statusMessage && (
          <div className={cn('rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800', isManagerKioskStyle ? 'mt-2' : 'mt-3')}>
            {statusMessage}
          </div>
        )}

        {errorMessage && (
          <div className={cn('rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800', isManagerKioskStyle ? 'mt-2' : 'mt-3')}>
            {errorMessage}
          </div>
        )}
      </div>

      {schedule?.unassigned_bookings && schedule.unassigned_bookings.length > 0 && (
        <div className={unassignedCardClass}>
          <h3 className={cn('font-semibold text-amber-900', isManagerKioskStyle ? 'text-xs' : 'text-sm')}>Unassigned bookings</h3>
          <div className={cn('flex flex-wrap gap-2', isManagerKioskStyle ? 'mt-2' : 'mt-3')}>
            {schedule.unassigned_bookings.map((booking) => (
              <button
                key={booking.id}
                type="button"
                onClick={() =>
                  openBookingDetails(booking, {
                    laneTableId: null,
                    laneTableName: null
                  })
                }
                className={cn(
                  'rounded-md border border-amber-200 bg-white text-amber-900 hover:bg-amber-100',
                  isManagerKioskStyle ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'
                )}
              >
                {booking.guest_name || booking.booking_reference || booking.id.slice(0, 8)} · {booking.party_size || 1} · {booking.booking_time}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={swimlaneCardClass}>
        <div className={swimlaneHeaderRowClass}>
          <h3 className="text-sm font-semibold text-gray-900">Table availability swimlanes</h3>
          <p className={cn('text-gray-500', isManagerKioskStyle ? 'text-[10px]' : 'text-xs')}>
            Service window {schedule?.service_window?.start_time || '09:00'} - {schedule?.service_window?.end_time || '23:00'}
            {schedule?.service_window?.end_next_day ? ' (+1 day)' : ''}
          </p>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[980px] border border-gray-200">
            <div className="grid grid-cols-[220px_1fr] border-b border-gray-200 bg-gray-50">
              <div className={tableHeaderCellClass}>Table</div>
              <div className={timelineHeaderTrackClass}>
                {timeline.ticks.map((minute) => {
                  const left = ((minute - timeline.startMin) / timelineDuration) * 100
                  return (
                    <div key={`tick-header-${minute}`} className="absolute inset-y-0" style={{ left: `${left}%` }}>
                      <div className="h-full border-l border-gray-200" />
                      <span className={timelineTickLabelClass}>
                        {formatLaneMinuteLabel(minute)}
                      </span>
                    </div>
                  )
                })}
                {currentTimelineLeftPct != null && (
                  <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${currentTimelineLeftPct}%` }}>
                    <div className="h-full w-0.5 -translate-x-1/2 bg-red-500/85" />
                    <span className={nowLineLabelClass}>Now</span>
                  </div>
                )}
              </div>
            </div>

            {(schedule?.lanes || []).map((lane) => (
              <div key={lane.table_id} className="grid grid-cols-[220px_1fr] border-b border-gray-200 last:border-b-0">
                <div className={laneMetaCellClass}>
                  <div>
                    <p className="text-xs font-semibold text-gray-900">
                      {lane.table_name}
                      {lane.table_number ? <span className="ml-1 text-xs text-gray-500">({lane.table_number})</span> : null}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      Capacity {lane.capacity || '-'}
                      {lane.area ? ` · ${lane.area}` : ''}
                      {lane.is_bookable === false ? ' · not bookable' : ''}
                    </p>
                  </div>
                </div>

                <div
                  className={laneTimelineClass}
                  onClick={() => {
                    openWalkInModalFromLane({
                      table_id: lane.table_id,
                      table_name: lane.table_name
                    })
                  }}
                >
                  {timeline.ticks.map((minute) => {
                    const left = ((minute - timeline.startMin) / timelineDuration) * 100
                    return (
                      <div key={`tick-${lane.table_id}-${minute}`} className="absolute inset-y-0" style={{ left: `${left}%` }}>
                        <div className="h-full border-l border-gray-200" />
                      </div>
                    )
                  })}

                  {lane.bookings.map((booking) => {
                    const window = resolveBookingWindowMinutes(booking, schedule?.date || date)
                    if (!window) return null

                    const clippedStart = Math.max(window.start, timeline.startMin)
                    const clippedEnd = Math.min(window.end, timeline.endMin)
                    if (clippedEnd <= clippedStart) return null

                    const leftPct = ((clippedStart - timeline.startMin) / timelineDuration) * 100
                    const widthPct = Math.max(2.2, ((clippedEnd - clippedStart) / timelineDuration) * 100)
                    const visualState = getBookingVisualState(booking)
                    const visualLabel = getBookingVisualLabel(booking)

                    return (
                        <button
                          type="button"
                          key={`${lane.table_id}-${booking.id}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            openBookingDetails(booking, {
                              laneTableId: lane.table_id,
                              laneTableName: lane.table_name
                            })
                          }}
                          className={`${bookingBlockBaseClass} ${statusBlockClass(visualState)}`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          title={`${booking.guest_name || 'Guest'} · ${booking.booking_reference || booking.id.slice(0, 8)} · ${formatBookingWindow(booking.start_datetime, booking.end_datetime, booking.booking_time)} · ${visualLabel}`}
                        >
                          <p className="truncate font-semibold">
                            {booking.guest_name || booking.booking_reference || booking.id.slice(0, 8)}
                          </p>
                          <p className="truncate">
                            {booking.is_private_block
                              ? formatBookingWindow(booking.start_datetime, booking.end_datetime, booking.booking_time)
                              : `${formatBookingWindow(booking.start_datetime, booking.end_datetime, booking.booking_time)} · ${booking.party_size || 1}p · ${visualLabel}`}
                          </p>
                      </button>
                    )
                  })}

                  {currentTimelineLeftPct != null && (
                    <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${currentTimelineLeftPct}%` }}>
                      <div className="h-full w-0.5 -translate-x-1/2 bg-red-500/75" />
                    </div>
                  )}

                  {lane.bookings.length === 0 && (
                    <div className={laneEmptyClass}>
                      {canEdit ? 'Tap lane to add walk-in' : 'Available for entire visible service window'}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(selectedBookingContext)}
        onClose={closeBookingDetails}
        title="Booking details"
        description="Click a booking block in the swimlane to open this panel."
        size="md"
      >
        {selectedBooking && (
          <div className="space-y-4">
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">
                  {selectedBooking.booking_reference || selectedBooking.id.slice(0, 8)}
                </p>
                <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(selectedBookingVisualState)}`}>
                  {selectedBookingVisualLabel}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-700">
                {selectedBooking.guest_name ? `${selectedBooking.guest_name} · ` : ''}
                {selectedBooking.is_private_block
                  ? formatBookingWindow(selectedBooking.start_datetime, selectedBooking.end_datetime, selectedBooking.booking_time)
                  : `${formatBookingWindow(selectedBooking.start_datetime, selectedBooking.end_datetime, selectedBooking.booking_time)} · ${selectedBooking.party_size || 1} people`}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {selectedBooking.booking_type || 'regular'} · {selectedBooking.booking_purpose || 'food'}
                {selectedBooking.assignment_count && selectedBooking.assignment_count > 1 ? ` · joined ${selectedBooking.assignment_count} tables` : ''}
                {selectedBookingContext?.laneTableName ? ` · table ${selectedBookingContext.laneTableName}` : ''}
              </p>
              {(selectedBookingSeatedTime || selectedBookingLeftTime || selectedBookingNoShowTime) && (
                <p className="mt-1 text-xs text-gray-500">
                  {selectedBookingSeatedTime ? `Seated ${selectedBookingSeatedTime}` : null}
                  {selectedBookingLeftTime ? `${selectedBookingSeatedTime ? ' · ' : ''}Left ${selectedBookingLeftTime}` : null}
                  {selectedBookingNoShowTime
                    ? `${selectedBookingSeatedTime || selectedBookingLeftTime ? ' · ' : ''}No-show ${selectedBookingNoShowTime}`
                    : null}
                </p>
              )}
              {selectedBooking.notes && <p className="mt-1 text-xs text-gray-600">Note: {selectedBooking.notes}</p>}
            </div>

            {selectedBooking.is_private_block && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                This block is managed by private-booking area mapping. Edit the private booking or area mapping in settings.
              </div>
            )}

            {canEdit && !selectedBooking.is_private_block && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={Boolean(bookingActionInFlight)}
                    onClick={() => {
                      void (async () => {
                        const ok = await runAction(
                          () => postBookingAction(`/api/foh/bookings/${selectedBooking.id}/seated`),
                          'Marked as seated',
                          'seated'
                        )
                        if (ok) closeBookingDetails()
                      })()
                    }}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {bookingActionInFlight === 'seated' ? 'Marking…' : 'Mark seated'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(bookingActionInFlight)}
                    onClick={() => {
                      void (async () => {
                        const ok = await runAction(
                          () => postBookingAction(`/api/foh/bookings/${selectedBooking.id}/left`),
                          'Marked as left',
                          'left'
                        )
                        if (ok) closeBookingDetails()
                      })()
                    }}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {bookingActionInFlight === 'left' ? 'Marking…' : 'Mark left'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(bookingActionInFlight)}
                    onClick={() => {
                      void (async () => {
                        const ok = await runAction(
                          () => postBookingAction(`/api/foh/bookings/${selectedBooking.id}/no-show`),
                          'No-show recorded',
                          'no_show'
                        )
                        if (ok) closeBookingDetails()
                      })()
                    }}
                    className="rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {bookingActionInFlight === 'no_show' ? 'Saving…' : 'Mark no-show'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(bookingActionInFlight)}
                    onClick={() => {
                      const raw = window.prompt('Walkout amount (GBP)')
                      if (!raw) return
                      const amount = Number(raw)
                      if (!Number.isFinite(amount) || amount <= 0) {
                        setErrorMessage('Please enter a valid walkout amount')
                        return
                      }

                      void (async () => {
                        const ok = await runAction(
                          () => postBookingAction(`/api/foh/bookings/${selectedBooking.id}/walkout`, { amount }),
                          'Walkout charge request created',
                          'walkout'
                        )
                        if (ok) closeBookingDetails()
                      })()
                    }}
                    className="rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {bookingActionInFlight === 'walkout' ? 'Saving…' : 'Flag walkout'}
                  </button>
                </div>

                <div className="flex gap-2">
                  <select
                    value={selectedMoveTarget}
                    disabled={Boolean(bookingActionInFlight)}
                    onChange={(event) => onMoveTargetChange(selectedBooking.id, event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                  >
                    <option value="">Move to table…</option>
                    {selectedMoveOptions.map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedMoveTarget || Boolean(bookingActionInFlight)}
                    onClick={() => {
                      if (!selectedMoveTarget) return
                      void (async () => {
                        const ok = await runAction(
                          () =>
                            postBookingAction(`/api/foh/bookings/${selectedBooking.id}/move-table`, {
                              table_id: selectedMoveTarget
                            }),
                          'Table assignment moved',
                          'move'
                        )
                        if (ok) closeBookingDetails()
                      })()
                    }}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {bookingActionInFlight === 'move' ? 'Moving…' : 'Move'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end border-t border-gray-200 pt-3">
              <button
                type="button"
                onClick={closeBookingDetails}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={isCreateModalOpen}
        onClose={closeCreateModal}
        title={createMode === 'walk_in' ? 'Add walk-in' : 'Add booking'}
        description={
          createMode === 'walk_in'
            ? 'Guest name and phone are optional. Covers are required. Tap a lane to pre-select a table and time.'
            : 'Search existing customer by name or phone first. If not found, enter phone details to create a new customer.'
        }
        size="lg"
      >
        <form onSubmit={handleCreateBooking} className="space-y-4">
          {createMode === 'booking' && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <label className="block text-xs font-medium text-gray-700">
                Find existing customer
                <input
                  type="text"
                  value={customerQuery}
                  onChange={(event) => {
                    setCustomerQuery(event.target.value)
                    if (selectedCustomer) {
                      setSelectedCustomer(null)
                    }
                  }}
                  placeholder="Search by name or phone"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <p className="mt-2 text-xs text-gray-500">
                Phone assumption uses country code +{createForm.default_country_code || '44'} unless full international format is entered.
              </p>

              {searchingCustomers && <p className="mt-2 text-xs text-gray-500">Searching customers…</p>}

              {!selectedCustomer && customerResults.length > 0 && (
                <div className="mt-2 max-h-56 overflow-auto rounded-md border border-gray-200 bg-white">
                  {customerResults.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(customer)
                        setCreateForm((current) => ({
                          ...current,
                          phone: customer.mobile_e164 || customer.mobile_number || ''
                        }))
                      }}
                      className="flex w-full items-start justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 last:border-b-0"
                    >
                      <span className="font-medium text-gray-900">{customer.full_name}</span>
                      <span className="text-xs text-gray-500">{customer.display_phone || 'No phone'}</span>
                    </button>
                  ))}
                </div>
              )}

              {selectedCustomer && (
                <div className="mt-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">Using customer: {selectedCustomer.full_name}</p>
                      <p className="text-xs text-green-700">{selectedCustomer.display_phone || 'No stored phone'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(null)
                        setCustomerQuery('')
                        setCustomerResults([])
                      }}
                      className="rounded border border-green-300 px-2 py-1 text-xs font-medium text-green-800 hover:bg-green-100"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {createMode === 'walk_in' && walkInTargetTable && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
              Walk-in will be moved to <span className="font-semibold">{walkInTargetTable.name}</span> after creation.
            </div>
          )}

          {createMode === 'walk_in' && !selectedCustomer && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                <label className="text-xs font-medium text-gray-700">
                  Guest phone (recommended)
                  <input
                    type="tel"
                    value={createForm.phone}
                    onChange={(event) => setCreateForm((current) => ({ ...current, phone: event.target.value }))}
                    placeholder="Optional"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-gray-700">
                  Country code
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{1,4}"
                    value={createForm.default_country_code}
                    onChange={(event) => {
                      const digitsOnly = event.target.value.replace(/\D/g, '').slice(0, 4)
                      setCreateForm((current) => ({ ...current, default_country_code: digitsOnly }))
                    }}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <p className="text-xs text-gray-500 md:col-span-2">
                  Start with phone when available. We match existing customer records by number before creating a new walk-in profile.
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-gray-700">
              Booking date
              <input
                type="date"
                required
                value={createForm.booking_date}
                onChange={(event) => setCreateForm((current) => ({ ...current, booking_date: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>

            {createForm.purpose !== 'event' && (
              <label className="text-xs font-medium text-gray-700">
                Time
                <input
                  type="time"
                  required
                  value={createForm.time}
                  onChange={(event) => setCreateForm((current) => ({ ...current, time: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            )}

            {createMode !== 'walk_in' && createForm.purpose !== 'event' && overlappingEventForTable && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 md:col-span-2">
                <p className="font-semibold">
                  This booking overlaps {overlappingEventForTable.name}.
                </p>
                <p className="mt-1">
                  Event window is {eventPromptWindowLabel(overlappingEventForTable)} (from 15 minutes before start until finish).
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCreateForm((current) => ({
                        ...current,
                        purpose: 'event',
                        event_id: overlappingEventForTable.id,
                        sunday_lunch: false
                      }))
                      setTableEventPromptAcknowledgedEventId(null)
                      setErrorMessage(null)
                    }}
                    className="rounded border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                  >
                    Yes, book for event
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTableEventPromptAcknowledgedEventId(overlappingEventForTable.id)
                      setErrorMessage(null)
                    }}
                    className="rounded border border-amber-300 bg-transparent px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100/60"
                  >
                    No, keep table booking
                  </button>
                </div>
              </div>
            )}

            {!selectedCustomer && createMode !== 'walk_in' && (
              <label className="text-xs font-medium text-gray-700">
                Phone
                <input
                  type="tel"
                  value={createForm.phone}
                  onChange={(event) => setCreateForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="07..."
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            )}

            {!selectedCustomer && createMode !== 'walk_in' && (
              <label className="text-xs font-medium text-gray-700">
                Default country code
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{1,4}"
                  value={createForm.default_country_code}
                  onChange={(event) => {
                    const digitsOnly = event.target.value.replace(/\D/g, '').slice(0, 4)
                    setCreateForm((current) => ({ ...current, default_country_code: digitsOnly }))
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            )}

            <label className="text-xs font-medium text-gray-700">
              {createForm.purpose === 'event' ? 'Seats' : 'Party size'}
              <input
                type="number"
                min={1}
                max={20}
                required
                value={createForm.party_size}
                onChange={(event) => setCreateForm((current) => ({ ...current, party_size: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs font-medium text-gray-700">
              Purpose
              <select
                value={createForm.purpose}
                onChange={(event) => {
                  const nextPurpose = event.target.value as 'food' | 'drinks' | 'event'
                  setTableEventPromptAcknowledgedEventId(null)
                  if (createMode === 'walk_in') {
                    setWalkInPurposeAutoSelectionEnabled(false)
                  }
                  setCreateForm((current) => ({
                    ...current,
                    purpose: nextPurpose,
                    sunday_lunch: nextPurpose === 'event' ? false : current.sunday_lunch,
                    event_id:
                      nextPurpose === 'event'
                        ? current.event_id || eventOptions.find((item) => !item.is_full)?.id || eventOptions[0]?.id || ''
                        : ''
                  }))
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="food">Food</option>
                <option value="drinks">Drinks</option>
                {eventOptions.length > 0 && <option value="event">Event</option>}
              </select>
            </label>

            {createForm.purpose === 'event' && (
              <>
                <label className="text-xs font-medium text-gray-700 md:col-span-2">
                  Event
                  <select
                    required
                    value={createForm.event_id}
                    onChange={(event) => {
                      if (createMode === 'walk_in') {
                        setWalkInPurposeAutoSelectionEnabled(false)
                      }
                      setCreateForm((current) => ({ ...current, event_id: event.target.value }))
                    }}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">
                      {loadingEventOptions ? 'Loading events…' : eventOptions.length === 0 ? 'No events found' : 'Select an event'}
                    </option>
                    {eventOptions.map((eventOption) => (
                      <option
                        key={eventOption.id}
                        value={eventOption.id}
                        disabled={eventOption.is_full}
                      >
                        {eventOption.name} · {formatEventOptionDateTime(eventOption)} · {formatEventBookingMode(eventOption.booking_mode)} · {eventOption.is_full ? 'Full' : `${eventOption.seats_remaining ?? '–'} seats left`}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedEventOption && (
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 md:col-span-2">
                    <p className="font-medium text-gray-900">{selectedEventOption.name}</p>
                    <p className="mt-1">
                      {formatEventOptionDateTime(selectedEventOption)} · {formatEventPaymentMode(selectedEventOption.payment_mode)}
                      {selectedEventOption.price_per_seat != null ? ` · ${formatGbp(selectedEventOption.price_per_seat)} per seat` : ''}
                      {selectedEventOption.booking_mode ? ` · ${formatEventBookingMode(selectedEventOption.booking_mode)}` : ''}
                    </p>
                    <p className="mt-1">
                      {selectedEventOption.is_full
                        ? 'This event is currently full.'
                        : `${selectedEventOption.seats_remaining ?? '–'} seats remaining`}
                    </p>
                  </div>
                )}

                {eventOptionsError && (
                  <p className="text-xs text-red-700 md:col-span-2">{eventOptionsError}</p>
                )}
              </>
            )}

            {!selectedCustomer && createMode === 'walk_in' && (
              <label className="text-xs font-medium text-gray-700">
                Guest name (optional)
                <input
                  type="text"
                  value={createForm.customer_name}
                  onChange={(event) => setCreateForm((current) => ({ ...current, customer_name: event.target.value }))}
                  placeholder="Jane Smith"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            )}

            {!selectedCustomer && createMode !== 'walk_in' && (
              <label className="text-xs font-medium text-gray-700">
                Customer name (for new customer)
                <input
                  type="text"
                  value={createForm.customer_name}
                  onChange={(event) => setCreateForm((current) => ({ ...current, customer_name: event.target.value }))}
                  placeholder="Jane Smith"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            )}

            {!selectedCustomer && createMode !== 'walk_in' && (
              <label className="text-xs font-medium text-gray-700">
                First name (optional)
                <input
                  type="text"
                  value={createForm.first_name}
                  onChange={(event) => setCreateForm((current) => ({ ...current, first_name: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            )}

            {!selectedCustomer && createMode !== 'walk_in' && (
              <label className="text-xs font-medium text-gray-700">
                Last name (optional)
                <input
                  type="text"
                  value={createForm.last_name}
                  onChange={(event) => setCreateForm((current) => ({ ...current, last_name: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            )}

            {createMode !== 'walk_in' && createForm.purpose !== 'event' && (
              <div className="space-y-2 md:col-span-2">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={createForm.sunday_lunch}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        sunday_lunch: event.target.checked,
                        sunday_preorder_mode: event.target.checked ? current.sunday_preorder_mode : 'send_link'
                      }))
                    }
                    disabled={!sundaySelected}
                  />
                  <span>Sunday lunch</span>
                </label>

                {createForm.sunday_lunch && sundaySelected && (
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-medium text-gray-800">Sunday pre-order</p>
                    <div className="mt-2 flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-xs text-gray-700">
                        <input
                          type="radio"
                          name="foh-sunday-preorder-mode"
                          value="send_link"
                          checked={createForm.sunday_preorder_mode === 'send_link'}
                          onChange={() =>
                            setCreateForm((current) => ({ ...current, sunday_preorder_mode: 'send_link' }))
                          }
                        />
                        <span>Send link by text</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-gray-700">
                        <input
                          type="radio"
                          name="foh-sunday-preorder-mode"
                          value="capture_now"
                          checked={createForm.sunday_preorder_mode === 'capture_now'}
                          onChange={() =>
                            setCreateForm((current) => ({ ...current, sunday_preorder_mode: 'capture_now' }))
                          }
                        />
                        <span>Capture now</span>
                      </label>
                    </div>

                    {createForm.sunday_preorder_mode === 'capture_now' && (
                      <div className="mt-3 space-y-3">
                        {loadingSundayMenu && (
                          <p className="text-xs text-gray-500">Loading Sunday lunch menu…</p>
                        )}

                        {sundayMenuError && (
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-red-700">{sundayMenuError}</p>
                            <button
                              type="button"
                              onClick={() => {
                                setSundayMenuError(null)
                                setHasLoadedSundayMenu(false)
                              }}
                              className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                            >
                              Retry
                            </button>
                          </div>
                        )}

                        {!loadingSundayMenu && !sundayMenuError && sundayMenuItems.length === 0 && (
                          <p className="text-xs text-gray-500">
                            Sunday lunch menu is not available. Choose &quot;Send link by text&quot;.
                          </p>
                        )}

                        {!loadingSundayMenu && !sundayMenuError && sundayMenuItems.length > 0 && (
                          <div className="space-y-3">
                            <p className="text-xs text-gray-600">
                              Selected items: {sundaySelectedItemCount}
                            </p>
                            {Object.entries(sundayMenuByCategory).map(([category, items]) => (
                              <div key={category} className="rounded-md border border-gray-200 bg-white p-2.5">
                                <p className="text-xs font-semibold text-gray-900">{category}</p>
                                <div className="mt-2 space-y-2">
                                  {items.map((item) => (
                                    <div key={item.menu_dish_id} className="grid grid-cols-[1fr_78px] items-center gap-2">
                                      <div>
                                        <p className="text-xs font-medium text-gray-900">{item.name}</p>
                                        <p className="text-[11px] text-gray-500">{formatGbp(item.price)}</p>
                                      </div>
                                      <input
                                        type="number"
                                        min={0}
                                        step={1}
                                        value={sundayPreorderQuantities[item.menu_dish_id] || ''}
                                        onChange={(event) => {
                                          const cleaned = event.target.value.replace(/[^\d]/g, '')
                                          setSundayPreorderQuantities((current) => ({
                                            ...current,
                                            [item.menu_dish_id]: cleaned
                                          }))
                                        }}
                                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                                        placeholder="0"
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {createForm.purpose !== 'event' && (
            <label className="block text-xs font-medium text-gray-700">
              Notes (optional)
              <textarea
                value={createForm.notes}
                onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))}
                rows={2}
                maxLength={500}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3">
            <p className="text-xs text-gray-500">
              {createMode === 'walk_in'
                ? 'Walk-ins require covers. Guest name and phone are optional.'
                : createForm.purpose !== 'event'
                ? 'Party sizes over 6 will be created as pending card capture based on policy.'
                : 'Event booking status depends on event payment mode and capacity.'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeCreateModal}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingBooking}
                className="rounded-md bg-sidebar px-4 py-2 text-sm font-medium text-white hover:bg-sidebar/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submittingBooking ? 'Creating…' : createMode === 'walk_in' ? 'Create walk-in' : 'Create booking'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <style jsx>{`
        @keyframes fohTickerMarquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  )
}
