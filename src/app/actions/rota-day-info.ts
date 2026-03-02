'use server';

import { createAdminClient } from '@/lib/supabase/admin';

export type RotaDayInfo = {
  date: string;
  events: { name: string; time: string | null }[];
  privateBookings: { customer_name: string; guest_count: number }[];
  tableCovers: number;
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
  const supabase = createAdminClient();

  const [eventsRes, pbRes, tbRes, notesRes] = await Promise.all([
    supabase
      .from('events')
      .select('date, name, time')
      .gte('date', weekStart)
      .lte('date', weekEnd)
      .neq('event_status', 'cancelled')
      .order('time', { ascending: true }),

    supabase
      .from('private_bookings')
      .select('event_date, customer_name, customer_first_name, guest_count, status')
      .gte('event_date', weekStart)
      .lte('event_date', weekEnd)
      .neq('status', 'cancelled'),

    supabase
      .from('table_bookings')
      .select('booking_date, party_size')
      .gte('booking_date', weekStart)
      .lte('booking_date', weekEnd)
      .neq('status', 'cancelled'),

    // Calendar notes that overlap any part of the week
    // (note_date <= weekEnd AND end_date >= weekStart)
    supabase
      .from('calendar_notes')
      .select('note_date, end_date, title, color')
      .lte('note_date', weekEnd)
      .gte('end_date', weekStart)
      .order('note_date', { ascending: true }),
  ]);

  const result: Record<string, RotaDayInfo> = {};

  // Initialise empty entries for each day
  const start = new Date(weekStart + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    result[iso] = { date: iso, events: [], privateBookings: [], tableCovers: 0, calendarNotes: [] };
  }

  for (const e of eventsRes.data ?? []) {
    const iso = e.date as string;
    if (result[iso]) {
      result[iso].events.push({ name: e.name as string, time: e.time as string | null });
    }
  }

  for (const pb of pbRes.data ?? []) {
    const iso = pb.event_date as string;
    if (result[iso]) {
      result[iso].privateBookings.push({
        customer_name: (pb.customer_name || pb.customer_first_name || 'Private booking') as string,
        guest_count: (pb.guest_count ?? 0) as number,
      });
    }
  }

  for (const tb of tbRes.data ?? []) {
    const iso = tb.booking_date as string;
    if (result[iso]) {
      result[iso].tableCovers += (tb.party_size ?? 0) as number;
    }
  }

  // Calendar notes span a range — add to every day they cover within the week
  for (const note of notesRes.data ?? []) {
    const noteStart = note.note_date as string;
    const noteEnd = note.end_date as string;
    for (const iso of Object.keys(result)) {
      if (iso >= noteStart && iso <= noteEnd) {
        result[iso].calendarNotes.push({
          title: note.title as string,
          color: (note.color as string) || '#6366f1',
        });
      }
    }
  }

  return result;
}
