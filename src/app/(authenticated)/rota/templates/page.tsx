import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { getShiftTemplates } from '@/app/actions/rota-templates';
import { getActiveEmployeesForRota } from '@/app/actions/rota';
import { getDepartments } from '@/app/actions/budgets';
import ShiftTemplatesManager from './ShiftTemplatesManager';

export const dynamic = 'force-dynamic';

export default async function ShiftTemplatesPage() {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) redirect('/');

  const canEdit = await checkUserPermission('rota', 'edit');
  const [result, employeesResult, deptResult] = await Promise.all([
    getShiftTemplates(),
    getActiveEmployeesForRota(),
    getDepartments(),
  ]);
  const templates = result.success ? result.data : [];
  const employees = employeesResult.success ? employeesResult.data : [];
  const departments = deptResult.success ? deptResult.data : [];

  return (
    <PageLayout
      title="Shift Templates"
      subtitle="Create reusable shift blocks for the rota palette"
      navItems={[
        { label: 'Rota', href: '/rota', active: false },
        { label: 'Leave', href: '/rota/leave' },
        { label: 'Timeclock', href: '/rota/timeclock' },
        { label: 'Labour Costs', href: '/rota/dashboard' },
        { label: 'Payroll', href: '/rota/payroll' },
      ]}
    >
      <Section
        title="Templates"
        description="Active templates appear in the drag-and-drop palette when building the weekly rota. Assign a day of the week to auto-populate shifts; assign an employee to pre-assign instead of creating an open shift."
      >
        <Card>
          <ShiftTemplatesManager canEdit={canEdit} initialTemplates={templates} employees={employees} departments={departments} />
        </Card>
      </Section>
    </PageLayout>
  );
}
