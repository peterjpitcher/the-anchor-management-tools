'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { eachIsoDateInRange, isValidIsoDate } from '@/lib/dateUtils';
import { DEFAULT_CALENDAR_NOTE_COLOUR } from '@/lib/rota/shift-template-colours';
import { logger } from '@/lib/logger';
import { loadDayLoads, type DayLoad } from '@/services/day-load';

export type RotaDayInfo = {
  date: string;
  events: { name: string; time: string | null }[];
  privateBookings: { customer_name: string; guest_count: number }[];
  /** Diners plus event tickets, as every screen counts them (BK-075). */
  tableCovers: number;
  highChairs: number;
  outsideCovers: number;
  calendarNotes: { title: string; color: string }[];
};

/**
 * Fetches events, private bookings, and table booking cover counts for a
 * range of dates, returned as a map keyed by ISO date string.
 */
export async function getRotaWeekDayInfo(
  weekStart: string,
  weekEnd: string,
): Promise<Record<string, RotaDayInfo>> {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return {};
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return {};

  // weekStart is written into a filter string below, and a server action can be
  // called with any value, so anything that is not a real date stops here.
  if (!isValidIsoDate(weekStart) || !isValidIsoDate(weekEnd)) return {};

  const supabase = createAdminClient();

  const [eventsRes, dayLoads, notesRes] = await Promise.all([
    supabase
      .from('events')
      .select('date, name, time')
      .gte('date', weekStart)
      .lte('date', weekEnd)
      .neq('event_status', 'cancelled')
      .order('time', { ascending: true }),

    // Covers and private hires counted as every other screen counts them (BK-075). The rota used
    // to count no-shows and every event table, and none of the shared-seating or general
    // admission tickets.
    loadDayLoads(weekStart, weekEnd, { db: supabase, withHours: false }).catch((error: unknown) => {
      logger.error('Could not load covers and private hires for the rota', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { weekStart, weekEnd },
      });
      return new Map<string, DayLoad>();
    }),

    // Calendar notes that overlap any part of the week. end_date is nullable and
    // a note without one lasts a single day. `end_date >= weekStart` is never
    // true for a NULL, so those notes get their own arm:
    // note_date <= weekEnd AND
    //   (end_date >= weekStart OR (end_date IS NULL AND note_date >= weekStart))
    supabase
      .from('calendar_notes')
      .select('note_date, end_date, title, color')
      .lte('note_date', weekEnd)
      .or(`end_date.gte.${weekStart},and(end_date.is.null,note_date.gte.${weekStart})`)
      .order('note_date', { ascending: true }),
  ]);

  const result: Record<string, RotaDayInfo> = {};

  // Initialise empty entries for each day in the range. The dates are plain
  // calendar dates, so they are stepped without a clock: local midnight read
  // back as UTC lands a day early on a machine running on British Summer Time.
  for (const iso of eachIsoDateInRange(weekStart, weekEnd)) {
    result[iso] = { date: iso, events: [], privateBookings: [], tableCovers: 0, highChairs: 0, outsideCovers: 0, calendarNotes: [] };
  }

  for (const e of eventsRes.data ?? []) {
    const iso = e.date as string;
    if (result[iso]) {
      result[iso].events.push({ name: e.name as string, time: e.time as string | null });
    }
  }

  for (const load of dayLoads.values()) {
    const day = result[load.date];
    if (!day) continue;
    day.privateBookings = load.privateHires.map((hire) => ({
      customer_name: hire.customerName,
      guest_count: hire.guestCount ?? 0,
    }));
    day.tableCovers = load.covers;
    day.highChairs = load.diners.highChairs;
    day.outsideCovers = load.diners.outside;
  }

  // Calendar notes span a range: add to every day they cover within the week.
  // A note with no end_date covers its note_date only.
  for (const note of notesRes.data ?? []) {
    const noteStart = note.note_date as string;
    const noteEnd = (note.end_date as string | null) || noteStart;
    for (const iso of Object.keys(result)) {
      if (iso >= noteStart && iso <= noteEnd) {
        result[iso].calendarNotes.push({
          title: note.title as string,
          color: (note.color as string) || DEFAULT_CALENDAR_NOTE_COLOUR,
        });
      }
    }
  }

  return result;
}
