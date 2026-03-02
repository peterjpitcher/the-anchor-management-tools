import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui-v2/display/Badge';
import { getLeaveRequests, getHolidayUsage } from '@/app/actions/leave';
import { getRotaSettings } from '@/app/actions/rota-settings';
import type { LeaveRequest } from '@/app/actions/leave';

export const dynamic = 'force-dynamic';

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function daysBetween(start: string, end: string): number {
  const ms = new Date(end + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime();
  return Math.round(ms / 86400000) + 1;
}

const STATUS_BADGE: Record<string, 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  declined: 'error',
};

function getHolidayYear(startMonth: number, startDay: number): number {
  const today = new Date();
  const year = today.getFullYear();
  const yearStart = new Date(year, startMonth - 1, startDay);
  return today >= yearStart ? year : year - 1;
}

export default async function MyLeavePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  // Find linked employee record
  const { data: employee } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name')
    .eq('auth_user_id', user.id)
    .single();

  if (!employee) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">My Holiday</h2>
        <p className="text-sm text-gray-500">
          Your account is not linked to an employee profile. Please contact your manager.
        </p>
      </div>
    );
  }

  const rotaSettings = await getRotaSettings();
  const holidayYear = getHolidayYear(rotaSettings.holidayYearStartMonth, rotaSettings.holidayYearStartDay);

  const [requestsResult, usageResult] = await Promise.all([
    getLeaveRequests({ employeeId: employee.employee_id }),
    getHolidayUsage(employee.employee_id, holidayYear),
  ]);

  const requests = requestsResult.success ? requestsResult.data : [];
  const usedDays = usageResult.success ? usageResult.count : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">My Holiday</h2>
        <a
          href="/portal/leave/new"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700"
        >
          Request holiday
        </a>
      </div>

      {/* Days used */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-800">
            {holidayYear}/{String(holidayYear + 1).slice(2)} holiday taken
          </span>
          <span className="font-semibold text-gray-900">
            {usedDays} day{usedDays !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Request list */}
      {requests.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-4 text-center">
          No holiday requests yet. Use the button above to request time off.
        </p>
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">Your requests</h3>
          {requests.map((req: LeaveRequest) => {
            const days = daysBetween(req.start_date, req.end_date);
            return (
              <div key={req.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {formatDate(req.start_date)}
                      {req.start_date !== req.end_date && ` – ${formatDate(req.end_date)}`}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {days} day{days !== 1 ? 's' : ''}
                    </p>
                    {req.note && (
                      <p className="text-xs text-gray-500 italic mt-0.5">&ldquo;{req.note}&rdquo;</p>
                    )}
                  </div>
                  <Badge variant={STATUS_BADGE[req.status] ?? 'default'} size="sm">
                    {req.status}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
