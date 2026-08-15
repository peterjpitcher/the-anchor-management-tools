'use server';

import { createClient } from '@/lib/supabase/server';
import { eachDayOfInterval, subDays, format } from 'date-fns';
import { getErrorMessage } from '@/lib/errors';
import { checkUserPermission } from '@/app/actions/rbac';
import { getBusinessHoursForDates } from '@/lib/business-hours/effective';

export async function getMissingCashupDatesAction(siteId: string, daysBack = 365) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };
  const canView = await checkUserPermission('cashing_up', 'view', user.id);
  if (!canView) return { success: false, error: 'Permission denied' };

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

    // 3. Batch fetch business hours (replaces per-date isSiteOpen calls, previously up to 728 DB queries).
    //    The weekly side now goes through the version resolver, still in one pass:
    //    loadPublishedVersions is two queries whatever the range, and resolution
    //    happens in memory. Do NOT switch this to a per-date RPC.
    const allDateStrings = allDates.map(d => format(d, 'yyyy-MM-dd'));
    const [specialRes, resolvedHours] = await Promise.all([
      supabase
        .from('special_hours')
        .select('date, is_closed')
        .gte('date', format(fromDate, 'yyyy-MM-dd'))
        .lte('date', format(subDays(today, 1), 'yyyy-MM-dd')),
      getBusinessHoursForDates(allDateStrings, supabase),
    ]);

    // Build lookup maps for in-memory filtering
    const specialMap = new Map<string, boolean>();
    for (const s of specialRes.data ?? []) {
      specialMap.set(s.date, s.is_closed);
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
        // Default closed when no version covers the date, so a gap in the hours
        // never invents a missing cashup.
        const isClosed = resolvedHours.get(dateStr)?.is_closed ?? true;
        if (!isClosed) missingDates.push(dateStr);
      }
    }

    return { success: true, dates: missingDates };

  } catch (error: unknown) {
    console.error('Error checking missing dates:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}
