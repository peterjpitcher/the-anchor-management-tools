import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getBusinessHoursForDates } from '@/lib/business-hours/effective';
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

  const specialResult = await supabase
    .from('special_hours')
    .select('date, opens, closes, kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed, note')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  // Opening hours are context, not the rota itself, so a failure here must not
  // take the planner down with it.
  if (specialResult.error) {
    console.error('Failed to load rota opening exceptions:', specialResult.error);
    return {};
  }

  const specialRows = (specialResult.data ?? []) as SpecialHoursRow[];
  if (specialRows.length === 0) return {};

  // Only the dates that actually have an override need a baseline to compare
  // against, and the whole set resolves in two queries rather than one per date.
  let regularForDate: (isoDate: string) => RegularHoursRow | undefined;
  try {
    const resolved = await getBusinessHoursForDates(
      specialRows.map(row => row.date).filter(Boolean),
      supabase,
    );
    regularForDate = isoDate => resolved.get(isoDate) as RegularHoursRow | undefined;
  } catch (error) {
    console.error('Failed to resolve regular hours for rota exceptions:', error);
    return {};
  }

  return buildOpeningExceptions(specialRows, regularForDate);
}
