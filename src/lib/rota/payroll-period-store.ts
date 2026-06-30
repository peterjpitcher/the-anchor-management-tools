import { createAdminClient } from '@/lib/supabase/admin';
import { getTodayIsoDate } from '@/lib/dateUtils';
import {
  addPayrollMonths,
  getDefaultPayrollPeriodDates,
  getPayrollMonthForIsoDate,
  PAYROLL_PERIOD_FUTURE_MONTHS,
} from '@/lib/rota/payroll-periods';

export type PayrollPeriodRecord = {
  id: string;
  year: number;
  month: number;
  period_start: string;
  period_end: string;
};

export async function getOrCreatePayrollPeriodRecord(year: number, month: number): Promise<PayrollPeriodRecord> {
  const supabase = createAdminClient();

  // Fast path: the period almost always already exists (and callers fan this out for
  // several months on every rota page render + cron). Select first so an existing
  // period does not attempt a guaranteed-failing INSERT, which logged a unique-constraint
  // violation on every call.
  const { data: existing } = await supabase
    .from('payroll_periods')
    .select('id, year, month, period_start, period_end')
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  if (existing) return existing as PayrollPeriodRecord;

  const { period_start, period_end } = getDefaultPayrollPeriodDates(year, month);

  const { data: created, error: insertError } = await supabase
    .from('payroll_periods')
    .insert({ year, month, period_start, period_end })
    .select('id, year, month, period_start, period_end')
    .single();

  if (!insertError) return created as PayrollPeriodRecord;

  // Lost a genuine first-creation race — the row now exists, so re-select it.
  if (insertError.code === '23505') {
    const { data: raced, error: selectError } = await supabase
      .from('payroll_periods')
      .select('id, year, month, period_start, period_end')
      .eq('year', year)
      .eq('month', month)
      .single();

    if (selectError || !raced) throw new Error(selectError?.message ?? 'Failed to fetch existing payroll period');
    return raced as PayrollPeriodRecord;
  }

  throw new Error(insertError.message);
}

export async function getOrCreatePayrollPeriodForDateRecord(anchorDateIso: string = getTodayIsoDate()): Promise<PayrollPeriodRecord> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('payroll_periods')
    .select('id, year, month, period_start, period_end')
    .lte('period_start', anchorDateIso)
    .gte('period_end', anchorDateIso)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return data as PayrollPeriodRecord;

  const { year, month } = getPayrollMonthForIsoDate(anchorDateIso);
  return getOrCreatePayrollPeriodRecord(year, month);
}

export async function ensurePayrollPeriodsAheadRecords(
  anchorDateIso: string = getTodayIsoDate(),
  futureMonths: number = PAYROLL_PERIOD_FUTURE_MONTHS,
): Promise<PayrollPeriodRecord[]> {
  const currentPeriod = await getOrCreatePayrollPeriodForDateRecord(anchorDateIso);
  const futurePeriods = await Promise.all(
    Array.from({ length: futureMonths }, (_, index) => {
      const { year, month } = addPayrollMonths(currentPeriod, index + 1);
      return getOrCreatePayrollPeriodRecord(year, month);
    }),
  );

  return [currentPeriod, ...futurePeriods];
}
