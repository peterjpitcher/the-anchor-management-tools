import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { PageLayout } from '@/ds';
import { Card } from '@/ds';
import { Section } from '@/ds';
import { getTimeclockSessionsForWeek } from '@/app/actions/timeclock';
import { getActiveEmployeesForRota } from '@/app/actions/rota';
import { ensurePayrollPeriodsAhead, getOrCreatePayrollPeriod } from '@/app/actions/payroll';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { buildPayrollMonthOptions } from '@/lib/rota/payroll-periods';
import TimeclockManager from './TimeclockManager';
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
  const sessions = result.success ? result.data : [];
  const employees = employeesResult.success ? employeesResult.data : [];

  const monthOptions = buildPayrollMonthOptions(defaultPeriod);

  return (
    <PageLayout
      title="Timeclock"
      subtitle="Review and correct clock-in/out times"
      navItems={rotaNavItems}
    >
      <Section
        title="Sessions"
        description="Edit times to correct mistakes or fill in missed clock-outs before payroll is run."
      >
        <Card>
          <TimeclockManager
            key={`${year}-${month}`}
            sessions={sessions}
            employees={employees}
            periodStart={period.period_start}
            periodEnd={period.period_end}
            year={year}
            month={month}
            monthOptions={monthOptions}
          />
        </Card>
      </Section>
    </PageLayout>
  );
}
