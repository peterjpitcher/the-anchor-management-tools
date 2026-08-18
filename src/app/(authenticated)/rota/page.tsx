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
import { buildRotaNavItems } from './nav';
import { getUnfilledShiftCount } from '@/app/actions/rota-reassign';
import { getRotaOpeningExceptions } from '@/lib/rota/opening-exceptions-query';
import type { PublishedShiftSnapshot, RotaPublishShift } from '@/lib/rota/publish-status';
import { readinessWeekFromRow, summariseRotaReadiness } from '@/lib/rota/week-readiness';
import { getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils';
import { displayName } from '@/lib/employees/display-name';

export const dynamic = 'force-dynamic';

const AUDIT_EMPLOYEE_REFERENCE_FIELDS = new Set(['employee_id', 'acceptance_decided_by']);

/**
 * Monday of the week containing the given YYYY-MM-DD date. The arithmetic is done
 * in UTC on a plain date, so it never shifts with the server timezone. The date
 * itself must always come from `getTodayIsoDate()`, which reads the London day:
 * deriving it from `new Date()` opened the previous week for the first hour of
 * every Monday in British Summer Time, and the pub trades past midnight.
 */
function getMondayIsoOfWeek(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

/**
 * How far ahead publishing is judged for the section-nav badge. Four weeks is the
 * pub's planning horizon: far enough to catch a week left in draft behind a week
 * that has already gone out, near enough that a rota nobody has started yet does
 * not sit there as permanent noise.
 */
const READINESS_HORIZON_WEEKS = 4;

const READINESS_LIVE_SHIFT_COLUMNS =
  'id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, reassignment_reason';

const READINESS_PUBLISHED_SHIFT_COLUMNS =
  'id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name';

type ReadinessPublishedRow = PublishedShiftSnapshot & { week_id: string };

/**
 * Weeks inside the horizon carrying shifts staff cannot see yet, for the Rota nav
 * badge. It diffs live shifts against the published snapshot through the shared
 * readiness model rather than trusting `has_unpublished_changes`, which is written
 * in a second unchecked call and is blind to a draft or missing week.
 *
 * The badge counts only weeks with unseen or ghost shifts, not every week that is
 * not yet published: an empty future week is not work anybody can clear, and the
 * badge has to mean the same thing as the Reassign one.
 */
async function countWeeksNeedingPublishing(
  admin: ReturnType<typeof createAdminClient>,
  firstWeekStart: string,
): Promise<number> {
  const weekStarts = Array.from({ length: READINESS_HORIZON_WEEKS }, (_, index) =>
    shiftIsoDate(firstWeekStart, index * 7),
  ).filter((value): value is string => Boolean(value));
  if (weekStarts.length === 0) return 0;

  const lastWeekStart = weekStarts[weekStarts.length - 1];
  const horizonEnd = shiftIsoDate(lastWeekStart, 6) ?? lastWeekStart;

  const [weeksQuery, liveShiftsQuery] = await Promise.all([
    admin
      .from('rota_weeks')
      .select('id, week_start, status, published_at')
      .gte('week_start', weekStarts[0])
      .lte('week_start', lastWeekStart),
    admin
      .from('rota_shifts')
      .select(READINESS_LIVE_SHIFT_COLUMNS)
      .gte('shift_date', weekStarts[0])
      .lte('shift_date', horizonEnd),
  ]);

  // A badge is not a place to fail visibly, so a broken read shows nothing and
  // says so in the logs. The Sunday manager alert is what has to shout.
  if (weeksQuery.error || liveShiftsQuery.error) {
    console.error(
      '[rota] Could not work out which weeks still need publishing:',
      weeksQuery.error?.message ?? liveShiftsQuery.error?.message,
    );
    return 0;
  }

  const weekRows = (weeksQuery.data ?? []) as { id: string; week_start: string; status: string | null; published_at: string | null }[];
  const weekIds = weekRows.map(row => row.id);

  let publishedRows: ReadinessPublishedRow[] = [];
  if (weekIds.length > 0) {
    const publishedQuery = await admin
      .from('rota_published_shifts')
      .select(READINESS_PUBLISHED_SHIFT_COLUMNS)
      .in('week_id', weekIds);
    if (publishedQuery.error) {
      console.error('[rota] Could not read the published rota snapshot:', publishedQuery.error.message);
      return 0;
    }
    publishedRows = (publishedQuery.data ?? []) as ReadinessPublishedRow[];
  }

  const weekRowByStart = new Map(weekRows.map(row => [row.week_start, row]));
  const weekStartById = new Map(weekRows.map(row => [row.id, row.week_start]));

  const liveByWeek = new Map<string, RotaPublishShift[]>();
  ((liveShiftsQuery.data ?? []) as RotaPublishShift[]).forEach(shift => {
    const key = getMondayIsoOfWeek(shift.shift_date);
    const bucket = liveByWeek.get(key);
    if (bucket) bucket.push(shift);
    else liveByWeek.set(key, [shift]);
  });

  const publishedByWeek = new Map<string, PublishedShiftSnapshot[]>();
  publishedRows.forEach(({ week_id: weekId, ...snapshot }) => {
    const key = weekStartById.get(weekId);
    if (!key) return;
    const bucket = publishedByWeek.get(key);
    if (bucket) bucket.push(snapshot);
    else publishedByWeek.set(key, [snapshot]);
  });

  const summary = summariseRotaReadiness(
    weekStarts.map(startDate => ({
      week: readinessWeekFromRow(startDate, weekRowByStart.get(startDate) ?? null),
      liveShifts: liveByWeek.get(startDate) ?? [],
      publishedShifts: publishedByWeek.get(startDate) ?? [],
    })),
    READINESS_HORIZON_WEEKS,
  );

  return summary.byWeek.filter(readiness => readiness.unpublishedCount > 0 || readiness.removedCount > 0).length;
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00Z'); // Z = UTC, avoids BST off-by-one
  const e = new Date(end + 'T00:00:00Z');
  const startStr = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const endStr = e.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

type EmployeeNameRow = { first_name: string | null; last_name: string | null; preferred_name: string | null };

function employeeDisplayName(employee: { first_name: string | null; last_name: string | null; preferred_name?: string | null }): string {
  return displayName(employee, 'Unknown staff member');
}

function collectAuditEmployeeIds(row: {
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}): string[] {
  const ids: string[] = [];
  [row.old_values, row.new_values].forEach(values => {
    if (!values) return;
    AUDIT_EMPLOYEE_REFERENCE_FIELDS.forEach(field => {
      const value = values[field];
      if (typeof value === 'string' && value.length > 0) ids.push(value);
    });
  });
  return ids;
}

interface RotaPageProps {
  searchParams: Promise<{ week?: string; shift?: string }>;
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
    canViewTimeclock,
    canViewPayroll,
  ] = await Promise.all([
    checkUserPermission('rota', 'view', user.id),
    checkUserPermission('rota', 'edit', user.id),
    checkUserPermission('rota', 'publish', user.id),
    checkUserPermission('settings', 'manage', user.id),
    checkUserPermission('leave', 'view', user.id),
    checkUserPermission('leave', 'create', user.id),
    checkUserPermission('leave', 'edit', user.id),
    // Only needed to decide whether those tabs are worth showing: both pages
    // redirect to `/` without their own permission.
    checkUserPermission('timeclock', 'view', user.id),
    checkUserPermission('payroll', 'view', user.id),
  ]);
  if (!canView) redirect('/');

  const navPermissions = { canViewLeave, canViewTimeclock, canViewPayroll, canManageSettings };

  const resolvedParams = await Promise.resolve(searchParams ?? {});
  const weekParam = (resolvedParams as { week?: string })?.week;
  const selectedShiftId = (resolvedParams as { shift?: string })?.shift;

  // Resolve weekStart to a Monday, defaulting to the London today rather than the
  // server's UTC instant.
  const weekStart = getMondayIsoOfWeek(
    weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekParam : getTodayIsoDate(),
  );

  // Build Mon–Sun date array, in UTC to avoid BST midnight-shift duplicates
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split('T')[0];
  });

  const weekEnd = days[6];

  const [
    weekResult,
    employeesResult,
    shiftsResult,
    templatesResult,
    leaveDaysResult,
    dayInfoResult,
    deptResult,
    openingExceptions,
  ] = await Promise.all([
    getOrCreateRotaWeek(weekStart),
    getActiveEmployeesForRota(weekStart),
    getWeekShifts(weekStart, user.id),
    getShiftTemplates(),
    getLeaveDaysForWeek(weekStart),
    getRotaWeekDayInfo(weekStart, weekEnd),
    getDepartments(),
    // Opening-hours exceptions for the whole displayed week, fetched alongside
    // everything else rather than per day.
    getRotaOpeningExceptions(weekStart, weekEnd),
  ]);

  if (!weekResult.success) {
    return (
      <PageLayout
        title="Rota"
        subtitle="Weekly rota planning"
        navItems={buildRotaNavItems(0, navPermissions)}
        error={weekResult.error ?? 'Failed to load rota data. Please try again.'}
      />
    );
  }

  if (!shiftsResult.success) {
    return (
      <PageLayout
        title="Rota"
        subtitle="Weekly rota planning"
        navItems={buildRotaNavItems(0, navPermissions)}
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
        .select('id, shift_id, employee_id, note, status, requested_at, employees(first_name, last_name, preferred_name)')
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
    employees: EmployeeNameRow | EmployeeNameRow[] | null;
  };

  const openShiftRequests: OpenShiftRequestSummary[] = ((openShiftRequestRows ?? []) as OpenShiftRequestRow[]).map((row) => {
    const employeeRow = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    const employeeName = employeeDisplayName(employeeRow ?? { first_name: null, last_name: null, preferred_name: null });
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

  const auditRowsList = ((auditRows ?? []) as AuditRow[]).filter(row => Boolean(row.resource_id));
  const auditEmployeeNames: Record<string, string> = Object.fromEntries(
    employees.map(employee => [employee.employee_id, employeeDisplayName(employee)]),
  );
  const auditEmployeeIds = new Set(auditRowsList.flatMap(collectAuditEmployeeIds));
  const missingAuditEmployeeIds = [...auditEmployeeIds].filter(employeeId => !auditEmployeeNames[employeeId]);
  if (missingAuditEmployeeIds.length > 0) {
    const { data: missingEmployees } = await admin
      .from('employees')
      .select('employee_id, first_name, last_name, preferred_name')
      .in('employee_id', missingAuditEmployeeIds);

    (missingEmployees ?? []).forEach(employee => {
      auditEmployeeNames[employee.employee_id] = employeeDisplayName(employee);
    });
  }

  const auditUserIds = [...new Set(auditRowsList.map(row => row.user_id).filter((id): id is string => Boolean(id)))];
  const auditUserNames: Record<string, string> = {};
  if (auditUserIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, full_name, email')
      .in('id', auditUserIds);

    (profiles ?? []).forEach(profile => {
      const displayName = profile.full_name || profile.email;
      if (displayName) auditUserNames[profile.id] = displayName;
    });
  }

  const shiftAuditTrail: ShiftAuditTrailEntry[] = auditRowsList
    .map(row => ({
      id: row.id,
      shift_id: row.resource_id!,
      created_at: row.created_at,
      user_email: row.user_email,
      user_id: row.user_id,
      user_name: row.user_id ? (auditUserNames[row.user_id] ?? null) : null,
      operation_type: row.operation_type,
      old_values: row.old_values,
      new_values: row.new_values,
      additional_info: row.additional_info,
    }));
  const rejectedShifts = (rejectedShiftRows ?? []) as RejectedShiftRecord[];
  const publishedShifts = (publishedShiftRows ?? []) as PublishedShiftSnapshot[];

  // Per-user HMAC token: no global secret reaches the browser
  const feedToken = generateRotaFeedToken(user.id);
  const feedUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/rota/feed?token=${feedToken}&uid=${user.id}`;

  // Both badge counts are section-wide, so they need their own queries rather than
  // the week currently on screen. Publishing is judged from the current week
  // forwards, never from the week being viewed.
  const [unfilledShiftCount, weeksNeedingPublishing] = await Promise.all([
    getUnfilledShiftCount(),
    countWeeksNeedingPublishing(admin, getMondayIsoOfWeek(getTodayIsoDate())),
  ]);

  return (
    <PageLayout
      title="Weekly Rota"
      subtitle={formatWeekRange(weekStart, weekEnd)}
      navItems={buildRotaNavItems(unfilledShiftCount, { ...navPermissions, weeksNeedingPublishing })}
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
        openingExceptions={openingExceptions}
        periodSummary={rotaSummary}
        canViewSpend={canViewSpend}
        canViewSalesTargets={canViewSalesTargets}
        canEditSalesTargets={canEditSalesTargets}
        openShiftRequests={openShiftRequests}
        shiftAuditTrail={shiftAuditTrail}
        auditValueLabels={auditEmployeeNames}
        selectedShiftId={selectedShiftId}
        rejectedShifts={rejectedShifts}
      />
    </PageLayout>
  );
}
