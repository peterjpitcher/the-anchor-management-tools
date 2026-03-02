import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { createClient } from '@/lib/supabase/server';
import { getLeaveRequests, getHolidayUsage } from '@/app/actions/leave';
import LeaveManagerClient from './LeaveManagerClient';

export const dynamic = 'force-dynamic';

export default async function LeaveManagementPage() {
  const [canView, canApprove] = await Promise.all([
    checkUserPermission('leave', 'view'),
    checkUserPermission('leave', 'approve'),
  ]);
  if (!canView) redirect('/');

  const supabase = await createClient();

  // Fetch requests and employees in parallel
  const [requestsResult, { data: employees }] = await Promise.all([
    getLeaveRequests(),
    supabase
      .from('employees')
      .select('employee_id, first_name, last_name')
      .order('first_name'),
  ]);

  const requests = requestsResult.success ? requestsResult.data : [];

  // Build name lookup
  const employeeMap: Record<string, string> = {};
  (employees ?? []).forEach((e: { employee_id: string; first_name: string | null; last_name: string | null }) => {
    const name = [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Unknown';
    employeeMap[e.employee_id] = name;
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
      title="Leave Requests"
      subtitle={pendingCount > 0 ? `${pendingCount} pending approval` : 'All holiday requests'}
      navItems={[
        { label: 'Rota', href: '/rota', active: false },
        { label: 'Leave', href: '/rota/leave' },
        { label: 'Timeclock', href: '/rota/timeclock' },
        { label: 'Labour Costs', href: '/rota/dashboard' },
        { label: 'Payroll', href: '/rota/payroll' },
      ]}
    >
      <Section
        title="Holiday Requests"
        description="Review and approve employee holiday requests. Approved leave appears as an overlay on the weekly rota."
      >
        <Card>
          {requests.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-4 text-center">
              No leave requests submitted yet.
            </p>
          ) : (
            <LeaveManagerClient
              initialRequests={requests}
              employeeMap={employeeMap}
              canApprove={canApprove}
              usageMap={usageMap}
            />
          )}
        </Card>
      </Section>
    </PageLayout>
  );
}
