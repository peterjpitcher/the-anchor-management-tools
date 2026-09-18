'use server';

import { createClient } from '@/lib/supabase/server';
import { getErrorMessage } from '@/lib/errors';
import { checkUserPermission } from '@/app/actions/rbac';
import { findMissingCashupDates } from '@/lib/cashing-up/trading-days';
import { shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils';

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
    // Trading days come from special hours over the published weekly hours, resolved for the
    // whole range in a handful of queries (src/lib/cashing-up/trading-days.ts). Do NOT switch
    // this to a per-date RPC. Any cash-up counts as entered, voided or not: a voided day
    // cannot be entered again, so it must not sit in the missing list.
    const dates = await findMissingCashupDates(supabase, { siteId, from: fromIso, to: yesterdayIso, now });
    return { success: true, dates };
  } catch (error: unknown) {
    console.error('Error checking missing dates:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}
