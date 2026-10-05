import 'server-only'

import { shiftIsoDate } from '@/lib/dateUtils'

/**
 * Calendar notes on the staff portal.
 *
 * Managers keep two kinds of note on the venue calendar: ones staff should know about (owners
 * away, kitchen closed, clock changes) and ones kept for their own planning. Each note carries
 * a "Show to staff" tick (`calendar_notes.show_to_staff`), and only ticked notes are returned
 * here.
 *
 * Staff cannot read `calendar_notes` themselves: the table's read policy asks for the events
 * view permission, which most portal users do not hold. So the caller passes the service-role
 * client, having already confirmed the visitor is a signed-in, linked employee. To keep that
 * safe, this reads only the title and the dates. The detail text is written for managers and
 * never leaves the database on this path.
 */

/** How far ahead staff always see, even when the pay period on screen ends sooner. */
export const STAFF_NOTES_MIN_DAYS_AHEAD = 28

export interface StaffCalendarNote {
  id: string
  title: string
  /** First day of the note, YYYY-MM-DD. */
  startDate: string
  /** Last day of the note, YYYY-MM-DD. The same as startDate for a one-day note. */
  endDate: string
}

export type StaffCalendarNotesResult =
  | { ok: true; notes: StaffCalendarNote[] }
  | { ok: false }

export interface StaffNotesWindow {
  start: string
  end: string
}

/**
 * The dates the portal lists notes for, given the pay period on screen.
 *
 * Nothing that has already finished is shown, so the window starts today (or at the period
 * start, for a period still to come). It runs to the end of the period, but never less than
 * four weeks ahead: on the last days of a pay period staff would otherwise see almost nothing
 * coming. A period that is wholly in the past has no window at all.
 */
export function staffNotesWindow(
  todayIso: string,
  periodStart: string,
  periodEnd: string,
): StaffNotesWindow | null {
  if (periodEnd < todayIso) return null

  const start = periodStart > todayIso ? periodStart : todayIso
  const minimumEnd = shiftIsoDate(todayIso, STAFF_NOTES_MIN_DAYS_AHEAD)
  const end = minimumEnd && minimumEnd > periodEnd ? minimumEnd : periodEnd

  return { start, end }
}

interface StaffNotesReader {
  // `any` because the service-role client is created without the generated database types, as
  // in src/app/actions/calendar-notes.ts. Every value read from a row is narrowed below.
  from: (table: string) => any
}

/**
 * Notes ticked "Show to staff" that touch any day in the window, soonest first.
 *
 * A note with no end date is a one-day note. 53 of the 121 notes in production had a blank
 * end date until 5 October 2026, and a filter on `end_date` alone silently dropped them. The
 * column is required since that day (migration calendar_notes_end_date_required); the blank
 * case is still handled here so this reader stays right if that is ever relaxed.
 *
 * Returns `{ ok: false }` rather than throwing or returning an empty list when the read
 * fails, so the page can say the notes are missing instead of looking as if there are none.
 */
export async function loadStaffCalendarNotes(
  admin: StaffNotesReader,
  window: StaffNotesWindow,
): Promise<StaffCalendarNotesResult> {
  try {
    const { data, error } = await admin
      .from('calendar_notes')
      .select('id, note_date, end_date, title')
      .eq('show_to_staff', true)
      .lte('note_date', window.end)
      .or(`end_date.gte.${window.start},and(end_date.is.null,note_date.gte.${window.start})`)
      .order('note_date', { ascending: true })
      .order('title', { ascending: true })

    if (error) {
      console.error('Failed to load staff calendar notes:', error)
      return { ok: false }
    }

    const notes: StaffCalendarNote[] = []
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const startDate = typeof row.note_date === 'string' ? row.note_date : null
      const title = typeof row.title === 'string' ? row.title.trim() : ''
      if (!startDate || !title) continue
      notes.push({
        id: String(row.id),
        title,
        startDate,
        endDate: typeof row.end_date === 'string' && row.end_date >= startDate ? row.end_date : startDate,
      })
    }

    return { ok: true, notes }
  } catch (error) {
    console.error('Unexpected error loading staff calendar notes:', error)
    return { ok: false }
  }
}
