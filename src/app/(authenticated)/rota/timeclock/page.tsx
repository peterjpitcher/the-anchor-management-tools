import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { getTimeclockSessionsForWeek } from '@/app/actions/timeclock';
import { getActiveEmployeesForRota } from '@/app/actions/rota';
import { getOrCreatePayrollPeriod } from '@/app/actions/payroll';
import TimeclockManager from './TimeclockManager';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ year?: string; month?: string }>;
}

export default async function TimeclockPage({ searchParams }: PageProps) {
  const canView = await checkUserPermission('timeclock', 'view');
  if (!canView) redirect('/');

  const params = await searchParams;
  const today = new Date();
  const year = params.year ? parseInt(params.year) : today.getFullYear();
  const month = params.month ? parseInt(params.month) : today.getMonth() + 1;

  // Fetch the pay period and employees in parallel, then sessions using period dates
  const [period, employeesResult] = await Promise.all([
    getOrCreatePayrollPeriod(year, month),
    getActiveEmployeesForRota(),
  ]);

  const result = await getTimeclockSessionsForWeek(period.period_start, period.period_end);
  const sessions = result.success ? result.data : [];
  const employees = employeesResult.success ? employeesResult.data : [];

  // Build month selector options (current year + last year, newest first)
  const monthOptions: { label: string; value: string }[] = [];
  for (let y = today.getFullYear(); y >= today.getFullYear() - 1; y--) {
    for (let m = 12; m >= 1; m--) {
      const d = new Date(y, m - 1, 1);
      if (d > today) continue;
      monthOptions.push({
        label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
        value: `?year=${y}&month=${m}`,
      });
    }
  }

  return (
    <PageLayout
      title="Timeclock"
      subtitle="Review and correct clock-in/out times"
      navItems={[
        { label: 'Rota', href: '/rota' },
        { label: 'Leave', href: '/rota/leave' },
        { label: 'Timeclock', href: '/rota/timeclock' },
        { label: 'Labour Costs', href: '/rota/dashboard' },
        { label: 'Payroll', href: '/rota/payroll' },
      ]}
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
