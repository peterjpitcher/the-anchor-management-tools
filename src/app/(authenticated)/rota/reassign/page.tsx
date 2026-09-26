import { redirect } from 'next/navigation';
import { PageLayout } from '@/ds';
import { checkUserPermission } from '@/app/actions/rbac';
import { getReassignmentQueue } from '@/app/actions/rota-reassign';
import { getActiveEmployeesForRota } from '@/app/actions/rota';
import { buildRotaNavItems } from '../nav';
import ReassignQueueClient from './ReassignQueueClient';
import { PartialLoadAlert } from '../_shared/PartialLoadAlert';
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

  // One header for every state. The subtitle and the tab badge follow the queue once it loads.
  const layoutProps = { title: 'Reassign' };

  if (!queueResult.success) {
    return (
      <PageLayout
        {...layoutProps}
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
      {...layoutProps}
      subtitle={
        outstanding === 0
          ? 'Every shift is covered'
          : `${outstanding} shift${outstanding === 1 ? '' : 's'} still needs somebody`
      }
      navItems={buildRotaNavItems(outstanding)}
    >
      {/* The staff list only feeds the assign picker, which only editors see. */}
      <PartialLoadAlert
        missing={employeesResult.success || !canEdit ? [] : ['staff list']}
        consequence="nobody can be picked to assign a shift"
      />
      <ReassignQueueClient
        queue={queue}
        employees={employees}
        canEdit={canEdit}
        canPublish={canPublish}
      />
    </PageLayout>
  );
}
