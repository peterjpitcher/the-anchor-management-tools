import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { Alert, PageLayout } from '@/ds';
import { getTimeclockSessionsForWeek } from '@/app/actions/timeclock';
import { getActiveEmployeesForRota } from '@/app/actions/rota';
import { ensurePayrollPeriodsAhead, getOrCreatePayrollPeriod } from '@/app/actions/payroll';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { buildPayrollMonthOptions } from '@/lib/rota/payroll-periods';
import TimeclockManager from './TimeclockManager';
import { PartialLoadAlert } from '../_shared/PartialLoadAlert';
import { rotaNavItems } from '../nav';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ year?: string; month?: string }>;
}

export default async function TimeclockPage({ searchParams }: PageProps) {
  const canView = await checkUserPermission('timeclock', 'view');
  if (!canView) redirect('/');

  const params = await searchParams;
  const todayIso = getTodayIsoDate();
  const availablePeriods = await ensurePayrollPeriodsAhead(todayIso);
  const defaultPeriod = availablePeriods[0];
  const year = params.year ? parseInt(params.year) : defaultPeriod.year;
  const month = params.month ? parseInt(params.month) : defaultPeriod.month;

  // Fetch the pay period and employees in parallel, then sessions using period dates
  const [period, employeesResult] = await Promise.all([
    availablePeriods.find(availablePeriod => availablePeriod.year === year && availablePeriod.month === month)
      ?? getOrCreatePayrollPeriod(year, month),
    getActiveEmployeesForRota(),
  ]);

  const result = await getTimeclockSessionsForWeek(period.period_start, period.period_end);
  const employees = employeesResult.success ? employeesResult.data : [];

  const layout = {
    title: 'Timeclock',
    subtitle: 'Review and correct clock-in/out times',
    navItems: rotaNavItems,
  };

  // A failed load shows the error under the same header, never an empty list.
  if (!result.success) {
    return (
      <PageLayout {...layout}>
        <Alert tone="danger" title="Could not load timeclock sessions">{result.error}</Alert>
      </PageLayout>
    );
  }

  // A viewer holding only `payroll:approve` (not `timeclock:edit`) is a
  // D6-sanctioned editor of timeclock sessions. Pass the flag so the server
  // actions let them through; the actions still re-verify the permission
  // server-side, so this never weakens the gate.
  const allowPayrollApprove = await checkUserPermission('payroll', 'approve');

  const monthOptions = buildPayrollMonthOptions(defaultPeriod);

  // TimeclockManager renders the PageLayout itself: its Add Entry header action opens the form
  // it holds in state.
  return (
    <TimeclockManager
      key={`${year}-${month}`}
      layout={layout}
      notice={
        <PartialLoadAlert
          missing={employeesResult.success ? [] : ['staff list']}
          consequence="nobody can be picked in a manual entry"
        />
      }
      sessions={result.data}
      employees={employees}
      periodStart={period.period_start}
      periodEnd={period.period_end}
      year={year}
      month={month}
      monthOptions={monthOptions}
      allowPayrollApprove={allowPayrollApprove}
    />
  );
}
