import { redirect } from 'next/navigation';
import { formatInTimeZone } from 'date-fns-tz';
import { checkUserPermission } from '@/app/actions/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageLayout } from '@/ds';
import { rotaNavItems } from '../nav';
import HoursByEmployeeClient, {
  type HoursEmployeeOption,
  type HolidayEmployeeSummary,
  type HoursSeries,
  type WeeklyHolidayDetail,
  type WeeklyHoursRow,
} from './HoursByEmployeeClient';

export const dynamic = 'force-dynamic';

const TIMEZONE = 'Europe/London';
const COLOURS = [
  'var(--color-primary)',
  'var(--color-info)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--color-success)',
  '#7c3aed',
  '#0f766e',
  '#be123c',
  '#2563eb',
  '#9333ea',
];

interface HoursPageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    employee?: string | string[];
  }>;
}

type SessionRow = {
  id: string;
  employee_id: string;
  work_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
};

type EmployeeRow = {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  status: string | null;
};

type LeaveDayRow = {
  employee_id: string;
  leave_date: string;
  request_id: string;
};

function isIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function addWeeksIso(isoDate: string, weeks: number): string {
  return addDaysIso(isoDate, weeks * 7);
}

function mondayOfWeekIso(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return toIsoDate(date);
}

function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function employeeName(employee: Pick<EmployeeRow, 'first_name' | 'last_name'>): string {
  return [employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Unknown';
}

function actualHours(session: SessionRow): number {
  if (!session.clock_out_at) return 0;
  const diffMs = new Date(session.clock_out_at).getTime() - new Date(session.clock_in_at).getTime();
  return Math.max(0, diffMs / 3_600_000);
}

function roundHours(value: number): number {
  return Math.round(value * 10) / 10;
}

function generateWeeks(fromDate: string, toDate: string): string[] {
  const start = mondayOfWeekIso(fromDate);
  const end = mondayOfWeekIso(toDate);
  const weeks: string[] = [];
  for (let current = start; current <= end; current = addWeeksIso(current, 1)) {
    weeks.push(current);
  }
  return weeks;
}

function normalizeEmployeeParams(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(raw.filter(Boolean))].sort();
}

export default async function RotaHoursPage({ searchParams }: HoursPageProps) {
  const [canViewTimeclock, canViewRota] = await Promise.all([
    checkUserPermission('timeclock', 'view'),
    checkUserPermission('rota', 'view'),
  ]);
  if (!canViewTimeclock || !canViewRota) redirect('/');

  const params = await Promise.resolve(searchParams ?? {});
  const today = formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const defaultTo = addDaysIso(mondayOfWeekIso(today), 6);
  const defaultFrom = addWeeksIso(mondayOfWeekIso(defaultTo), -11);

  let fromDate = isIsoDate(params.from) ? params.from : defaultFrom;
  let toDate = isIsoDate(params.to) ? params.to : defaultTo;
  if (fromDate > toDate) {
    [fromDate, toDate] = [toDate, fromDate];
  }

  const requestedEmployeeIds = normalizeEmployeeParams(params.employee);
  const supabase = createAdminClient();

  const [employeesResult, sessionsResult, leaveDaysResult] = await Promise.all([
    supabase
      .from('employees')
      .select('employee_id, first_name, last_name, job_title, status')
      .order('first_name')
      .order('last_name'),
    supabase
      .from('timeclock_sessions')
      .select('id, employee_id, work_date, clock_in_at, clock_out_at')
      .gte('work_date', fromDate)
      .lte('work_date', toDate)
      .order('work_date')
      .order('clock_in_at'),
    supabase
      .from('leave_days')
      .select('employee_id, leave_date, request_id, leave_requests!inner(status)')
      .gte('leave_date', fromDate)
      .lte('leave_date', toDate)
      .eq('leave_requests.status', 'approved')
      .order('leave_date'),
  ]);

  const employees = (employeesResult.data ?? []) as EmployeeRow[];
  const sessions = (sessionsResult.data ?? []) as SessionRow[];
  const leaveDays = (leaveDaysResult.data ?? []) as LeaveDayRow[];
  const employeeMap = new Map(employees.map(employee => [employee.employee_id, employee]));
  const validEmployeeIds = new Set(employees.map(employee => employee.employee_id));
  const selectedEmployeeIds = requestedEmployeeIds.filter(id => validEmployeeIds.has(id));
  const selectedSet = new Set(selectedEmployeeIds);

  const completedSessions = sessions.filter(session => session.clock_out_at);
  const filteredCompletedSessions = completedSessions.filter(session => selectedSet.has(session.employee_id));
  const openSessionCount = sessions.filter(session =>
    !session.clock_out_at && selectedSet.has(session.employee_id)
  ).length;

  const totalsByEmployee = new Map<string, number>();
  for (const session of completedSessions) {
    totalsByEmployee.set(
      session.employee_id,
      (totalsByEmployee.get(session.employee_id) ?? 0) + actualHours(session),
    );
  }

  const holidayDatesByEmployee = new Map<string, string[]>();
  for (const leaveDay of leaveDays) {
    const dates = holidayDatesByEmployee.get(leaveDay.employee_id) ?? [];
    dates.push(leaveDay.leave_date);
    holidayDatesByEmployee.set(leaveDay.employee_id, dates);
  }

  const optionIds = new Set<string>([
    ...employees.map(employee => employee.employee_id),
    ...completedSessions.map(session => session.employee_id),
    ...leaveDays.map(day => day.employee_id),
    ...selectedEmployeeIds,
  ]);
  const employeeOptions: HoursEmployeeOption[] = [...optionIds]
    .map(id => {
      const employee = employeeMap.get(id);
      const holidayDays = holidayDatesByEmployee.get(id)?.length ?? 0;
      return {
        id,
        name: employee ? employeeName(employee) : 'Unknown',
        role: employee?.job_title ?? null,
        totalHours: roundHours(totalsByEmployee.get(id) ?? 0),
        holidayDays,
      };
    })
    .sort((a, b) =>
      b.totalHours - a.totalHours ||
      b.holidayDays - a.holidayDays ||
      a.name.localeCompare(b.name)
    );

  const seriesEmployees = employeeOptions
    .filter(employee => selectedSet.has(employee.id))
    .sort((a, b) =>
      b.totalHours - a.totalHours ||
      b.holidayDays - a.holidayDays ||
      a.name.localeCompare(b.name)
    );

  const series: HoursSeries[] = seriesEmployees.map((employee, index) => ({
    employeeId: employee.id,
    name: employee.name,
    colour: COLOURS[index % COLOURS.length],
    totalHours: employee.totalHours,
  }));
  const colourByEmployeeId = new Map(series.map(item => [item.employeeId, item.colour]));

  const weeks = generateWeeks(fromDate, toDate);
  const chartData: WeeklyHoursRow[] = weeks.map(weekStart => {
    const row: WeeklyHoursRow = {
      weekStart,
      weekLabel: weekLabel(weekStart),
      __holidayDays: 0,
      __holidayDetails: [],
    };
    for (const employee of seriesEmployees) {
      row[employee.id] = 0;
    }
    return row;
  });
  const weekIndex = new Map(chartData.map((row, index) => [row.weekStart, index]));

  for (const session of filteredCompletedSessions) {
    if (!seriesEmployees.some(employee => employee.id === session.employee_id)) continue;
    const weekStart = mondayOfWeekIso(session.work_date);
    const rowIndex = weekIndex.get(weekStart);
    if (rowIndex === undefined) continue;
    const current = Number(chartData[rowIndex][session.employee_id] ?? 0);
    chartData[rowIndex][session.employee_id] = roundHours(current + actualHours(session));
  }

  for (const leaveDay of leaveDays) {
    if (!selectedSet.has(leaveDay.employee_id)) continue;
    const weekStart = mondayOfWeekIso(leaveDay.leave_date);
    const rowIndex = weekIndex.get(weekStart);
    if (rowIndex === undefined) continue;

    const row = chartData[rowIndex];
    const details = (row.__holidayDetails ?? []) as WeeklyHolidayDetail[];
    const employee = employeeOptions.find(option => option.id === leaveDay.employee_id);
    const existing = details.find(item => item.employeeId === leaveDay.employee_id);

    row.__holidayDays = Number(row.__holidayDays ?? 0) + 1;

    if (existing) {
      existing.days += 1;
      existing.dates.push(leaveDay.leave_date);
    } else {
      details.push({
        employeeId: leaveDay.employee_id,
        name: employee?.name ?? 'Unknown',
        colour: colourByEmployeeId.get(leaveDay.employee_id) ?? COLOURS[0],
        dates: [leaveDay.leave_date],
        days: 1,
      });
    }

    row.__holidayDetails = details;
  }

  const totalHours = roundHours(filteredCompletedSessions.reduce((sum, session) => sum + actualHours(session), 0));
  const totalHolidayDays = seriesEmployees.reduce(
    (sum, employee) => sum + (holidayDatesByEmployee.get(employee.id)?.length ?? 0),
    0,
  );
  const holidaySummaries: HolidayEmployeeSummary[] = seriesEmployees
    .map(employee => ({
      employeeId: employee.id,
      name: employee.name,
      colour: colourByEmployeeId.get(employee.id) ?? COLOURS[0],
      holidayDays: holidayDatesByEmployee.get(employee.id)?.length ?? 0,
      dates: [...(holidayDatesByEmployee.get(employee.id) ?? [])].sort(),
    }))
    .filter(summary => summary.holidayDays > 0);

  return (
    <PageLayout
      title="Hours by employee"
      subtitle="Worked timeclock hours and booked holidays grouped by employee"
      navItems={rotaNavItems}
    >
      <HoursByEmployeeClient
        employees={employeeOptions}
        selectedEmployeeIds={selectedEmployeeIds}
        fromDate={fromDate}
        toDate={toDate}
        chartData={chartData}
        series={series}
        totalHours={totalHours}
        totalHolidayDays={totalHolidayDays}
        holidaySummaries={holidaySummaries}
        completedSessionCount={filteredCompletedSessions.length}
        openSessionCount={openSessionCount}
        weekCount={weeks.length}
      />
    </PageLayout>
  );
}
