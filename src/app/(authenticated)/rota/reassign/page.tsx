import { redirect } from 'next/navigation';
import { PageLayout } from '@/ds';
import { checkUserPermission } from '@/app/actions/rbac';
import { getReassignmentQueue } from '@/app/actions/rota-reassign';
import { getActiveEmployeesForRota } from '@/app/actions/rota';
import { getRotaNavItems } from '../_shared/nav';
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

  const [queueResult, employeesResult, navItems] = await Promise.all([
    getReassignmentQueue(),
    getActiveEmployeesForRota(),
    getRotaNavItems(),
  ]);

  // One title and tab row for every state. The subtitle names the tab and follows the queue once
  // it loads.
  const layoutProps = { title: 'Rota', navItems };

  if (!queueResult.success) {
    return (
      <PageLayout
        {...layoutProps}
        subtitle="Reassign: shifts that still need somebody"
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
          ? 'Reassign: every shift is covered'
          : `Reassign: ${outstanding} shift${outstanding === 1 ? '' : 's'} still ${outstanding === 1 ? 'needs' : 'need'} somebody`
      }
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
