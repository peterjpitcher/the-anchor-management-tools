import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { Alert, PageLayout } from '@/ds';
import { getShiftTemplates } from '@/app/actions/rota-templates';
import { getActiveEmployeesForRota } from '@/app/actions/rota';
import { getDepartments } from '@/app/actions/budgets';
import ShiftTemplatesManager from './ShiftTemplatesManager';
import { PartialLoadAlert } from '../_shared/PartialLoadAlert';
import { rotaNavItems } from '../nav';

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
  const layout = {
    title: 'Shift Templates',
    subtitle: 'Create reusable shift blocks for the rota palette',
    navItems: rotaNavItems,
  };

  // A failed load shows the error under the same header, never an empty list.
  if (!result.success) {
    return (
      <PageLayout {...layout}>
        <Alert tone="danger" title="Could not load shift templates">{result.error}</Alert>
      </PageLayout>
    );
  }
  const employees = employeesResult.success ? employeesResult.data : [];
  const departments = deptResult.success ? deptResult.data : [];

  // ShiftTemplatesManager renders the PageLayout itself: its New Template header action opens
  // the form it holds in state.
  return (
    <ShiftTemplatesManager
      layout={layout}
      notice={
        <PartialLoadAlert
          missing={[
            ...(employeesResult.success ? [] : ['staff list']),
            ...(deptResult.success ? [] : ['departments']),
          ]}
          consequence="the template form may be missing people or departments"
        />
      }
      canEdit={canEdit}
      initialTemplates={templates}
      employees={employees}
      departments={departments}
    />
  );
}
