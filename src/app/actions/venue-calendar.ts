'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { canViewCalendarNotes } from '@/app/actions/calendar-notes'
import { EventService } from '@/services/events'
import { loadSeriesOccurrencesInRange } from '@/lib/events/series-data'
import { calendarMonthWindow } from '@/lib/calendar/month-window'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { getErrorMessage } from '@/lib/errors'
import { DEFAULT_CALENDAR_NOTE_COLOUR } from '@/lib/rota/shift-template-colours'
import {
  denied,
  readBalanceDues,
  readBirthdays,
  readCalendarNotesInRange,
  readCoversByDate,
  readMarketingSends,
  readParkingInRange,
  readPrivateBookingsInRange,
  readSpecialHours,
  readStaffByDate,
  readTextMessagesByDate,
  type CalendarDataset,
  type CalendarPrivateBooking,
} from '@/lib/calendar/datasets'
import type { CalendarEventRow } from '@/lib/events/calendar-events'
import type { VenueCalendarMonthData } from '@/components/schedule-calendar/month-data'
import type { VenueCalendarEvent } from '@/components/schedule-calendar'
import type { RepeatingEventNight } from '@/components/schedule-calendar/adapters'

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function toVenueCalendarEvent(row: CalendarEventRow): VenueCalendarEvent {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    time: row.time,
    bookedSeatsCount: row.booked_count ?? 0,
    eventStatus: row.event_status,
    // Content readiness, so the calendar can flag and filter what still needs artwork or copy.
    hasImage: hasText(row.hero_image_url) || hasText(row.poster_image_url) || hasText(row.thumbnail_image_url),
    hasBrief: hasText(row.brief),
    hasDescription: hasText(row.short_description) || hasText(row.long_description),
  }
}

/** A failed layer becomes an empty layer plus one warning line, never a thrown error. */
function settle<T>(result: CalendarDataset<T>, warnings: string[]): T[] {
  if (result.status === 'failed') warnings.push(result.message)
  return result.data
}

async function readEvents(startIso: string, endIso: string): Promise<CalendarDataset<VenueCalendarEvent>> {
  try {
    const rows = await EventService.getCalendarEvents({ dateFrom: startIso, dateTo: endIso })
    const todayIso = getTodayIsoDate()
    // A draft whose date has gone never happened: it was a plan nobody published. Owner decision
    // (27 November 2026): past drafts stay off the calendar; future drafts still show, because
    // they are the plan.
    const visible = rows.filter((row) => !(row.event_status === 'draft' && row.date < todayIso))
    return { status: 'ok', data: visible.map(toVenueCalendarEvent) }
  } catch (error) {
    console.error('Failed to load events for the calendar:', getErrorMessage(error))
    return { status: 'failed', data: [], message: 'Events could not be loaded.' }
  }
}

/**
 * A private hire still in draft when its date has gone was an enquiry that never turned into a
 * booking. Owner decision (27 November 2026): it leaves the calendar like a past draft event;
 * future drafts still show, because they are live enquiries.
 */
function withoutPastDraftHires(
  result: CalendarDataset<CalendarPrivateBooking>,
  todayIso: string,
): CalendarDataset<CalendarPrivateBooking> {
  if (result.status !== 'ok') return result
  return {
    ...result,
    data: result.data.filter((row) => !(row.status === 'draft' && (row.event_date ?? '') < todayIso)),
  }
}

async function readRepeatingNights(startIso: string, endIso: string): Promise<CalendarDataset<RepeatingEventNight>> {
  try {
    const occurrences = await loadSeriesOccurrencesInRange(startIso, endIso, createAdminClient())
    return {
      status: 'ok',
      data: occurrences.map((o) => ({ seriesId: o.seriesId, name: o.name, date: o.date, startTime: o.startTime, endTime: o.endTime })),
    }
  } catch (error) {
    console.error('Failed to load repeating events for the calendar:', getErrorMessage(error))
    return { status: 'failed', data: [], message: 'Repeating events could not be loaded.' }
  }
}

/**
 * Everything on the venue calendar for one month (the whole Monday-to-Sunday grid), whatever
 * happened to it since: completed, cancelled, expired, paid and sent items all come back, so a
 * past month shows what was hosted, booked and sent. Read-only.
 *
 * Each layer checks its own permission and is left empty for a user who may not see it, exactly
 * as the dashboard and /events did before. `month` is YYYY-MM, from 2024 to two years ahead.
 */
export async function getVenueCalendarMonth(input: { month: string }): Promise<{ data?: VenueCalendarMonthData; error?: string }> {
  const window = calendarMonthWindow(input?.month)
  if (!window) return { error: 'Choose a month from 2024 onwards' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const [
    canViewEvents,
    canManageSettings,
    canViewNotes,
    canViewPrivateBookings,
    canViewPricing,
    canViewEmployees,
    canViewParking,
    canViewMarketing,
    canViewCovers,
    canViewRota,
    canViewMessages,
  ] = await Promise.all([
    checkUserPermission('events', 'view', user.id),
    checkUserPermission('settings', 'manage', user.id),
    canViewCalendarNotes(),
    checkUserPermission('private_bookings', 'view', user.id),
    checkUserPermission('private_bookings', 'view_pricing', user.id),
    checkUserPermission('employees', 'view', user.id),
    checkUserPermission('parking', 'view', user.id),
    checkUserPermission('marketing', 'view', user.id),
    checkUserPermission('table_bookings', 'view', user.id),
    checkUserPermission('rota', 'view', user.id),
    checkUserPermission('messages', 'view', user.id),
  ])

  const { startIso, endIso, startInstant, endInstant } = window
  // The admin client only ever runs after the matching permission check above: notes, marketing
  // campaigns, texts and the day load are service-role reads, as they were on both pages before.
  const admin = createAdminClient()

  const [
    events,
    repeating,
    privateBookings,
    balances,
    birthdays,
    specialHours,
    notes,
    parking,
    marketing,
    covers,
    staff,
    texts,
  ] = await Promise.all([
    canViewEvents ? readEvents(startIso, endIso) : Promise.resolve(denied()),
    canViewEvents ? readRepeatingNights(startIso, endIso) : Promise.resolve(denied()),
    canViewPrivateBookings
      ? readPrivateBookingsInRange(supabase, startIso, endIso).then((result) => withoutPastDraftHires(result, getTodayIsoDate()))
      : Promise.resolve(denied()),
    // The marker's subtitle is the amount, so it needs pricing access as well as view.
    canViewPrivateBookings && canViewPricing ? readBalanceDues(supabase, startIso, endIso) : Promise.resolve(denied()),
    canViewEmployees ? readBirthdays(supabase, startIso, endIso) : Promise.resolve(denied()),
    // Same bar as the calendar itself, deliberately not settings:manage alone.
    canViewEvents || canManageSettings ? readSpecialHours(supabase, startIso, endIso) : Promise.resolve(denied()),
    canViewNotes ? readCalendarNotesInRange(admin, startIso, endIso, DEFAULT_CALENDAR_NOTE_COLOUR) : Promise.resolve(denied()),
    canViewParking ? readParkingInRange(supabase, startInstant, endInstant) : Promise.resolve(denied()),
    canViewMarketing ? readMarketingSends(admin, startIso, endIso) : Promise.resolve(denied()),
    canViewCovers ? readCoversByDate(admin, startIso, endIso) : Promise.resolve(denied()),
    canViewRota ? readStaffByDate(supabase, startIso, endIso) : Promise.resolve(denied()),
    canViewMessages ? readTextMessagesByDate(admin, startInstant, endInstant) : Promise.resolve(denied()),
  ])

  const warnings: string[] = []

  const coversByDate: Record<string, number> = {}
  const hireGuestsByDate: Record<string, number> = {}
  for (const row of settle(covers, warnings)) {
    if (row.covers > 0) coversByDate[row.date] = row.covers
    if (row.hireGuests > 0) hireGuestsByDate[row.date] = row.hireGuests
  }
  const staffByDate: Record<string, string[]> = {}
  for (const row of settle(staff, warnings)) staffByDate[row.date] = row.staff

  return {
    data: {
      month: window.month,
      startIso,
      endIso,
      events: settle(events, warnings),
      repeatingEvents: settle(repeating, warnings),
      privateBookings: settle(privateBookings, warnings),
      balanceDueDates: settle(balances, warnings),
      employeeBirthdays: settle(birthdays, warnings),
      specialHours: settle(specialHours, warnings),
      calendarNotes: settle(notes, warnings),
      parkingBookings: settle(parking, warnings),
      marketingSends: settle(marketing, warnings),
      textMessages: settle(texts, warnings),
      dailyOps: { coversByDate, staffByDate, hireGuestsByDate },
      warnings,
    },
  }
}
