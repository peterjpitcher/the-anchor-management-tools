import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Alert, Badge, Card, CardHeader, Empty, LinkButton, Stat, StatGrid } from '@/ds';
import { StandalonePageHeader } from '@/components/shells/StandaloneShell';
import { getLeaveRequests, getHolidayUsage } from '@/app/actions/leave';
import { getRotaSettings } from '@/app/actions/rota-settings';
import type { LeaveRequest } from '@/app/actions/leave';
import { CancelLeaveRequestButton } from './CancelLeaveRequestButton';
import { getHolidayYear } from '@/lib/leave/working-days';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { portalLeaveStatusTone } from '../_shared/status-ui';

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

export default async function MyLeavePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  // Find linked employee record
  const { data: employee } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name')
    .eq('auth_user_id', user.id)
    .in('status', ['Active', 'Started Separation'])
    .single();

  if (!employee) {
    return (
      <>
        <StandalonePageHeader title="My Holiday" />
        <Alert tone="warning">
          Your account is not linked to an employee profile. Please contact your manager.
        </Alert>
      </>
    );
  }

  const rotaSettings = await getRotaSettings();
  const holidayYear = getHolidayYear(getTodayIsoDate(), rotaSettings.holidayYearStartMonth, rotaSettings.holidayYearStartDay);

  const [requestsResult, usageResult] = await Promise.all([
    getLeaveRequests({ employeeId: employee.employee_id }),
    getHolidayUsage(employee.employee_id, holidayYear),
  ]);

  const requests = requestsResult.success ? requestsResult.data : [];
  const usedDays = usageResult.success ? usageResult.count : 0;
  const loadErrors = [
    !requestsResult.success ? requestsResult.error : null,
    !usageResult.success ? usageResult.error : null,
  ].filter(Boolean);

  return (
    <>
      <StandalonePageHeader
        title="My Holiday"
        actions={
          <LinkButton href="/portal/leave/new" variant="primary" size="sm">
            Request Holiday
          </LinkButton>
        }
      />

      {loadErrors.length > 0 && (
        <Alert tone="danger">{loadErrors.join(' ')}</Alert>
      )}

      {/* A failed count shows a dash, never a made-up zero. */}
      <StatGrid columns={2}>
        <Stat
          label={`${holidayYear}/${String(holidayYear + 1).slice(2)} holiday taken`}
          value={usageResult.success ? `${usedDays} day${usedDays !== 1 ? 's' : ''}` : '-'}
        />
      </StatGrid>

      {/* A failed list shows only the error above, never an empty list. */}
      {requestsResult.success && (
        <Card>
          <CardHeader title="Your Requests" />
          {requests.length === 0 ? (
            <Empty
              size="sm"
              title="No holiday requests yet"
              description="Use the button above to request time off."
            />
          ) : (
            <ul className="divide-y divide-border">
              {requests.map((req: LeaveRequest) => {
                const days = daysBetween(req.start_date, req.end_date);
                return (
                  <li key={req.id} className="p-pad-card">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-text">
                          {formatDate(req.start_date)}
                          {req.start_date !== req.end_date && ` – ${formatDate(req.end_date)}`}
                        </p>
                        <p className="text-xs text-text-muted mt-0.5">
                          {days} day{days !== 1 ? 's' : ''}
                        </p>
                        {req.note && (
                          <p className="text-xs text-text-muted italic mt-0.5">&ldquo;{req.note}&rdquo;</p>
                        )}
                      </div>
                      <Badge tone={portalLeaveStatusTone(req.status)} size="sm" className="capitalize">
                        {req.status}
                      </Badge>
                    </div>
                    {req.status === 'pending' && <CancelLeaveRequestButton requestId={req.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
