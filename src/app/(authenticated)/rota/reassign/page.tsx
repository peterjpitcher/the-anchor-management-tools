import { redirect } from 'next/navigation';
import { PageLayout } from '@/ds';
import { checkUserPermission } from '@/app/actions/rbac';
import { getReassignmentQueue } from '@/app/actions/rota-reassign';
import { getActiveEmployeesForRota } from '@/app/actions/rota';
import { buildRotaNavItems } from '../nav';
import ReassignQueueClient from './ReassignQueueClient';
import { displayName } from '@/lib/employees/display-name';

export const dynamic = 'force-dynamic';

export default async function RotaReassignPage() {
  const [canView, canEdit, canPublish] = await Promise.all([
    checkUserPermission('rota', 'view'),
    checkUserPermission('rota', 'edit'),
    checkUserPermission('rota', 'publish'),
  ]);
  if (!canView) redirect('/');

  const [queueResult, employeesResult] = await Promise.all([
    getReassignmentQueue(),
    getActiveEmployeesForRota(),
  ]);

  if (!queueResult.success) {
    return (
      <PageLayout
        title="Reassign"
        subtitle="Shifts that still need somebody"
        navItems={buildRotaNavItems(0)}
        error={queueResult.error}
      />
    );
  }

  const queue = queueResult.data;
  const employees = employeesResult.success
    ? employeesResult.data.map(employee => ({
        employee_id: employee.employee_id,
        name: displayName(employee, 'Unknown'),
      }))
    : [];

  const outstanding = queue.openShifts.length;

  return (
    <PageLayout
      title="Reassign"
      subtitle={
        outstanding === 0
          ? 'Every shift is covered'
          : `${outstanding} shift${outstanding === 1 ? '' : 's'} still needs somebody`
      }
      navItems={buildRotaNavItems(outstanding)}
    >
      <ReassignQueueClient
        queue={queue}
        employees={employees}
        canEdit={canEdit}
        canPublish={canPublish}
      />
    </PageLayout>
  );
}
