import { redirect } from 'next/navigation';
import { formatInTimeZone } from 'date-fns-tz';
import { checkUserPermission } from '@/app/actions/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  isIsoDate,
  toIsoDate,
  addDaysIso,
  addWeeksIso,
  mondayOfWeekIso,
  weekLabel,
  actualHours,
  roundHours,
  plannedShiftHours,
  generateWeeks,
} from '@/lib/rota/hours-report';
import { loadHoursReportData, type EmployeeRow } from '@/lib/rota/hours-report-data';
import { displayName } from '@/lib/employees/display-name';
import { ROTA_HOURS_SERIES_COLOURS } from '@/lib/rota/status-ui';
import { PageLayout } from '@/ds';
import { rotaNavItems } from '../nav';
import HoursByEmployeeClient, {
  type HoursEmployeeOption,
  type HolidayEmployeeSummary,
  type SickEmployeeSummary,
  type HoursSeries,
  type WeeklyHolidayDetail,
  type WeeklySickDetail,
  type WeeklyHoursRow,
} from './HoursByEmployeeClient';

export const dynamic = 'force-dynamic';

const TIMEZONE = 'Europe/London';
// One line colour per employee: the six chart tokens, then the category colours they do not
// already use, so up to nine people get distinct lines (the old list repeated one teal). The list
// lives in the shared rota map so the printed report gives each person the same colour.
const COLOURS = ROTA_HOURS_SERIES_COLOURS.map(colour => colour.css);

interface HoursPageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    employee?: string | string[];
  }>;
}

// Hours by employee is a planning screen, not a payroll record, so it shows the
// name the team uses. Payroll itself still reports on the legal name.
function employeeName(employee: Pick<EmployeeRow, 'first_name' | 'last_name' | 'preferred_name'>): string {
  return displayName(employee, 'Unknown');
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

  const { employees, sessions, leaveDays, sickShifts, plannedShifts } = await loadHoursReportData(supabase, {
    fromDate,
    toDate,
    today,
  });

  const employeeMap = new Map(employees.map(employee => [employee.employee_id, employee]));
  const validEmployeeIds = new Set(employees.map(employee => employee.employee_id));
  const selectedEmployeeIds = requestedEmployeeIds.filter(id => validEmployeeIds.has(id));
  const selectedSet = new Set(selectedEmployeeIds);

  const completedSessions = sessions.filter(session => session.clock_out_at);
  const filteredCompletedSessions = completedSessions.filter(session => selectedSet.has(session.employee_id));
  const completedSessionDateKeys = new Set(completedSessions.map(session => `${session.employee_id}:${session.work_date}`));
  const reportablePlannedShifts = plannedShifts.filter(shift =>
    !completedSessionDateKeys.has(`${shift.employee_id}:${shift.shift_date}`)
  );
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
  for (const shift of reportablePlannedShifts) {
    const hours = plannedShiftHours(shift);
    if (hours <= 0) continue;
    totalsByEmployee.set(
      shift.employee_id,
      (totalsByEmployee.get(shift.employee_id) ?? 0) + hours,
    );
  }

  const holidayDatesByEmployee = new Map<string, string[]>();
  for (const leaveDay of leaveDays) {
    const dates = holidayDatesByEmployee.get(leaveDay.employee_id) ?? [];
    dates.push(leaveDay.leave_date);
    holidayDatesByEmployee.set(leaveDay.employee_id, dates);
  }

  const sickEntriesByEmployee = new Map<string, Array<{ date: string; reason: string | null }>>();
  for (const sickShift of sickShifts) {
    const entries = sickEntriesByEmployee.get(sickShift.employee_id) ?? [];
    const existing = entries.find(entry => entry.date === sickShift.shift_date);
    if (existing) {
      const reason = sickShift.sick_reason?.trim();
      if (reason && existing.reason !== reason) {
        existing.reason = existing.reason ? `${existing.reason}; ${reason}` : reason;
      }
    } else {
      entries.push({ date: sickShift.shift_date, reason: sickShift.sick_reason?.trim() || null });
    }
    sickEntriesByEmployee.set(sickShift.employee_id, entries);
  }

  const optionIds = new Set<string>([
    ...employees.map(employee => employee.employee_id),
    ...completedSessions.map(session => session.employee_id),
    ...reportablePlannedShifts.map(shift => shift.employee_id),
    ...leaveDays.map(day => day.employee_id),
    ...sickShifts.map(shift => shift.employee_id),
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
        sickDays: sickEntriesByEmployee.get(id)?.length ?? 0,
      };
    })
    .sort((a, b) =>
      b.totalHours - a.totalHours ||
      b.holidayDays - a.holidayDays ||
      b.sickDays - a.sickDays ||
      a.name.localeCompare(b.name)
    );

  const seriesEmployees = employeeOptions
    .filter(employee => selectedSet.has(employee.id))
    .sort((a, b) =>
      b.totalHours - a.totalHours ||
      b.holidayDays - a.holidayDays ||
      b.sickDays - a.sickDays ||
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
      __sickDays: 0,
      __sickDetails: [],
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
  for (const shift of reportablePlannedShifts) {
    if (!selectedSet.has(shift.employee_id)) continue;
    if (!seriesEmployees.some(employee => employee.id === shift.employee_id)) continue;
    const weekStart = mondayOfWeekIso(shift.shift_date);
    const rowIndex = weekIndex.get(weekStart);
    if (rowIndex === undefined) continue;
    const hours = plannedShiftHours(shift);
    if (hours <= 0) continue;
    const current = Number(chartData[rowIndex][shift.employee_id] ?? 0);
    chartData[rowIndex][shift.employee_id] = roundHours(current + hours);
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

  for (const sickShift of sickShifts) {
    if (!selectedSet.has(sickShift.employee_id)) continue;
    const weekStart = mondayOfWeekIso(sickShift.shift_date);
    const rowIndex = weekIndex.get(weekStart);
    if (rowIndex === undefined) continue;

    const row = chartData[rowIndex];
    const details = (row.__sickDetails ?? []) as WeeklySickDetail[];
    const employee = employeeOptions.find(option => option.id === sickShift.employee_id);
    const existingEmployee = details.find(item => item.employeeId === sickShift.employee_id);
    const reason = sickShift.sick_reason?.trim() || null;

    if (existingEmployee) {
      if (!existingEmployee.entries.some(entry => entry.date === sickShift.shift_date)) {
        existingEmployee.days += 1;
        existingEmployee.entries.push({ date: sickShift.shift_date, reason });
        row.__sickDays = Number(row.__sickDays ?? 0) + 1;
      }
    } else {
      details.push({
        employeeId: sickShift.employee_id,
        name: employee?.name ?? 'Unknown',
        colour: colourByEmployeeId.get(sickShift.employee_id) ?? COLOURS[0],
        entries: [{ date: sickShift.shift_date, reason }],
        days: 1,
      });
      row.__sickDays = Number(row.__sickDays ?? 0) + 1;
    }

    row.__sickDetails = details;
  }

  const totalHours = roundHours(seriesEmployees.reduce(
    (sum, employee) => sum + (totalsByEmployee.get(employee.id) ?? 0),
    0,
  ));
  const totalHolidayDays = seriesEmployees.reduce(
    (sum, employee) => sum + (holidayDatesByEmployee.get(employee.id)?.length ?? 0),
    0,
  );
  const totalSickDays = seriesEmployees.reduce(
    (sum, employee) => sum + (sickEntriesByEmployee.get(employee.id)?.length ?? 0),
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
  const sickSummaries: SickEmployeeSummary[] = seriesEmployees
    .map(employee => ({
      employeeId: employee.id,
      name: employee.name,
      colour: colourByEmployeeId.get(employee.id) ?? COLOURS[0],
      sickDays: sickEntriesByEmployee.get(employee.id)?.length ?? 0,
      entries: [...(sickEntriesByEmployee.get(employee.id) ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .filter(summary => summary.sickDays > 0);

  return (
    <PageLayout
      title="Hours by employee"
      subtitle="Actual timeclock hours, future planned hours, holidays, and Couldn't Work days grouped by employee"
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
        totalSickDays={totalSickDays}
        holidaySummaries={holidaySummaries}
        sickSummaries={sickSummaries}
        completedSessionCount={filteredCompletedSessions.length}
        openSessionCount={openSessionCount}
        weekCount={weeks.length}
      />
    </PageLayout>
  );
}
