import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { createClient } from '@/lib/supabase/server';
import { getDepartmentBudgets } from '@/app/actions/budgets';
import { startOfMonth, endOfMonth, format } from 'date-fns';

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

function sumHours(shifts: Shift[], dept?: string): number {
  return shifts
    .filter(s => s.status !== 'cancelled' && (!dept || s.department === dept))
    .reduce((sum, s) => sum + paidHours(s.start_time, s.end_time, s.unpaid_break_minutes, s.is_overnight), 0);
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

  const [weekShiftsResult, monthShiftsResult, budgetsResult] = await Promise.all([
    supabase
      .from('rota_shifts')
      .select('start_time, end_time, unpaid_break_minutes, is_overnight, department, shift_date, status')
      .gte('shift_date', weekStart)
      .lte('shift_date', weekEndStr),
    supabase
      .from('rota_shifts')
      .select('start_time, end_time, unpaid_break_minutes, is_overnight, department, shift_date, status')
      .gte('shift_date', monthStart)
      .lte('shift_date', monthEnd),
    getDepartmentBudgets(currentYear),
  ]);

  const weekShifts = (weekShiftsResult.data ?? []) as Shift[];
  const monthShifts = (monthShiftsResult.data ?? []) as Shift[];
  const budgets = budgetsResult.success ? budgetsResult.data : [];

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

  // Top employees this month by hours
  const empHoursMap: Record<string, { name: string; hours: number }> = {};
  // (Employee names not available here without a join; skip for now)

  return (
    <PageLayout
      title="Labour Cost Dashboard"
      subtitle={`Week of ${weekStart} · ${monthLabel}`}
      navItems={[
        { label: 'Rota', href: '/rota', active: false },
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
          { label: 'Bar this week', value: `${weekBarHours.toFixed(0)}h` },
          { label: 'Kitchen this week', value: `${weekKitchenHours.toFixed(0)}h` },
          { label: `${monthLabel} to date`, value: `${monthTotalHours.toFixed(0)}h` },
        ].map(stat => (
          <Card key={stat.label} className="text-center">
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
          </Card>
        ))}
      </div>

      {/* Per-department budget bars */}
      <Section title="Hours vs Budget" description="Scheduled hours compared to annual budget targets (hours only — no cost calculation).">
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
