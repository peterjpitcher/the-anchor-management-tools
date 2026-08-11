import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildOpeningExceptions,
  type RegularHoursRow,
  type RotaOpeningException,
  type SpecialHoursRow,
} from '@/lib/rota/opening-exceptions';

/**
 * Loads the opening-hours exceptions covering an inclusive date range.
 *
 * Both queries fire together and the whole week is fetched in one go, so the
 * rota page pays for this once rather than once per day. Callers are already
 * behind the rota view permission check, hence the service-role client here.
 */
export async function getRotaOpeningExceptions(
  startDate: string,
  endDate: string,
): Promise<Record<string, RotaOpeningException>> {
  const supabase = createAdminClient();

  const [specialResult, regularResult] = await Promise.all([
    supabase
      .from('special_hours')
      .select('date, opens, closes, kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed, note')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true }),
    supabase
      .from('business_hours')
      .select('day_of_week, opens, closes, kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed'),
  ]);

  // Opening hours are context, not the rota itself, so a failure here must not
  // take the planner down with it.
  if (specialResult.error || regularResult.error) {
    console.error('Failed to load rota opening exceptions:', specialResult.error ?? regularResult.error);
    return {};
  }

  return buildOpeningExceptions(
    (specialResult.data ?? []) as SpecialHoursRow[],
    (regularResult.data ?? []) as RegularHoursRow[],
  );
}
