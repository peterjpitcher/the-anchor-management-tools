import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { getTimeclockSessionsForWeek } from '@/app/actions/timeclock';
import { getActiveEmployeesForRota } from '@/app/actions/rota';
import TimeclockManager from './TimeclockManager';

export const dynamic = 'force-dynamic';

function getMondayOfWeek(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

interface PageProps {
  searchParams: Promise<{ week?: string }>;
}

export default async function TimeclockPage({ searchParams }: PageProps) {
  const canView = await checkUserPermission('timeclock', 'view');
  if (!canView) redirect('/');

  const params = await searchParams;
  const weekStart = params.week ?? getMondayOfWeek(new Date());
  const weekEndDate = new Date(weekStart + 'T00:00:00');
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEnd = weekEndDate.toISOString().split('T')[0];

  const [result, employeesResult] = await Promise.all([
    getTimeclockSessionsForWeek(weekStart, weekEnd),
    getActiveEmployeesForRota(),
  ]);
  const sessions = result.success ? result.data : [];
  const employees = employeesResult.success ? employeesResult.data : [];

  return (
    <PageLayout
      title="Timeclock"
      subtitle="Review and correct clock-in/out times"
      navItems={[
        { label: 'Rota', href: '/rota', active: false },
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
          <TimeclockManager key={weekStart} sessions={sessions} employees={employees} weekStart={weekStart} weekEnd={weekEnd} />
        </Card>
      </Section>
    </PageLayout>
  );
}
