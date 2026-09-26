import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
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
  const loadError = !result.success
    ? result.error
    : !deptResult.success
      ? deptResult.error
      : null;

  return (
    <BudgetsManager
      canManage={canManage}
      initialBudgets={budgets}
      initialDepartments={departments}
      currentYear={currentYear}
      loadError={loadError}
    />
  );
}
