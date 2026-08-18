import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { Card, PageLayout, Section } from '@/ds';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDepartmentBudgets } from '@/app/actions/budgets';
import { getRotaSettings } from '@/app/actions/rota-settings';
import { deriveBudgetTargets } from '@/lib/rota/budget-utils';
import { countsTowardHours } from '@/lib/rota/shift-counting';
import {
  buildRotaSummary,
  dayOfWeekForIsoDate,
  resolveSalesTargets,
  type RotaCashupActualRow,
  type RotaDaySummaryTotal,
  type RotaRateContext,
  type RotaSummary,
  type RotaSummaryPayrollPeriod,
  type RotaSummaryShift,
} from '@/lib/rota/summary';
import {
  eachIsoDateInRange,
  formatDateInLondon,
  getIsoWeekday,
  getTodayIsoDate,
  shiftIsoDate,
} from '@/lib/dateUtils';
import { rotaNavItems } from '../nav';

const gbpFormatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// This page owns no arithmetic of its own. Hours, estimated cost, premium pay,
// rate resolution and cost coverage all come from `buildRotaSummary`, which is
// the same module the rota grid's summary bar uses. It previously carried its
// own paid-hours function and its own rate resolver; both drifted, and the
// paid-hours copy priced a zero-length absence marker at 24 hours.
// ---------------------------------------------------------------------------

type DashboardShift = RotaSummaryShift & { department: string | null };

type SalesTargetMap = Record<string, Pick<RotaDaySummaryTotal, 'salesTarget' | 'salesTargetSource' | 'salesTargetReason'>>;

/** How much of a total we were actually able to cost. 'hidden' means the viewer
 *  has no payroll permission, so no cost was calculated at all. */
type CostCoverage = 'complete' | 'partial' | 'missing_rate' | 'salaried' | 'none' | 'hidden';

type CostDisplay = {
  value: string;
  note: string | null;
  complete: boolean;
};

/** Monday of the week containing the given YYYY-MM-DD date. Anchored in UTC by
 *  dateUtils, so the result never shifts with the server timezone. */
function getMondayIsoOfWeek(isoDate: string): string {
  const weekday = getIsoWeekday(isoDate); // 1 = Monday, 7 = Sunday
  if (weekday === null) return isoDate;
  return shiftIsoDate(isoDate, 1 - weekday) ?? isoDate;
}

/** Calendar month containing the given YYYY-MM-DD date. Pure arithmetic on the
 *  supplied date, never on the host clock. */
function getMonthRange(isoDate: string): { start: string; end: string; year: number; month: number } {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const prefix = isoDate.slice(0, 7);
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${prefix}-01`,
    end: `${prefix}-${String(lastDay).padStart(2, '0')}`,
    year,
    month,
  };
}

function departmentLabel(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function hiddenSalesTargets(days: string[]): SalesTargetMap {
  return Object.fromEntries(days.map(day => [day, {
    salesTarget: null,
    salesTargetSource: 'hidden' as const,
    salesTargetReason: null,
  }])) as SalesTargetMap;
}

/** The `cashup_target_overrides` table is optional in some environments. */
function isMissingOptionalTargetOverridesRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? '';
  return error.code === '42P01' || error.code === 'PGRST205' || message.includes('cashup_target_overrides');
}

function summariseRange(input: {
  shifts: DashboardShift[];
  days: string[];
  period: RotaSummaryPayrollPeriod;
  salesTargets: SalesTargetMap;
  targetPercent: number;
  rateContext: RotaRateContext | null;
}): RotaSummary {
  return buildRotaSummary({
    site: null,
    payrollPeriod: input.period,
    weekDays: input.days,
    periodShifts: input.shifts,
    // Role totals are not shown on this page, so no employee list is needed.
    // Per-employee cost coverage is still tracked without it.
    employees: [],
    salesTargets: input.salesTargets,
    targetPercent: input.targetPercent,
    rateContext: input.rateContext,
  });
}

function totalHours(summary: RotaSummary, days: string[]): number {
  return days.reduce((sum, day) => sum + (summary.dayTotals[day]?.hours ?? 0), 0);
}

function salariedShiftCount(summary: RotaSummary): number {
  return Object.values(summary.employeeTotals).reduce((sum, total) => sum + total.salariedShiftCount, 0);
}

/**
 * Folds `buildRotaSummary`'s per-employee cost coverage into one label for the
 * whole total. Deliberately stricter than the per-employee rule: a total that
 * leaves out salaried staff is 'partial', because the money it reports is not
 * the money the week actually costs.
 */
function foldCostCoverage(summary: RotaSummary): CostCoverage {
  if (summary.weekTotals.estimatedCost === null) return 'hidden';

  const uncosted = summary.weekTotals.uncostedShiftCount;
  const salaried = salariedShiftCount(summary);
  const anyCosted = Object.values(summary.employeeTotals)
    .some(total => total.costStatus === 'complete' || total.costStatus === 'partial');

  if (!anyCosted && uncosted === 0 && salaried === 0) return 'none';
  if (!anyCosted && uncosted === 0) return 'salaried';
  if (!anyCosted) return 'missing_rate';
  return uncosted > 0 || salaried > 0 ? 'partial' : 'complete';
}

function describeExclusions(uncosted: number, salaried: number): string {
  const parts: string[] = [];
  if (uncosted > 0) parts.push(`${uncosted} shift${uncosted === 1 ? '' : 's'} with no rate or no named employee`);
  if (salaried > 0) parts.push(`${salaried} salaried shift${salaried === 1 ? '' : 's'}`);
  return parts.join(' and ');
}

function coverageNote(coverage: CostCoverage, summary: RotaSummary): string | null {
  switch (coverage) {
    case 'complete':
      return 'Every scheduled shift is costed';
    case 'partial':
      return `Partial: excludes ${describeExclusions(summary.weekTotals.uncostedShiftCount, salariedShiftCount(summary))}`;
    case 'missing_rate':
      return 'No pay rate is configured for any of these shifts';
    case 'salaried':
      return 'Everyone scheduled is salaried, so there is no hourly cost';
    case 'none':
      return 'No scheduled shifts';
    case 'hidden':
      return null;
  }
}

function describeCost(summary: RotaSummary): CostDisplay {
  const coverage = foldCostCoverage(summary);
  if (coverage === 'hidden') return { value: 'Not available', note: null, complete: false };
  if (coverage === 'none') return { value: 'No shifts', note: coverageNote(coverage, summary), complete: false };
  if (coverage === 'missing_rate' || coverage === 'salaried') {
    return { value: 'No costed shifts', note: coverageNote(coverage, summary), complete: false };
  }
  return {
    value: gbpFormatter.format(summary.weekTotals.estimatedCost ?? 0),
    note: coverageNote(coverage, summary),
    complete: coverage === 'complete',
  };
}

/** Names the denominator, so a week built on forecast is not read as a week
 *  built on takings. */
function describeRevenueSource(summary: RotaSummary, days: string[]): string {
  const actualDays = days.filter(day => summary.dayTotals[day]?.salesTargetSource === 'actual').length;
  if (actualDays === days.length) return 'Actual takings, cashed up for every day';
  if (actualDays === 0) return 'Forecast only, no day cashed up yet';
  return `Actual takings for ${actualDays} of ${days.length} days, forecast for the rest`;
}

function BudgetCard({
  name,
  weekHours,
  monthHours,
  targets,
  budgetYear,
  monthLabel,
  cost,
}: {
  name: string;
  weekHours: number;
  monthHours: number;
  targets: { weekly: number; monthly: number } | null;
  budgetYear: number;
  monthLabel: string;
  cost: CostDisplay | null;
}) {
  const weekPct = targets && targets.weekly > 0 ? (weekHours / targets.weekly) * 100 : null;
  const monthPct = targets && targets.monthly > 0 ? (monthHours / targets.monthly) * 100 : null;

  const barColour = (pct: number): string => (
    pct > 100 ? 'bg-danger' : pct > 85 ? 'bg-warning' : 'bg-success'
  );

  const row = (label: string, hours: number, target: number | null, pct: number | null) => (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-text-muted">{label}</span>
        <span className={`font-medium tabular-nums ${pct !== null && pct > 100 ? 'text-danger-fg' : 'text-text'}`}>
          {hours.toFixed(0)}h{target !== null && target > 0 ? ` of ${target.toFixed(0)}h` : ''}
        </span>
      </div>
      {pct !== null && (
        <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${barColour(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <h3 className="text-base font-semibold text-text mb-4">{departmentLabel(name)}</h3>

      <div className="space-y-4">
        {row('This week', weekHours, targets?.weekly ?? null, weekPct)}
        {row(`All of ${monthLabel}`, monthHours, targets?.monthly ?? null, monthPct)}

        {!targets && (
          <p className="text-sm text-text-muted">
            No budget set for {budgetYear}, so there is nothing to compare these hours against.
          </p>
        )}

        {cost && (
          <div className="pt-3 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Est. cost this week</span>
              <span className="font-medium text-text tabular-nums">{cost.value}</span>
            </div>
            {cost.note && <p className="text-xs text-text-subtle mt-1">{cost.note}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}

export default async function RotaDashboardPage() {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) redirect('/');

  // Cost, pay rates and dates of birth are payroll data. Without payroll:view
  // this page shows hours only, and the pay and date-of-birth queries are never
  // issued at all. Takings follow the cashing-up permission, matching
  // getRotaSummaryForWeek.
  const [canViewSpend, canViewTakings] = await Promise.all([
    checkUserPermission('payroll', 'view'),
    checkUserPermission('cashing_up', 'view'),
  ]);

  const today = getTodayIsoDate();
  const weekStart = getMondayIsoOfWeek(today);
  const weekEnd = shiftIsoDate(weekStart, 6) ?? weekStart;
  const weekDays = eachIsoDateInRange(weekStart, weekEnd);

  const month = getMonthRange(today);
  const monthDays = eachIsoDateInRange(month.start, month.end);
  const monthLabel = formatDateInLondon(`${month.start}T12:00:00Z`, { month: 'long', year: 'numeric' });

  const rangeStart = weekStart < month.start ? weekStart : month.start;
  const rangeEnd = weekEnd > month.end ? weekEnd : month.end;

  const supabase = await createClient();

  const [shiftsResult, budgetsResult, settings] = await Promise.all([
    supabase
      .from('rota_shifts')
      .select('employee_id, shift_date, start_time, end_time, unpaid_break_minutes, is_overnight, is_open_shift, status, department, rate_multiplier, rate_override, premium_reason, premium_start_time, premium_end_time')
      .gte('shift_date', rangeStart)
      .lte('shift_date', rangeEnd),
    getDepartmentBudgets(month.year),
    // The wage target threshold is configuration, not pay data, but it is only
    // ever displayed alongside cost, so it is only fetched alongside cost.
    canViewSpend ? getRotaSettings() : Promise.resolve(null),
  ]);

  if (shiftsResult.error) {
    return (
      <PageLayout title="Labour Cost Dashboard" navItems={rotaNavItems}>
        <Card>
          <p className="text-sm text-danger-fg">Could not load the rota: {shiftsResult.error.message}</p>
        </Card>
      </PageLayout>
    );
  }

  const shifts = (shiftsResult.data ?? []) as DashboardShift[];
  const targetPercent = settings?.wageTargetPercent ?? 0;

  // --- Pay rates, only with payroll:view ------------------------------------
  let rateContext: RotaRateContext | null = null;

  if (canViewSpend) {
    const admin = createAdminClient();
    const employeeIds = [
      ...new Set(
        shifts
          .map(shift => shift.employee_id)
          .filter((employeeId): employeeId is string => Boolean(employeeId)),
      ),
    ];

    const [paySettingsResult, rateOverridesResult, ageBandsResult, bandRatesResult, employeesResult] = await Promise.all([
      employeeIds.length
        ? admin.from('employee_pay_settings').select('employee_id, pay_type').in('employee_id', employeeIds)
        : Promise.resolve({ data: [], error: null }),
      employeeIds.length
        ? admin
            .from('employee_rate_overrides')
            .select('employee_id, hourly_rate, effective_from')
            .in('employee_id', employeeIds)
            .order('employee_id')
            .order('effective_from', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      admin.from('pay_age_bands').select('id, min_age, max_age').eq('is_active', true),
      admin
        .from('pay_band_rates')
        .select('band_id, hourly_rate, effective_from')
        .order('band_id')
        .order('effective_from', { ascending: false }),
      employeeIds.length
        ? admin.from('employees').select('employee_id, date_of_birth').in('employee_id', employeeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const paySettings = (paySettingsResult.data ?? []) as Array<{ employee_id: string; pay_type: string }>;
    const employeeDates = (employeesResult.data ?? []) as Array<{ employee_id: string; date_of_birth: string | null }>;

    const dobMap = new Map<string, string>();
    for (const row of employeeDates) {
      if (row.date_of_birth) dobMap.set(row.employee_id, row.date_of_birth);
    }

    rateContext = {
      salaryEmployeeIds: new Set(paySettings.filter(row => row.pay_type === 'salaried').map(row => row.employee_id)),
      dobMap,
      rateOverrides: (rateOverridesResult.data ?? []) as RotaRateContext['rateOverrides'],
      ageBands: (ageBandsResult.data ?? []) as RotaRateContext['ageBands'],
      bandRates: (bandRatesResult.data ?? []) as RotaRateContext['bandRates'],
    };
  }

  // --- Takings for the week, only with cashing_up:view -----------------------
  let weekSalesTargets: SalesTargetMap = hiddenSalesTargets(weekDays);

  if (canViewTakings && weekDays.length > 0) {
    const { data: siteRow } = await supabase.from('sites').select('id').limit(1).maybeSingle();

    if (siteRow?.id) {
      const dayOfWeeks = [...new Set(weekDays.map(dayOfWeekForIsoDate))];
      const [defaultTargetResult, overrideResult, actualResult] = await Promise.all([
        supabase
          .from('cashup_targets')
          .select('day_of_week, target_amount, effective_from')
          .eq('site_id', siteRow.id)
          .in('day_of_week', dayOfWeeks)
          .lte('effective_from', weekEnd)
          .order('effective_from', { ascending: false }),
        supabase
          .from('cashup_target_overrides')
          .select('target_date, target_amount, reason')
          .eq('site_id', siteRow.id)
          .gte('target_date', weekStart)
          .lte('target_date', weekEnd),
        supabase
          .from('cashup_sessions')
          .select('session_date, total_counted_amount, status')
          .eq('site_id', siteRow.id)
          .gte('session_date', weekStart)
          .lte('session_date', weekEnd),
      ]);

      const overridesUsable = !overrideResult.error || isMissingOptionalTargetOverridesRelation(overrideResult.error);

      if (!defaultTargetResult.error && !actualResult.error && overridesUsable) {
        weekSalesTargets = resolveSalesTargets(
          weekDays,
          (defaultTargetResult.data ?? []).map(row => ({
            day_of_week: row.day_of_week,
            target_amount: row.target_amount,
            effective_from: row.effective_from,
          })),
          (overrideResult.error ? [] : (overrideResult.data ?? [])).map(row => ({
            target_date: row.target_date,
            target_amount: row.target_amount,
            reason: row.reason ?? null,
          })),
          (actualResult.data ?? []) as RotaCashupActualRow[],
        );
      }
    }
  }

  // --- Summaries -------------------------------------------------------------
  const weekPeriod: RotaSummaryPayrollPeriod = {
    year: Number(weekStart.slice(0, 4)),
    month: Number(weekStart.slice(5, 7)),
    start: weekStart,
    end: weekEnd,
    label: `Week of ${weekStart}`,
  };
  const monthPeriod: RotaSummaryPayrollPeriod = {
    year: month.year,
    month: month.month,
    start: month.start,
    end: month.end,
    label: monthLabel,
  };
  const monthSalesTargets = hiddenSalesTargets(monthDays);

  const weekSummary = summariseRange({ shifts, days: weekDays, period: weekPeriod, salesTargets: weekSalesTargets, targetPercent, rateContext });
  const monthSummary = summariseRange({ shifts, days: monthDays, period: monthPeriod, salesTargets: monthSalesTargets, targetPercent, rateContext });

  const weekHours = totalHours(weekSummary, weekDays);
  const monthHours = totalHours(monthSummary, monthDays);
  const weekCost = describeCost(weekSummary);
  const monthCost = describeCost(monthSummary);

  // --- Departments -----------------------------------------------------------
  // The union of configured budgets and departments actually present in the
  // data, so a new department appears without a code change and can never be
  // costed while its hours go uncounted.
  const budgets = budgetsResult.success ? budgetsResult.data : [];
  const budgetsUnavailable = !budgetsResult.success;
  const departmentNames = [
    ...new Set([
      ...budgets.map(budget => budget.department),
      ...shifts
        .filter(countsTowardHours)
        .map(shift => shift.department)
        .filter((department): department is string => Boolean(department)),
    ]),
  ].sort((a, b) => a.localeCompare(b));

  const departmentCards = departmentNames.map(name => {
    const departmentShifts = shifts.filter(shift => shift.department === name);
    const week = summariseRange({ shifts: departmentShifts, days: weekDays, period: weekPeriod, salesTargets: weekSalesTargets, targetPercent, rateContext });
    const monthly = summariseRange({ shifts: departmentShifts, days: monthDays, period: monthPeriod, salesTargets: monthSalesTargets, targetPercent, rateContext });
    const budget = budgets.find(row => row.department === name);
    const targets = budget ? deriveBudgetTargets(budget.annual_hours) : null;

    return {
      name,
      weekHours: totalHours(week, weekDays),
      monthHours: totalHours(monthly, monthDays),
      targets: targets ? { weekly: targets.weekly, monthly: targets.monthly } : null,
      cost: canViewSpend ? describeCost(week) : null,
    };
  });

  // --- Labour against takings ------------------------------------------------
  const weekTakings = weekSummary.weekTotals.salesTarget;
  const hasTakings = weekTakings !== null && weekTakings > 0;
  const wagePercent = weekSummary.weekTotals.wagePercent;

  const weekStartLabel = formatDateInLondon(`${weekStart}T12:00:00Z`, { day: 'numeric', month: 'long' });

  const stats: Array<{ label: string; value: string; note: string | null }> = [
    { label: 'Scheduled this week', value: `${weekHours.toFixed(0)}h`, note: 'Monday to Sunday, scheduled shifts only' },
  ];
  if (canViewSpend) {
    stats.push({ label: 'Est. cost this week', value: weekCost.value, note: weekCost.note });
  }
  stats.push({
    label: `Planned, all of ${monthLabel}`,
    value: `${monthHours.toFixed(0)}h`,
    note: 'Whole month, including days still to come',
  });
  if (canViewSpend) {
    stats.push({ label: `Est. cost, all of ${monthLabel}`, value: monthCost.value, note: monthCost.note });
  }

  return (
    <PageLayout
      title="Labour Cost Dashboard"
      subtitle={`Week beginning ${weekStartLabel}, and the whole of ${monthLabel}`}
      navItems={rotaNavItems}
    >
      {/* Headline totals. Hours and cost describe the same shifts: only rows
          with status 'scheduled', across every department. */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 ${canViewSpend ? 'lg:grid-cols-4' : 'lg:grid-cols-2'}`}>
        {stats.map(stat => (
          <Card key={stat.label}>
            <p className="text-2xl font-bold text-text tabular-nums">{stat.value}</p>
            <p className="text-xs text-text-muted mt-1">{stat.label}</p>
            {stat.note && <p className="text-xs text-text-subtle mt-1">{stat.note}</p>}
          </Card>
        ))}
      </div>

      {canViewSpend && (
        <Card className="mb-6">
          <h2 className="text-sm font-semibold text-text mb-3">Labour against takings, this week</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-text-muted">Total takings</p>
              <p className="text-lg font-bold text-text mt-0.5 tabular-nums">
                {!canViewTakings ? 'Not available' : hasTakings ? gbpFormatter.format(weekTakings) : 'No revenue data'}
              </p>
              <p className="text-xs text-text-subtle">
                {!canViewTakings
                  ? 'Takings need cashing up access'
                  : hasTakings
                    ? describeRevenueSource(weekSummary, weekDays)
                    : 'No cash-up and no sales target for this week'}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Est. labour cost</p>
              <p className="text-lg font-bold text-text mt-0.5 tabular-nums">{weekCost.value}</p>
              <p className="text-xs text-text-subtle">{weekCost.note ?? 'Scheduled shifts only'}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Labour as a share of takings</p>
              <p
                className={`text-lg font-bold mt-0.5 tabular-nums ${
                  wagePercent === null
                    ? 'text-text-muted'
                    : wagePercent > targetPercent
                      ? 'text-danger-fg'
                      : 'text-success-fg'
                }`}
              >
                {wagePercent === null ? 'No revenue data' : `${wagePercent.toFixed(0)}%`}
              </p>
              <p className="text-xs text-text-subtle">
                {wagePercent === null
                  ? 'Needs takings or a sales target before a ratio means anything'
                  : `Target is ${targetPercent}% or below${weekCost.complete ? '' : ', on a partial cost'}`}
              </p>
            </div>
          </div>
        </Card>
      )}

      <Section
        title="Hours against budget"
        description={`Scheduled hours per department against the annual budget for ${month.year}. Absence and cancelled rows are shown on the rota but never counted here.`}
      >
        {departmentCards.length === 0 ? (
          <Card>
            <p className="text-sm text-text-muted">No scheduled shifts and no budgets for this period.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {departmentCards.map(card => (
              <BudgetCard
                key={card.name}
                name={card.name}
                weekHours={card.weekHours}
                monthHours={card.monthHours}
                targets={card.targets}
                budgetYear={month.year}
                monthLabel={monthLabel}
                cost={card.cost}
              />
            ))}
          </div>
        )}

        {budgetsUnavailable ? (
          <p className="text-sm text-text-muted mt-3">
            Budget targets are not available to you, so these hours are shown without a comparison.
          </p>
        ) : budgets.length === 0 ? (
          <p className="text-sm text-text-muted mt-3">
            No budget targets set for {month.year}.{' '}
            <a href="/settings/budgets" className="text-primary hover:underline">Set targets in Settings.</a>
          </p>
        ) : null}
      </Section>

      <div className="mt-6 rounded-lg bg-surface-2 border border-border px-4 py-3">
        <p className="text-sm text-text-muted">
          For individual rates and planned against actual hours,{' '}
          <a href="/rota/payroll" className="text-primary font-medium hover:underline">open the Payroll page.</a>
        </p>
      </div>
    </PageLayout>
  );
}
