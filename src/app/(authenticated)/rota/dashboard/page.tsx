import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDepartmentBudgets } from '@/app/actions/budgets';
import { startOfMonth, endOfMonth, format, differenceInYears, parseISO } from 'date-fns';

const gbpFormatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

export const dynamic = 'force-dynamic';

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function paidHours(start: string, end: string, breakMins: number, overnight: boolean): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (overnight || endM <= startM) endM += 24 * 60;
  return Math.max(0, endM - startM - breakMins) / 60;
}

type Shift = {
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  is_overnight: boolean;
  department: string;
  shift_date: string;
  status: string;
};

type ShiftWithEmployee = Shift & {
  employee_id: string;
};

function sumHours(shifts: Shift[], dept?: string): number {
  return shifts
    .filter(s => s.status !== 'cancelled' && (!dept || s.department === dept))
    .reduce((sum, s) => sum + paidHours(s.start_time, s.end_time, s.unpaid_break_minutes, s.is_overnight), 0);
}

/** Compute total estimated labour cost using the same in-memory rate logic as payroll. */
function computeEstimatedCost(
  shifts: ShiftWithEmployee[],
  salaryEmployeeIds: Set<string>,
  dobMap: Map<string, string>,
  rateOverrides: Array<{ employee_id: string; hourly_rate: string | number; effective_from: string }>,
  ageBands: Array<{ id: string; min_age: number; max_age: number | null }>,
  bandRates: Array<{ band_id: string; hourly_rate: string | number; effective_from: string }>,
  dept?: string,
): number {
  let total = 0;
  for (const s of shifts) {
    if (s.status === 'cancelled') continue;
    if (dept && s.department !== dept) continue;
    if (salaryEmployeeIds.has(s.employee_id)) continue;

    const hours = paidHours(s.start_time, s.end_time, s.unpaid_break_minutes, s.is_overnight);

    // Most-recent override on or before shift date (already sorted DESC)
    const override = rateOverrides.find(
      o => o.employee_id === s.employee_id && o.effective_from <= s.shift_date,
    );
    if (override) {
      total += hours * Number(override.hourly_rate);
      continue;
    }

    const dob = dobMap.get(s.employee_id);
    if (!dob) continue;

    const age = differenceInYears(parseISO(s.shift_date), parseISO(dob));
    const band = ageBands.find(b => age >= b.min_age && (b.max_age === null || age <= b.max_age));
    if (!band) continue;

    const bandRate = bandRates.find(r => r.band_id === band.id && r.effective_from <= s.shift_date);
    if (!bandRate) continue;

    total += hours * Number(bandRate.hourly_rate);
  }
  return total;
}

function BudgetCard({
  dept,
  weekHours,
  monthHours,
  weeklyTarget,
  monthlyTarget,
}: {
  dept: string;
  weekHours: number;
  monthHours: number;
  weeklyTarget: number;
  monthlyTarget: number;
}) {
  const weekPct = weeklyTarget > 0 ? Math.min((weekHours / weeklyTarget) * 100, 120) : 0;
  const monthPct = monthlyTarget > 0 ? Math.min((monthHours / monthlyTarget) * 100, 120) : 0;

  const bar = (pct: number) => (
    pct > 100 ? 'bg-red-400' : pct > 85 ? 'bg-amber-400' : 'bg-green-400'
  );

  return (
    <Card>
      <h3 className="text-base font-semibold text-gray-900 capitalize mb-4">{dept}</h3>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-600">This week</span>
            <span className={`font-medium ${weekPct > 100 ? 'text-red-600' : 'text-gray-900'}`}>
              {weekHours.toFixed(0)}h{weeklyTarget > 0 ? ` / ${weeklyTarget.toFixed(0)}h target` : ''}
            </span>
          </div>
          {weeklyTarget > 0 && (
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${bar(weekPct)}`} style={{ width: `${Math.min(weekPct, 100)}%` }} />
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-600">This month</span>
            <span className={`font-medium ${monthPct > 100 ? 'text-red-600' : 'text-gray-900'}`}>
              {monthHours.toFixed(0)}h{monthlyTarget > 0 ? ` / ${monthlyTarget.toFixed(0)}h target` : ''}
            </span>
          </div>
          {monthlyTarget > 0 && (
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${bar(monthPct)}`} style={{ width: `${Math.min(monthPct, 100)}%` }} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default async function RotaDashboardPage() {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) redirect('/');

  const today = new Date();
  const weekStart = getMondayOfWeek(today).toISOString().split('T')[0];
  const weekEnd = new Date(weekStart + 'T00:00:00');
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const monthStart = format(startOfMonth(today), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(today), 'yyyy-MM-dd');
  const currentYear = today.getFullYear();
  const monthLabel = format(today, 'MMMM yyyy');

  const supabase = await createClient();
  const admin = createAdminClient();

  const [weekShiftsResult, monthShiftsResult, budgetsResult, paySettingsResult, rateOverridesResult, ageBandsResult, bandRatesResult, weekPrivateBookingsResult] = await Promise.all([
    supabase
      .from('rota_shifts')
      .select('employee_id, start_time, end_time, unpaid_break_minutes, is_overnight, department, shift_date, status')
      .gte('shift_date', weekStart)
      .lte('shift_date', weekEndStr),
    supabase
      .from('rota_shifts')
      .select('employee_id, start_time, end_time, unpaid_break_minutes, is_overnight, department, shift_date, status')
      .gte('shift_date', monthStart)
      .lte('shift_date', monthEnd),
    getDepartmentBudgets(currentYear),
    admin.from('employee_pay_settings').select('employee_id, pay_type'),
    admin
      .from('employee_rate_overrides')
      .select('employee_id, hourly_rate, effective_from')
      .order('employee_id')
      .order('effective_from', { ascending: false }),
    admin.from('pay_age_bands').select('id, min_age, max_age').eq('is_active', true),
    admin
      .from('pay_band_rates')
      .select('band_id, hourly_rate, effective_from')
      .order('band_id')
      .order('effective_from', { ascending: false }),
    // B2: Private booking revenue this week (confirmed + completed)
    supabase
      .from('private_bookings')
      .select('total_amount')
      .gte('event_date', weekStart)
      .lte('event_date', weekEndStr)
      .in('status', ['confirmed', 'completed']),
  ]);

  const weekShifts = (weekShiftsResult.data ?? []) as ShiftWithEmployee[];
  const monthShifts = (monthShiftsResult.data ?? []) as ShiftWithEmployee[];
  const budgets = budgetsResult.success ? budgetsResult.data : [];

  // Build in-memory rate lookup data (same approach as payroll page)
  const salaryEmployeeIds = new Set(
    ((paySettingsResult.data ?? []) as Array<{ employee_id: string; pay_type: string }>)
      .filter(s => s.pay_type === 'salaried')
      .map(s => s.employee_id),
  );

  // Fetch DOBs for all unique employee IDs appearing in shifts
  const allEmployeeIds = [
    ...new Set([...weekShifts, ...monthShifts].map(s => s.employee_id).filter(Boolean)),
  ];
  const dobMap = new Map<string, string>();
  if (allEmployeeIds.length > 0) {
    const { data: employees } = await admin
      .from('employees')
      .select('employee_id, date_of_birth')
      .in('employee_id', allEmployeeIds);
    for (const emp of employees ?? []) {
      if (emp.date_of_birth) dobMap.set(emp.employee_id, emp.date_of_birth);
    }
  }

  const rateOverrides = (rateOverridesResult.data ?? []) as Array<{ employee_id: string; hourly_rate: string | number; effective_from: string }>;
  const ageBands = (ageBandsResult.data ?? []) as Array<{ id: string; min_age: number; max_age: number | null }>;
  const bandRates = (bandRatesResult.data ?? []) as Array<{ band_id: string; hourly_rate: string | number; effective_from: string }>;

  const barBudget = budgets.find(b => b.department === 'bar');
  const kitchenBudget = budgets.find(b => b.department === 'kitchen');
  const weeklyTargetBar = barBudget ? barBudget.annual_hours / 52 : 0;
  const weeklyTargetKitchen = kitchenBudget ? kitchenBudget.annual_hours / 52 : 0;
  const monthlyTargetBar = barBudget ? barBudget.annual_hours / 12 : 0;
  const monthlyTargetKitchen = kitchenBudget ? kitchenBudget.annual_hours / 12 : 0;

  // Hours totals
  const weekBarHours = sumHours(weekShifts, 'bar');
  const weekKitchenHours = sumHours(weekShifts, 'kitchen');
  const weekTotalHours = weekBarHours + weekKitchenHours;
  const monthBarHours = sumHours(monthShifts, 'bar');
  const monthKitchenHours = sumHours(monthShifts, 'kitchen');
  const monthTotalHours = monthBarHours + monthKitchenHours;

  // Estimated labour costs
  const weekTotalCost = computeEstimatedCost(weekShifts, salaryEmployeeIds, dobMap, rateOverrides, ageBands, bandRates);
  const monthTotalCost = computeEstimatedCost(monthShifts, salaryEmployeeIds, dobMap, rateOverrides, ageBands, bandRates);

  // B2: Revenue this week from private bookings
  const weekPrivateBookingRevenue = (weekPrivateBookingsResult.data ?? []).reduce(
    (sum, row) => sum + Number((row as { total_amount?: number | null }).total_amount ?? 0),
    0,
  );
  const weekLabourRatioPct =
    weekPrivateBookingRevenue > 0 && weekTotalCost > 0
      ? Math.round((weekTotalCost / weekPrivateBookingRevenue) * 100)
      : null;

  return (
    <PageLayout
      title="Labour Cost Dashboard"
      subtitle={`Week of ${weekStart} · ${monthLabel}`}
      navItems={[
        { label: 'Rota', href: '/rota' },
        { label: 'Leave', href: '/rota/leave' },
        { label: 'Timeclock', href: '/rota/timeclock' },
        { label: 'Labour Costs', href: '/rota/dashboard' },
        { label: 'Payroll', href: '/rota/payroll' },
      ]}
    >
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'This week — scheduled', value: `${weekTotalHours.toFixed(0)}h` },
          { label: 'Est. cost this week', value: weekTotalCost > 0 ? `£${weekTotalCost.toFixed(0)}` : '—' },
          { label: `${monthLabel} to date`, value: `${monthTotalHours.toFixed(0)}h` },
          { label: `Est. cost ${monthLabel}`, value: monthTotalCost > 0 ? `£${monthTotalCost.toFixed(0)}` : '—' },
        ].map(stat => (
          <Card key={stat.label} className="text-center">
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
          </Card>
        ))}
      </div>

      {/* B2: Revenue vs Labour this week */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white px-5 py-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Revenue vs Labour — This Week</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500">Private Booking Revenue</p>
            <p className="text-lg font-bold text-gray-900 mt-0.5">
              {weekPrivateBookingRevenue > 0 ? gbpFormatter.format(weekPrivateBookingRevenue) : '—'}
            </p>
            <p className="text-xs text-gray-400">confirmed &amp; completed bookings</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Est. Labour Cost</p>
            <p className="text-lg font-bold text-gray-900 mt-0.5">
              {weekTotalCost > 0 ? gbpFormatter.format(weekTotalCost) : '—'}
            </p>
            <p className="text-xs text-gray-400">excludes salaried staff</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Labour / Revenue Ratio</p>
            <p className={`text-lg font-bold mt-0.5 ${weekLabourRatioPct != null && weekLabourRatioPct > 40 ? 'text-red-600' : weekLabourRatioPct != null ? 'text-emerald-700' : 'text-gray-400'}`}>
              {weekLabourRatioPct != null ? `${weekLabourRatioPct}%` : '—'}
            </p>
            <p className="text-xs text-gray-400">
              {weekPrivateBookingRevenue === 0 ? 'No private booking revenue this week' : 'labour cost as % of revenue'}
            </p>
          </div>
        </div>
      </div>

      {/* Per-department budget bars */}
      <Section title="Hours vs Budget" description="Scheduled hours compared to annual budget targets. Estimated costs shown above exclude salaried employees and employees with no pay rate configured.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <BudgetCard
            dept="Bar"
            weekHours={weekBarHours}
            monthHours={monthBarHours}
            weeklyTarget={weeklyTargetBar}
            monthlyTarget={monthlyTargetBar}
          />
          <BudgetCard
            dept="Kitchen"
            weekHours={weekKitchenHours}
            monthHours={monthKitchenHours}
            weeklyTarget={weeklyTargetKitchen}
            monthlyTarget={monthlyTargetKitchen}
          />
        </div>
        {budgets.length === 0 && (
          <p className="text-sm text-gray-400 italic mt-2">
            No budget targets set for {currentYear}.{' '}
            <a href="/settings/budgets" className="text-blue-600 hover:text-blue-700">Set targets in Settings.</a>
          </p>
        )}
      </Section>

      {/* Note about payroll */}
      <div className="mt-6 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
        <p className="text-sm text-gray-600">
          For cost-based payroll data including individual rates and planned vs actual hours,{' '}
          <a href="/rota/payroll" className="text-blue-600 hover:text-blue-700 font-medium">open the Payroll page.</a>
        </p>
      </div>
    </PageLayout>
  );
}
