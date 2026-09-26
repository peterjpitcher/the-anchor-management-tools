import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { Alert, Card, Empty, PageLayout, Section } from '@/ds';
import { createClient } from '@/lib/supabase/server';
import { getLeaveRequests, getHolidayUsage } from '@/app/actions/leave';
import LeaveManagerClient from './LeaveManagerClient';
import { getRotaNavItems } from '../_shared/nav';
import { displayName } from '@/lib/employees/display-name';
import { PartialLoadAlert } from '../_shared/PartialLoadAlert';
import { leaveSubtitle } from '../_shared/layout';

export const dynamic = 'force-dynamic';

export default async function LeaveManagementPage() {
  const [canView, canApprove, canEdit] = await Promise.all([
    checkUserPermission('leave', 'view'),
    checkUserPermission('leave', 'approve'),
    checkUserPermission('leave', 'edit'),
  ]);
  if (!canView) redirect('/');

  const supabase = await createClient();

  // Fetch requests and employees in parallel
  const [requestsResult, { data: employees, error: employeesError }, navItems] = await Promise.all([
    getLeaveRequests(),
    supabase
      .from('employees')
      .select('employee_id, first_name, last_name, preferred_name')
      .order('first_name'),
    getRotaNavItems(),
  ]);

  // A failed load shows the error, never an empty list.
  const requests = requestsResult.success ? requestsResult.data : [];

  // Build name lookup
  const employeeMap: Record<string, string> = {};
  (employees ?? []).forEach((e: { employee_id: string; first_name: string | null; last_name: string | null; preferred_name: string | null }) => {
    employeeMap[e.employee_id] = displayName(e, 'Unknown');
  });

  // Fetch holiday usage for each unique employee+year combination in requests
  const uniquePairs = [
    ...new Map(requests.map(r => [`${r.employee_id}:${r.holiday_year}`, { employeeId: r.employee_id, year: r.holiday_year }])).values(),
  ];
  const usageResults = await Promise.all(
    uniquePairs.map(({ employeeId, year }) => getHolidayUsage(employeeId, year)),
  );
  const usageMap: Record<string, { count: number; allowance: number }> = {};
  uniquePairs.forEach(({ employeeId, year }, i) => {
    const result = usageResults[i];
    if (result?.success) {
      usageMap[`${employeeId}:${year}`] = { count: result.count, allowance: result.allowance };
    }
  });

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <PageLayout
      title="Rota"
      subtitle={leaveSubtitle(pendingCount)}
      navItems={navItems}
    >
      <PartialLoadAlert
        missing={requestsResult.success && employeesError ? ['staff names'] : []}
        consequence="requests may show as Unknown employee"
      />
      <Section
        title="Holiday Requests"
        description="Review and approve employee holiday requests. Approved leave appears as an overlay on the weekly rota."
      >
        {!requestsResult.success ? (
          <Alert tone="danger" title="Could not load leave requests">
            {requestsResult.error}
          </Alert>
        ) : requests.length === 0 ? (
          <Card padding="none">
            <Empty size="sm" icon="calendar" title="No holiday requests yet" />
          </Card>
        ) : (
          <LeaveManagerClient
            initialRequests={requests}
            employeeMap={employeeMap}
            canApprove={canApprove}
            canEdit={canEdit}
            usageMap={usageMap}
          />
        )}
      </Section>
    </PageLayout>
  );
}
