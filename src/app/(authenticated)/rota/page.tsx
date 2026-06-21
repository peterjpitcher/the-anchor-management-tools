import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { generateRotaFeedToken } from '@/lib/portal/calendar-token';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageLayout } from '@/ds';
import { LinkButton } from '@/ds';
import { Cog6ToothIcon, DocumentDuplicateIcon, BanknotesIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import RotaFeedButton from './RotaFeedButton';
import {
  getOrCreateRotaWeek,
  getWeekShifts,
  getActiveEmployeesForRota,
  getLeaveDaysForWeek,
  getRotaSummaryForWeek,
  type OpenShiftRequestSummary,
  type RejectedShiftRecord,
  type ShiftAuditTrailEntry,
} from '@/app/actions/rota';
import { getShiftTemplates } from '@/app/actions/rota-templates';
import { getDepartments } from '@/app/actions/budgets';
import { getRotaWeekDayInfo } from '@/app/actions/rota-day-info';
import type { RotaDayInfo } from '@/app/actions/rota-day-info';
import RotaGrid from './RotaGrid';
import RotaPublishStatus from './RotaPublishStatus';
import { rotaNavItems } from './nav';
import type { PublishedShiftSnapshot } from '@/lib/rota/publish-status';

export const dynamic = 'force-dynamic';

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun — use UTC to avoid BST midnight-shift
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00Z'); // Z = UTC, avoids BST off-by-one
  const e = new Date(end + 'T00:00:00Z');
  const startStr = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const endStr = e.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

interface RotaPageProps {
  searchParams: Promise<{ week?: string }>;
}

export default async function RotaPage({ searchParams }: RotaPageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const [
    canView,
    canEdit,
    canPublish,
    canManageSettings,
    canViewLeave,
    canCreateLeave,
    canEditLeave,
  ] = await Promise.all([
    checkUserPermission('rota', 'view', user.id),
    checkUserPermission('rota', 'edit', user.id),
    checkUserPermission('rota', 'publish', user.id),
    checkUserPermission('settings', 'manage', user.id),
    checkUserPermission('leave', 'view', user.id),
    checkUserPermission('leave', 'create', user.id),
    checkUserPermission('leave', 'edit', user.id),
  ]);
  if (!canView) redirect('/');

  const resolvedParams = await Promise.resolve(searchParams ?? {});
  const weekParam = (resolvedParams as { week?: string })?.week;

  // Resolve weekStart to a Monday
  const weekStart = (() => {
    if (weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
      return getMondayOfWeek(new Date(weekParam + 'T00:00:00Z')).toISOString().split('T')[0];
    }
    return getMondayOfWeek(new Date()).toISOString().split('T')[0];
  })();

  // Build Mon–Sun date array — use UTC to avoid BST midnight-shift duplicates
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split('T')[0];
  });

  const weekEnd = days[6];

  const [weekResult, employeesResult, shiftsResult, templatesResult, leaveDaysResult, dayInfoResult, deptResult] =
    await Promise.all([
      getOrCreateRotaWeek(weekStart),
      getActiveEmployeesForRota(weekStart),
      getWeekShifts(weekStart, user.id),
      getShiftTemplates(),
      getLeaveDaysForWeek(weekStart),
      getRotaWeekDayInfo(weekStart, weekEnd),
      getDepartments(),
    ]);

  if (!weekResult.success) {
    return (
      <PageLayout
        title="Rota"
        subtitle="Weekly rota planning"
        navItems={rotaNavItems}
        error={weekResult.error ?? 'Failed to load rota data. Please try again.'}
      />
    );
  }

  if (!shiftsResult.success) {
    return (
      <PageLayout
        title="Rota"
        subtitle="Weekly rota planning"
        navItems={rotaNavItems}
        error={shiftsResult.error ?? 'Failed to load shifts. Please try again.'}
      />
    );
  }

  const week = weekResult.data;
  const employees = employeesResult.success ? employeesResult.data : [];
  const shifts = shiftsResult.data;
  const templates = templatesResult.success ? templatesResult.data.filter(t => t.is_active) : [];
  const leaveDays = leaveDaysResult.success ? leaveDaysResult.data : [];
  const departments = deptResult.success ? deptResult.data : [];
  const dayInfo: Record<string, RotaDayInfo> = dayInfoResult ?? {};
  const summaryResult = await getRotaSummaryForWeek(weekStart, days, employees);
  const rotaSummary = summaryResult.success ? summaryResult.data : null;
  const canViewSpend = summaryResult.success ? summaryResult.canViewSpend : false;
  const canViewSalesTargets = summaryResult.success ? summaryResult.canViewSalesTargets : false;
  const canEditSalesTargets = summaryResult.success ? summaryResult.canEditSalesTargets : false;
  const openShiftIds = shifts.filter(shift => shift.is_open_shift).map(shift => shift.id);
  const { data: openShiftRequestRows } = openShiftIds.length
    ? await supabase
        .from('rota_open_shift_requests')
        .select('id, shift_id, employee_id, note, status, requested_at, employees(first_name, last_name)')
        .in('shift_id', openShiftIds)
        .order('requested_at', { ascending: false })
    : { data: [] };

  type OpenShiftRequestRow = {
    id: string;
    shift_id: string;
    employee_id: string;
    note: string | null;
    status: OpenShiftRequestSummary['status'];
    requested_at: string;
    employees: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null;
  };

  const openShiftRequests: OpenShiftRequestSummary[] = ((openShiftRequestRows ?? []) as OpenShiftRequestRow[]).map((row) => {
    const employeeRow = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    const employeeName = [employeeRow?.first_name, employeeRow?.last_name].filter(Boolean).join(' ') || 'Unknown staff member';
    return {
      id: row.id,
      shift_id: row.shift_id,
      employee_id: row.employee_id,
      employee_name: employeeName,
      note: row.note ?? null,
      status: row.status,
      requested_at: row.requested_at,
    };
  });
  const shiftIds = shifts.map(shift => shift.id);
  const admin = createAdminClient();
  const [{ data: auditRows }, { data: rejectedShiftRows }, { data: publishedShiftRows }] = await Promise.all([
    shiftIds.length
      ? admin
          .from('audit_logs')
          .select('id, created_at, user_email, user_id, operation_type, resource_id, old_values, new_values, additional_info')
          .eq('resource_type', 'rota_shift')
          .eq('operation_status', 'success')
          .in('resource_id', shiftIds)
          .order('created_at', { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] }),
    admin
      .from('rota_shift_rejections')
      .select('id, shift_id, employee_id, week_id, shift_date, start_time, end_time, unpaid_break_minutes, department, notes, is_overnight, name, rejection_note, rejected_at, rejected_by, created_at')
      .gte('shift_date', weekStart)
      .lte('shift_date', weekEnd)
      .order('shift_date', { ascending: true })
      .order('start_time', { ascending: true }),
    week.status === 'published'
      ? admin
          .from('rota_published_shifts')
          .select('id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name')
          .eq('week_id', week.id)
      : Promise.resolve({ data: [] }),
  ]);

  type AuditRow = {
    id: string;
    created_at: string;
    user_email: string | null;
    user_id: string | null;
    operation_type: string;
    resource_id: string | null;
    old_values: Record<string, unknown> | null;
    new_values: Record<string, unknown> | null;
    additional_info: Record<string, unknown> | null;
  };

  const shiftAuditTrail: ShiftAuditTrailEntry[] = ((auditRows ?? []) as AuditRow[])
    .filter(row => Boolean(row.resource_id))
    .map(row => ({
      id: row.id,
      shift_id: row.resource_id!,
      created_at: row.created_at,
      user_email: row.user_email,
      user_id: row.user_id,
      operation_type: row.operation_type,
      old_values: row.old_values,
      new_values: row.new_values,
      additional_info: row.additional_info,
    }));
  const rejectedShifts = (rejectedShiftRows ?? []) as RejectedShiftRecord[];
  const publishedShifts = (publishedShiftRows ?? []) as PublishedShiftSnapshot[];

  // Per-user HMAC token — no global secret reaches the browser
  const feedToken = generateRotaFeedToken(user.id);
  const feedUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/rota/feed?token=${feedToken}&uid=${user.id}`;

  return (
    <PageLayout
      title="Weekly Rota"
      subtitle={formatWeekRange(weekStart, weekEnd)}
      navItems={rotaNavItems}
      headerActions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <RotaPublishStatus week={week} shifts={shifts} publishedShifts={publishedShifts} canPublish={canPublish} />
          <RotaFeedButton feedUrl={feedUrl} showCalendarSync={Boolean(process.env.GOOGLE_CALENDAR_ROTA_ID)} />
          <LinkButton href="/rota/templates" size="sm" variant="secondary" icon={<DocumentDuplicateIcon className="h-4 w-4" />}>
            Templates
          </LinkButton>
          {canManageSettings && (
            <>
              <LinkButton href="/settings/rota" variant="secondary" size="sm" icon={<Cog6ToothIcon className="h-4 w-4" />}>Rota Settings</LinkButton>
              <LinkButton href="/settings/pay-bands" variant="secondary" size="sm" icon={<BanknotesIcon className="h-4 w-4" />}>Pay Bands</LinkButton>
              <LinkButton href="/settings/budgets" variant="secondary" size="sm" icon={<ChartBarIcon className="h-4 w-4" />}>Budgets</LinkButton>
            </>
          )}
        </div>
      }
    >
      <RotaGrid
        key={weekStart}
        week={week}
        shifts={shifts}
        publishedShifts={publishedShifts}
        employees={employees}
        templates={templates}
        leaveDays={leaveDays}
        weekStart={weekStart}
        days={days}
        canEdit={canEdit}
        canViewLeave={canViewLeave}
        canCreateLeave={canCreateLeave}
        canEditLeave={canEditLeave}
        departments={departments}
        dayInfo={dayInfo}
        periodSummary={rotaSummary}
        canViewSpend={canViewSpend}
        canViewSalesTargets={canViewSalesTargets}
        canEditSalesTargets={canEditSalesTargets}
        openShiftRequests={openShiftRequests}
        shiftAuditTrail={shiftAuditTrail}
        rejectedShifts={rejectedShifts}
      />
    </PageLayout>
  );
}
