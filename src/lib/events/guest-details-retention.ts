import type { SupabaseClient } from '@supabase/supabase-js'
import { getLocalIsoDateDaysAgo } from '@/lib/dateUtils'
import { fetchAllRows } from '@/lib/supabase/paged-read'

/**
 * How long a ticket's guest answers and phone numbers are kept (BK-017, customer bookings review
 * of 24 October 2026).
 *
 * Owner decision D6: guest phone numbers and answers are deleted 90 days after the event. The
 * answers can be health data (the 20 November tasting night asks every guest about allergies),
 * and a phone on a ticket is someone else's number, so neither is kept for history. Guest names
 * stay, because the booking record needs them.
 *
 * The job ships SWITCHED OFF. EVENT_GUEST_DETAILS_RETENTION decides what it does:
 *   unset or 'dry_run'  reports what it would clear and changes nothing (the default)
 *   'delete'            clears the answers and phones
 *   'off'               does not run at all
 * The owner switches it to 'delete' after seeing a dry run. The first event with stored answers
 * is 20 November 2026, so nothing is due before 18 February 2027.
 */
export const GUEST_DETAILS_RETENTION_DAYS = 90

export type GuestDetailsRetentionMode = 'off' | 'dry_run' | 'delete'

export function resolveGuestDetailsRetentionMode(
  value: string | undefined = process.env.EVENT_GUEST_DETAILS_RETENTION,
): GuestDetailsRetentionMode {
  const normalised = (value ?? '').trim().toLowerCase()
  if (normalised === 'delete') return 'delete'
  if (normalised === 'off') return 'off'
  return 'dry_run'
}

type StoredGuest = Record<string, unknown> & {
  answers?: unknown
  phone?: unknown
}

export type StrippedGuestDetails = {
  attendees: StoredGuest[]
  answersCleared: number
  phonesCleared: number
}

/**
 * The same guests with every answer value blanked and any phone removed. Names, ticket types and
 * the question snapshot stay, so the booking still reads as who came and what they were asked.
 * Pure: the caller decides whether to save it.
 */
export function stripGuestDetails(attendees: unknown, removedAt: string): StrippedGuestDetails {
  let answersCleared = 0
  let phonesCleared = 0
  const guests = Array.isArray(attendees) ? attendees : []

  const stripped = guests.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw as StoredGuest
    const guest = { ...(raw as StoredGuest) }
    let changed = false

    if (Array.isArray(guest.answers)) {
      guest.answers = guest.answers.map((answer) => {
        if (!answer || typeof answer !== 'object') return answer
        const value = (answer as { value?: unknown }).value
        if (typeof value === 'string' && value.trim() === '') return answer
        if (value === undefined || value === null) return answer
        answersCleared += 1
        changed = true
        return { ...(answer as Record<string, unknown>), value: '' }
      })
    }

    if (typeof guest.phone === 'string' ? guest.phone.trim() !== '' : guest.phone != null) {
      phonesCleared += 1
      changed = true
    }
    if ('phone' in guest) delete guest.phone

    if (changed) guest.details_removed_at = removedAt
    return guest
  })

  return { attendees: stripped, answersCleared, phonesCleared }
}

export type GuestDetailsRetentionResult = {
  mode: GuestDetailsRetentionMode
  /** Events on or before this London date are past the 90 days. */
  cutoffDate: string
  eventsChecked: number
  bookingsDue: number
  answersDue: number
  phonesDue: number
  bookingsCleared: number
  bookingsFailed: number
}

const EVENT_ID_CHUNK = 200

/**
 * Finds every booking for an event 90 or more days ago that still holds a guest answer or phone,
 * and, in 'delete' mode only, saves it without them. Counts only in the result: no names, answers
 * or numbers, so the result can go to a log or a cron response.
 */
export async function runEventGuestDetailsRetention(
  supabase: SupabaseClient<any, 'public', any>,
  options: { mode: GuestDetailsRetentionMode; now?: Date } = { mode: 'dry_run' },
): Promise<GuestDetailsRetentionResult> {
  const cutoffDate = getLocalIsoDateDaysAgo(GUEST_DETAILS_RETENTION_DAYS)
  const result: GuestDetailsRetentionResult = {
    mode: options.mode,
    cutoffDate,
    eventsChecked: 0,
    bookingsDue: 0,
    answersDue: 0,
    phonesDue: 0,
    bookingsCleared: 0,
    bookingsFailed: 0,
  }
  if (options.mode === 'off') return result

  const events = await fetchAllRows<{ id: string }>(
    (from, to) => supabase.from('events').select('id').lte('date', cutoffDate).order('id').range(from, to),
    { label: 'guest details retention events' },
  )
  result.eventsChecked = events.length
  const removedAt = (options.now ?? new Date()).toISOString()

  for (let index = 0; index < events.length; index += EVENT_ID_CHUNK) {
    const eventIds = events.slice(index, index + EVENT_ID_CHUNK).map((event) => event.id)
    const bookings = await fetchAllRows<{ id: string; attendees: unknown }>(
      (from, to) => supabase.from('bookings')
        .select('id, attendees')
        .in('event_id', eventIds)
        .eq('is_reminder_only', false)
        .order('id')
        .range(from, to),
      { label: 'guest details retention bookings' },
    )

    for (const booking of bookings) {
      const stripped = stripGuestDetails(booking.attendees, removedAt)
      if (stripped.answersCleared === 0 && stripped.phonesCleared === 0) continue
      result.bookingsDue += 1
      result.answersDue += stripped.answersCleared
      result.phonesDue += stripped.phonesCleared
      if (options.mode !== 'delete') continue

      // Seats are untouched, so guard_booking_attendee_count does not fire; the names are the
      // same, so sync_booking_attendee_names writes the ticket lines back unchanged.
      const { error } = await supabase.from('bookings').update({ attendees: stripped.attendees }).eq('id', booking.id)
      if (error) result.bookingsFailed += 1
      else result.bookingsCleared += 1
    }
  }

  return result
}
