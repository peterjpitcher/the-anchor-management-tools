'use server';

import { createClient } from '@/lib/supabase/server';
import { getErrorMessage } from '@/lib/errors';
import { checkUserPermission } from '@/app/actions/rbac';
import { getBusinessHoursForDates } from '@/lib/business-hours/effective';
import { tradingDayInForce } from '@/lib/business-hours/trading-day';
import { eachIsoDateInRange, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils';

export async function getMissingCashupDatesAction(siteId: string, daysBack = 365) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };
  const canView = await checkUserPermission('cashing_up', 'view', user.id);
  if (!canView) return { success: false, error: 'Permission denied' };

  // London dates, not the server's: the serverless runtime is on UTC.
  const now = new Date();
  const todayIso = toLocalIsoDate(now);
  const yesterdayIso = shiftIsoDate(todayIso, -1) as string;
  const fromIso = shiftIsoDate(todayIso, -daysBack) as string;

  try {
    // 1. Get all dates in range
    const allDateStrings = eachIsoDateInRange(fromIso, yesterdayIso);

    // 2. Get existing sessions
    const { data: sessions, error } = await supabase
      .from('cashup_sessions')
      .select('session_date')
      .eq('site_id', siteId)
      .gte('session_date', fromIso)
      .lte('session_date', yesterdayIso);

    if (error) throw error;

    const existingDates = new Set(sessions?.map(s => s.session_date) || []);

    // 3. Batch fetch business hours (replaces per-date isSiteOpen calls, previously up to 728 DB queries).
    //    The weekly side now goes through the version resolver, still in one pass:
    //    loadPublishedVersions is two queries whatever the range, and resolution
    //    happens in memory. Do NOT switch this to a per-date RPC.
    const [specialRes, resolvedHours] = await Promise.all([
      supabase
        .from('special_hours')
        .select('date, opens, closes, is_closed')
        .gte('date', fromIso)
        .lte('date', yesterdayIso),
      getBusinessHoursForDates(allDateStrings, supabase),
    ]);

    // Build lookup maps for in-memory filtering
    const specialMap = new Map<string, boolean>();
    for (const s of specialRes.data ?? []) {
      specialMap.set(s.date, s.is_closed);
    }

    // Yesterday is not missing while it is still trading: from midnight until an after-midnight
    // close (1am on New Year's Eve) the till is still open. Its hours are the special row over the
    // weekly one, field by field, as the booking functions read them.
    const yesterdaySpecial = (specialRes.data ?? []).find(s => s.date === yesterdayIso);
    const yesterdayRegular = resolvedHours.get(yesterdayIso);
    const yesterdayStillTrading = tradingDayInForce(now, {
      today: null,
      yesterday: yesterdaySpecial || yesterdayRegular
        ? {
            opens: yesterdaySpecial?.opens ?? yesterdayRegular?.opens ?? null,
            closes: yesterdaySpecial?.closes ?? yesterdayRegular?.closes ?? null,
            is_closed: yesterdaySpecial?.is_closed ?? yesterdayRegular?.is_closed ?? false,
          }
        : null,
    }).date === yesterdayIso;

    // 4. Filter for open days that are missing (all in-memory, 3 total DB queries for the whole range)
    const missingDates: string[] = [];

    for (const dateStr of allDateStrings) {
      if (existingDates.has(dateStr)) continue;
      if (yesterdayStillTrading && dateStr === yesterdayIso) continue;

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
