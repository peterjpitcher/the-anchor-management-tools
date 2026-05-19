import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { PageLayout } from '@/ds';
import { Card } from '@/ds';
import { Section } from '@/ds';
import { getDepartmentBudgets, getDepartments } from '@/app/actions/budgets';
import BudgetsManager from './BudgetsManager';

export const dynamic = 'force-dynamic';

export default async function BudgetsPage() {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) redirect('/');

  const currentYear = new Date().getFullYear();
  const [result, deptResult] = await Promise.all([
    getDepartmentBudgets(),
    getDepartments(),
  ]);
  const budgets = result.success ? result.data : [];
  const departments = deptResult.success ? deptResult.data : [];

  return (
    <PageLayout
      title="Department Budgets"
      subtitle="Annual payroll budgets per department"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <Section
        title="Annual Budgets"
        description="Set an annual payroll budget per department. Monthly and weekly targets are derived automatically."
      >
        <Card>
          <BudgetsManager
            canManage={canManage}
            initialBudgets={budgets}
            initialDepartments={departments}
            currentYear={currentYear}
          />
        </Card>
      </Section>
    </PageLayout>
  );
}
