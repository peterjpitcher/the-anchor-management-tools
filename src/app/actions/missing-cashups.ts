'use server';

import { createClient } from '@/lib/supabase/server';
import { eachDayOfInterval, subDays, format } from 'date-fns';
import { getErrorMessage } from '@/lib/errors';

export async function getMissingCashupDatesAction(siteId: string, daysBack = 365) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };
  const today = new Date();
  const fromDate = subDays(today, daysBack);

  try {
    // 1. Get all dates in range
    const allDates = eachDayOfInterval({ start: fromDate, end: subDays(today, 1) });

    // 2. Get existing sessions
    const { data: sessions, error } = await supabase
      .from('cashup_sessions')
      .select('session_date')
      .eq('site_id', siteId)
      .gte('session_date', format(fromDate, 'yyyy-MM-dd'))
      .lte('session_date', format(subDays(today, 1), 'yyyy-MM-dd'));

    if (error) throw error;

    const existingDates = new Set(sessions?.map(s => s.session_date) || []);

    // 3. Batch fetch business hours (replaces per-date isSiteOpen calls — previously up to 728 DB queries)
    const [specialRes, regularRes] = await Promise.all([
      supabase
        .from('special_hours')
        .select('date, is_closed')
        .gte('date', format(fromDate, 'yyyy-MM-dd'))
        .lte('date', format(subDays(today, 1), 'yyyy-MM-dd')),
      supabase
        .from('business_hours')
        .select('day_of_week, is_closed'),
    ]);

    // Build lookup maps for in-memory filtering
    const specialMap = new Map<string, boolean>();
    for (const s of specialRes.data ?? []) {
      specialMap.set(s.date, s.is_closed);
    }

    const regularMap = new Map<number, boolean>();
    for (const r of regularRes.data ?? []) {
      regularMap.set(r.day_of_week, r.is_closed);
    }

    // 4. Filter for open days that are missing (all in-memory, 3 total DB queries for the whole range)
    const missingDates: string[] = [];

    for (const date of allDates) {
      const dateStr = format(date, 'yyyy-MM-dd');

      if (existingDates.has(dateStr)) continue;

      // Special hours override regular hours
      if (specialMap.has(dateStr)) {
        if (!specialMap.get(dateStr)) missingDates.push(dateStr); // not closed = open
      } else {
        const dow = date.getDay();
        const isClosed = regularMap.get(dow) ?? true; // default closed if no config
        if (!isClosed) missingDates.push(dateStr);
      }
    }

    return { success: true, dates: missingDates };

  } catch (error: unknown) {
    console.error('Error checking missing dates:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}
