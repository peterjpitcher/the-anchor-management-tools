import { createClient } from '@/lib/supabase/server';
import { differenceInYears, parseISO } from 'date-fns';

/**
 * Calculates the hourly rate for a given employee on a given shift date.
 *
 * Priority:
 * 1. Employee-specific override (employee_rate_overrides) — latest effective_from <= shiftDate
 * 2. Age-band rate (pay_age_bands + pay_band_rates) — band matched to employee age on shift date
 *
 * Returns null if the employee is salaried, or if no rate can be determined.
 * Callers should surface null rates as data completeness warnings.
 */
export async function getHourlyRate(
  employeeId: string,
  shiftDate: string, // ISO date string e.g. "2026-03-01"
): Promise<{ rate: number; source: 'override' | 'age_band' } | null> {
  const supabase = await createClient();

  // 1. Check pay type
  const { data: paySettings } = await supabase
    .from('employee_pay_settings')
    .select('pay_type')
    .eq('employee_id', employeeId)
    .single();

  if (paySettings?.pay_type === 'salaried') return null;

  // 2. Check for employee-specific override
  const { data: override } = await supabase
    .from('employee_rate_overrides')
    .select('hourly_rate')
    .eq('employee_id', employeeId)
    .lte('effective_from', shiftDate)
    .order('effective_from', { ascending: false })
    .limit(1)
    .single();

  if (override) {
    return { rate: Number(override.hourly_rate), source: 'override' };
  }

  // 3. Determine age on shift date
  const { data: employee } = await supabase
    .from('employees')
    .select('date_of_birth')
    .eq('employee_id', employeeId)
    .single();

  if (!employee?.date_of_birth) return null;

  const ageOnShiftDate = differenceInYears(parseISO(shiftDate), parseISO(employee.date_of_birth));

  // 4. Find matching age band
  const { data: bands } = await supabase
    .from('pay_age_bands')
    .select('id, min_age, max_age')
    .eq('is_active', true);

  const matchingBand = bands?.find(band =>
    ageOnShiftDate >= band.min_age &&
    (band.max_age === null || ageOnShiftDate <= band.max_age),
  );

  if (!matchingBand) return null;

  // 5. Find latest effective rate for the band on or before shift date
  const { data: bandRate } = await supabase
    .from('pay_band_rates')
    .select('hourly_rate')
    .eq('band_id', matchingBand.id)
    .lte('effective_from', shiftDate)
    .order('effective_from', { ascending: false })
    .limit(1)
    .single();

  if (!bandRate) return null;

  return { rate: Number(bandRate.hourly_rate), source: 'age_band' };
}

/**
 * Calculates paid hours from start time, end time, and unpaid break minutes.
 * Handles overnight shifts (end_time < start_time).
 */
export function calculatePaidHours(
  startTime: string, // "HH:mm"
  endTime: string,   // "HH:mm"
  unpaidBreakMinutes: number,
  isOvernight = false,
): number {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  let endMinutes = endH * 60 + endM;

  if (isOvernight || endMinutes < startMinutes) {
    endMinutes += 24 * 60; // add a day for overnight
  }

  const grossMinutes = endMinutes - startMinutes;
  const paidMinutes = Math.max(0, grossMinutes - unpaidBreakMinutes);

  return Math.round((paidMinutes / 60) * 100) / 100; // round to 2dp
}

/**
 * Calculates paid hours from actual clock timestamps.
 * Returns null if either timestamp is missing.
 */
export function calculateActualPaidHours(
  clockInAt: string,  // ISO timestamp
  clockOutAt: string | null,
  unpaidBreakMinutes = 0,
): number | null {
  if (!clockOutAt) return null;

  const durationMs = new Date(clockOutAt).getTime() - new Date(clockInAt).getTime();
  const durationMinutes = durationMs / 1000 / 60;
  const paidMinutes = Math.max(0, durationMinutes - unpaidBreakMinutes);

  return Math.round((paidMinutes / 60) * 100) / 100;
}

export interface RateResolver {
  /** Resolve hourly rate for a specific date. Returns null if no rate found or employee is salaried. */
  resolve: (shiftDate: string) => { rate: number; source: 'override' | 'age_band' } | null;
  /** Whether the employee is salaried (no hourly rate applies) */
  isSalaried: boolean;
  /** Whether the employee has pay_type = 'hourly' (summary card should show) */
  isHourly: boolean;
}

/**
 * Pre-fetches all rate data for an employee and returns a resolver function
 * that can determine the hourly rate for any date without additional DB calls.
 *
 * Use this instead of calling getHourlyRate() in a loop.
 */
export async function getBatchHourlyRates(employeeId: string): Promise<RateResolver> {
  const supabase = await createClient();

  // Fetch employee-specific data and age bands in parallel
  // Note: pay_type default 'hourly' must match the same default in portal/shifts/page.tsx
  const [paySettingsRes, overridesRes, employeeRes, bandsRes] = await Promise.all([
    supabase
      .from('employee_pay_settings')
      .select('pay_type')
      .eq('employee_id', employeeId)
      .single(),
    supabase
      .from('employee_rate_overrides')
      .select('hourly_rate, effective_from')
      .eq('employee_id', employeeId)
      .order('effective_from', { ascending: false }),
    supabase
      .from('employees')
      .select('date_of_birth')
      .eq('employee_id', employeeId)
      .single(),
    supabase
      .from('pay_age_bands')
      .select('id, min_age, max_age')
      .eq('is_active', true),
  ]);

  const payType = paySettingsRes.data?.pay_type ?? 'hourly';
  const isSalaried = payType === 'salaried';
  const isHourly = payType === 'hourly';

  if (isSalaried) {
    return {
      resolve: () => null,
      isSalaried: true,
      isHourly: false,
    };
  }

  const overrides = overridesRes.data ?? [];
  const dob = employeeRes.data?.date_of_birth ?? null;
  const bands = bandsRes.data ?? [];

  // Fetch band rates only for active bands to avoid unbounded table scan
  const bandIds = bands.map(b => b.id);
  const bandRatesByBand: Map<string, Array<{ hourly_rate: number; effective_from: string }>> = new Map();
  if (bandIds.length > 0) {
    const { data: bandRatesData } = await supabase
      .from('pay_band_rates')
      .select('band_id, hourly_rate, effective_from')
      .in('band_id', bandIds)
      .order('effective_from', { ascending: false });

    // Group by band_id for unambiguous per-band lookup
    for (const r of bandRatesData ?? []) {
      const existing = bandRatesByBand.get(r.band_id);
      if (existing) {
        existing.push({ hourly_rate: Number(r.hourly_rate), effective_from: r.effective_from });
      } else {
        bandRatesByBand.set(r.band_id, [{ hourly_rate: Number(r.hourly_rate), effective_from: r.effective_from }]);
      }
    }
  }

  const resolve = (shiftDate: string): { rate: number; source: 'override' | 'age_band' } | null => {
    // 1. Check for employee-specific override
    const override = overrides.find(o => o.effective_from <= shiftDate);
    if (override) {
      return { rate: Number(override.hourly_rate), source: 'override' };
    }

    // 2. Determine age on shift date and find matching band
    if (!dob) return null;

    const ageOnShiftDate = differenceInYears(parseISO(shiftDate), parseISO(dob));

    const matchingBand = bands.find(band =>
      ageOnShiftDate >= band.min_age &&
      (band.max_age === null || ageOnShiftDate <= band.max_age),
    );

    if (!matchingBand) return null;

    // 3. Find latest effective rate for the band on or before shift date
    const rates = bandRatesByBand.get(matchingBand.id);
    if (!rates) return null;

    // Rates are already sorted by effective_from DESC, so first match is most recent
    const bandRate = rates.find(r => r.effective_from <= shiftDate);
    if (!bandRate) return null;

    return { rate: bandRate.hourly_rate, source: 'age_band' };
  };

  return { resolve, isSalaried, isHourly };
}
