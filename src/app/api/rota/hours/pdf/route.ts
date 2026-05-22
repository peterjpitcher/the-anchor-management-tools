import { NextRequest, NextResponse } from 'next/server';
import { formatInTimeZone } from 'date-fns-tz';
import { checkUserPermission } from '@/app/actions/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { generatePDFFromHTML } from '@/lib/pdf-generator';
import { calculatePaidHours } from '@/lib/rota/pay-calculator';

export const runtime = 'nodejs';
export const maxDuration = 120;

const TIMEZONE = 'Europe/London';
const COLOURS = [
  '#0f766e',
  '#16a34a',
  '#7c3aed',
  '#0f766e',
  '#be123c',
  '#9333ea',
  '#0f766e',
  '#be185d',
  '#6d28d9',
];
const HOLIDAY_COLOUR = '#d97706';
const SICK_COLOUR = '#2563eb';

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

type SickShiftRow = {
  id: string;
  employee_id: string;
  shift_date: string;
  sick_reason: string | null;
};

type PlannedShiftRow = {
  id: string;
  employee_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  is_overnight: boolean;
};

type EmployeeOption = {
  id: string;
  name: string;
  role: string | null;
  totalHours: number;
  holidayDays: number;
  sickDays: number;
};

type HoursSeries = {
  employeeId: string;
  name: string;
  colour: string;
  totalHours: number;
};

type ChartRow = {
  weekStart: string;
  weekLabel: string;
  __holidayDays: number;
  __sickDays: number;
  [key: string]: string | number;
};

type HolidayRecordRow = {
  employeeId: string;
  name: string;
  date: string;
};

type SickRecordRow = {
  employeeId: string;
  name: string;
  date: string;
  reason: string | null;
};

type ReportModel = {
  fromDate: string;
  toDate: string;
  generatedAt: string;
  chartData: ChartRow[];
  series: HoursSeries[];
  totalHours: number;
  totalHolidayDays: number;
  totalSickDays: number;
  holidayRows: HolidayRecordRow[];
  sickRows: SickRecordRow[];
};

function isIsoDate(value: string | null | undefined): value is string {
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

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fullDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
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

function formatHours(value: number): string {
  return `${value.toFixed(1)}h`;
}

function plannedShiftHours(shift: PlannedShiftRow): number {
  return calculatePaidHours(
    shift.start_time,
    shift.end_time,
    shift.unpaid_break_minutes,
    shift.is_overnight,
  );
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

function normalizeEmployeeParams(params: URLSearchParams): string[] {
  return [...new Set(params.getAll('employee').filter(Boolean))].sort();
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDayCount(value: number): string {
  return `${value} day${value === 1 ? '' : 's'}`;
}

function buildChartSvg(chartData: ChartRow[], series: HoursSeries[]): string {
  if (chartData.length === 0 || series.length === 0) {
    return '<div class="empty-chart">Select at least one employee to show hours.</div>';
  }

  const width = 1180;
  const height = 620;
  const margin = { top: 42, right: 70, bottom: 62, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const chartBottom = margin.top + plotHeight;
  const maxHours = Math.max(
    0,
    ...chartData.flatMap(row => series.map(item => Number(row[item.employeeId] ?? 0))),
  );
  const maxAbsenceDays = Math.max(
    1,
    ...chartData.map(row => Math.max(Number(row.__holidayDays ?? 0), Number(row.__sickDays ?? 0))),
  );
  const hourAxisMax = Math.max(6, Math.ceil(maxHours / 6) * 6);
  const hourStep = hourAxisMax <= 24 ? 6 : Math.max(6, Math.ceil(hourAxisMax / 4 / 6) * 6);
  const hourTicks = Array.from(
    { length: Math.floor(hourAxisMax / hourStep) + 1 },
    (_, index) => index * hourStep,
  );
  if (hourTicks[hourTicks.length - 1] !== hourAxisMax) {
    hourTicks.push(hourAxisMax);
  }

  const groupWidth = plotWidth / chartData.length;
  const barCount = 2;
  const gap = Math.min(2, Math.max(0.75, groupWidth * 0.08));
  const barWidth = Math.max(1.2, Math.min(14, ((groupWidth - gap * (barCount - 1)) / barCount) * 0.88));
  const barsWidth = barCount * barWidth + (barCount - 1) * gap;
  const xForIndex = (index: number) => margin.left + index * groupWidth + (groupWidth - barsWidth) / 2;
  const xForLineIndex = (index: number) => margin.left + index * groupWidth + groupWidth / 2;
  const yForHours = (value: number) => chartBottom - (value / hourAxisMax) * plotHeight;
  const yForAbsence = (value: number) => chartBottom - (value / maxAbsenceDays) * plotHeight;
  const xTickInterval = Math.max(1, Math.ceil(chartData.length / 14));

  const grid = hourTicks.map(value => {
    const y = yForHours(value);
    return `
      <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1" />
      <text x="${margin.left - 12}" y="${y + 4}" text-anchor="end" class="axis-label">${value}h</text>
    `;
  }).join('');

  const absenceTicks = Array.from(
    { length: maxAbsenceDays + 1 },
    (_, index) => index,
  ).filter(value => maxAbsenceDays <= 4 || value === 0 || value === maxAbsenceDays || value % Math.ceil(maxAbsenceDays / 3) === 0);
  const absenceLabels = absenceTicks.map(value => {
    const y = yForAbsence(value);
    return `<text x="${width - margin.right + 12}" y="${y + 4}" class="axis-label absence-axis">${value}d</text>`;
  }).join('');

  const employeeLines = series.map(item => {
    const points = chartData.map((row, index) => {
      const value = Number(row[item.employeeId] ?? 0);
      return `${xForLineIndex(index).toFixed(2)},${yForHours(value).toFixed(2)}`;
    }).join(' ');

    return `<polyline points="${points}" fill="none" stroke="${item.colour}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
  }).join('');

  const absenceBars = chartData.map((row, weekIndex) => {
    const xStart = xForIndex(weekIndex);
    const holidayDays = Number(row.__holidayDays ?? 0);
    const sickDays = Number(row.__sickDays ?? 0);
    const holidayBar = holidayDays > 0
      ? (() => {
        const x = xStart;
        const y = yForAbsence(holidayDays);
        const h = chartBottom - y;
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${h.toFixed(2)}" rx="2" fill="${HOLIDAY_COLOUR}" />`;
      })()
      : '';
    const sickBar = sickDays > 0
      ? (() => {
        const x = xStart + barWidth + gap;
        const y = yForAbsence(sickDays);
        const h = chartBottom - y;
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${h.toFixed(2)}" rx="2" fill="${SICK_COLOUR}" />`;
      })()
      : '';

    return holidayBar + sickBar;
  }).join('');

  const xLabels = chartData.map((row, index) => {
    if (index !== 0 && index !== chartData.length - 1 && index % xTickInterval !== 0) return '';
    const x = margin.left + index * groupWidth + groupWidth / 2;
    return `<text x="${x.toFixed(2)}" y="${chartBottom + 24}" text-anchor="middle" class="axis-label">${escapeHtml(row.weekLabel)}</text>`;
  }).join('');

  const legendItems = [
    ...series.map(item => ({ colour: item.colour, label: item.name })),
    { colour: HOLIDAY_COLOUR, label: 'Holiday days' },
    { colour: SICK_COLOUR, label: "Couldn't Work days" },
  ];
  const legend = legendItems.map((item, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = margin.left + column * 245;
    const y = 18 + row * 18;
    return `
      <circle cx="${x}" cy="${y}" r="5" fill="${item.colour}" />
      <text x="${x + 12}" y="${y + 4}" class="legend-label">${escapeHtml(item.label)}</text>
    `;
  }).join('');

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hours by week chart">
      <style>
        .axis-label { font: 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #6b7280; }
        .absence-axis { fill: #92400e; }
        .legend-label { font: 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #374151; }
      </style>
      ${legend}
      ${grid}
      ${absenceLabels}
      <line x1="${margin.left}" y1="${chartBottom}" x2="${width - margin.right}" y2="${chartBottom}" stroke="#d1d5db" stroke-width="1" />
      ${absenceBars}
      ${employeeLines}
      ${xLabels}
    </svg>
  `;
}

function buildTableRows(model: ReportModel): { holidayRowsHtml: string; sickRowsHtml: string } {
  const holidayRowsHtml = model.holidayRows.length > 0
    ? model.holidayRows.map(row => `
      <tr>
        <td><span class="dot" style="background:${HOLIDAY_COLOUR}"></span>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(fullDate(row.date))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="2" class="empty-cell">No approved holidays booked for the selected employees in this date range.</td></tr>';

  const sickRowsHtml = model.sickRows.length > 0
    ? model.sickRows.map(row => `
      <tr>
        <td><span class="dot" style="background:${SICK_COLOUR}"></span>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(fullDate(row.date))}</td>
        <td>${escapeHtml(row.reason || 'No reason recorded')}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="3" class="empty-cell">No Couldn&#39;t Work days recorded for the selected employees in this date range.</td></tr>';

  return { holidayRowsHtml, sickRowsHtml };
}

function buildReportHtml(model: ReportModel): string {
  const { holidayRowsHtml, sickRowsHtml } = buildTableRows(model);
  const employeeLabel = model.series.length === 1
    ? model.series[0].name
    : `${model.series.length} employees`;
  const dateRange = `${shortDate(model.fromDate)} - ${shortDate(model.toDate)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #ffffff; color: #111827; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    @media print {
      @page { size: A4 landscape; margin: 0; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    .page {
      width: 297mm;
      min-height: 210mm;
      padding: 12mm;
      page-break-after: always;
      background: #ffffff;
    }
    .page:last-child { page-break-after: auto; }
    .chart-page {
      display: flex;
      flex-direction: column;
      gap: 8mm;
    }
    .header {
      display: flex;
      justify-content: space-between;
      gap: 12mm;
      align-items: flex-start;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    h2 {
      margin: 0 0 5mm;
      font-size: 15px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .meta {
      margin-top: 2mm;
      font-size: 11px;
      color: #4b5563;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 3mm;
      min-width: 92mm;
    }
    .stat {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 3mm;
      background: #f9fafb;
    }
    .stat-label {
      font-size: 9px;
      color: #6b7280;
      font-weight: 600;
    }
    .stat-value {
      margin-top: 1mm;
      font-size: 16px;
      line-height: 1;
      font-weight: 700;
      color: #111827;
    }
    .chart-frame {
      flex: 1;
      min-height: 0;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 5mm;
      background: #ffffff;
    }
    .chart-svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .empty-chart {
      height: 145mm;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px dashed #d1d5db;
      border-radius: 8px;
      color: #6b7280;
      font-size: 12px;
    }
    .section + .section { margin-top: 9mm; }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10px;
    }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    th {
      text-align: left;
      padding: 2.4mm 2.8mm;
      border: 1px solid #d1d5db;
      background: #f3f4f6;
      color: #374151;
      font-size: 9px;
      font-weight: 700;
    }
    td {
      padding: 2.4mm 2.8mm;
      border: 1px solid #e5e7eb;
      vertical-align: top;
      color: #374151;
      overflow-wrap: anywhere;
    }
    .dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      margin-right: 6px;
      border-radius: 999px;
      vertical-align: 1px;
    }
    .empty-cell {
      padding: 8mm;
      text-align: center;
      color: #6b7280;
      background: #f9fafb;
    }
  </style>
</head>
<body>
  <section class="page chart-page">
    <header class="header">
      <div>
        <h1>Hours by Week</h1>
        <div class="meta">${escapeHtml(dateRange)} · ${escapeHtml(employeeLabel)} · generated ${escapeHtml(model.generatedAt)}</div>
      </div>
      <div class="stats">
        <div class="stat">
          <div class="stat-label">Actual + planned hours</div>
          <div class="stat-value">${escapeHtml(formatHours(model.totalHours))}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Holidays</div>
          <div class="stat-value">${escapeHtml(formatDayCount(model.totalHolidayDays))}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Couldn't Work</div>
          <div class="stat-value">${escapeHtml(formatDayCount(model.totalSickDays))}</div>
        </div>
      </div>
    </header>
    <div class="chart-frame">
      ${buildChartSvg(model.chartData, model.series)}
    </div>
  </section>

  <section class="page tables-page">
    <div class="section">
      <h2>Holidays Booked</h2>
      <table>
        <thead>
          <tr>
            <th style="width: 45%">Employee</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>${holidayRowsHtml}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Couldn't Work Recorded</h2>
      <table>
        <thead>
          <tr>
            <th style="width: 30%">Employee</th>
            <th style="width: 24%">Date</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>${sickRowsHtml}</tbody>
      </table>
    </div>
  </section>
</body>
</html>`;
}

async function buildReportModel(searchParams: URLSearchParams): Promise<ReportModel> {
  const today = formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const defaultTo = addDaysIso(mondayOfWeekIso(today), 6);
  const defaultFrom = addWeeksIso(mondayOfWeekIso(defaultTo), -11);

  let fromDate = isIsoDate(searchParams.get('from')) ? searchParams.get('from')! : defaultFrom;
  let toDate = isIsoDate(searchParams.get('to')) ? searchParams.get('to')! : defaultTo;
  if (fromDate > toDate) {
    [fromDate, toDate] = [toDate, fromDate];
  }

  const requestedEmployeeIds = normalizeEmployeeParams(searchParams);
  const supabase = createAdminClient();

  const [employeesResult, sessionsResult, leaveDaysResult, sickShiftsResult, plannedShiftsResult] = await Promise.all([
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
    supabase
      .from('rota_shifts')
      .select('id, employee_id, shift_date, sick_reason')
      .gte('shift_date', fromDate)
      .lte('shift_date', toDate)
      .eq('status', 'sick')
      .not('employee_id', 'is', null)
      .order('shift_date'),
    supabase
      .from('rota_shifts')
      .select('id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, is_overnight')
      .gte('shift_date', fromDate)
      .lte('shift_date', toDate)
      .gt('shift_date', today)
      .eq('status', 'scheduled')
      .eq('is_open_shift', false)
      .not('employee_id', 'is', null)
      .order('shift_date')
      .order('start_time'),
  ]);

  if (employeesResult.error) throw employeesResult.error;
  if (sessionsResult.error) throw sessionsResult.error;
  if (leaveDaysResult.error) throw leaveDaysResult.error;
  if (sickShiftsResult.error) throw sickShiftsResult.error;
  if (plannedShiftsResult.error) throw plannedShiftsResult.error;

  const employees = (employeesResult.data ?? []) as EmployeeRow[];
  const sessions = (sessionsResult.data ?? []) as SessionRow[];
  const leaveDays = (leaveDaysResult.data ?? []) as LeaveDayRow[];
  const sickShifts = (sickShiftsResult.data ?? []) as SickShiftRow[];
  const plannedShifts = (plannedShiftsResult.data ?? []) as PlannedShiftRow[];
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
  const employeeOptions: EmployeeOption[] = [...optionIds]
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

  const weeks = generateWeeks(fromDate, toDate);
  const chartData: ChartRow[] = weeks.map(weekStart => {
    const row: ChartRow = {
      weekStart,
      weekLabel: weekLabel(weekStart),
      __holidayDays: 0,
      __sickDays: 0,
    };
    for (const employee of seriesEmployees) {
      row[employee.id] = 0;
    }
    return row;
  });
  const weekIndex = new Map(chartData.map((row, index) => [row.weekStart, index]));

  for (const session of filteredCompletedSessions) {
    const weekStart = mondayOfWeekIso(session.work_date);
    const rowIndex = weekIndex.get(weekStart);
    if (rowIndex === undefined) continue;
    const current = Number(chartData[rowIndex][session.employee_id] ?? 0);
    chartData[rowIndex][session.employee_id] = roundHours(current + actualHours(session));
  }
  for (const shift of reportablePlannedShifts) {
    if (!selectedSet.has(shift.employee_id)) continue;
    const rowIndex = weekIndex.get(mondayOfWeekIso(shift.shift_date));
    if (rowIndex === undefined) continue;
    const hours = plannedShiftHours(shift);
    if (hours <= 0) continue;
    const current = Number(chartData[rowIndex][shift.employee_id] ?? 0);
    chartData[rowIndex][shift.employee_id] = roundHours(current + hours);
  }

  for (const leaveDay of leaveDays) {
    if (!selectedSet.has(leaveDay.employee_id)) continue;
    const rowIndex = weekIndex.get(mondayOfWeekIso(leaveDay.leave_date));
    if (rowIndex === undefined) continue;
    chartData[rowIndex].__holidayDays += 1;
  }

  const countedSickChartKeys = new Set<string>();
  for (const sickShift of sickShifts) {
    if (!selectedSet.has(sickShift.employee_id)) continue;
    const rowIndex = weekIndex.get(mondayOfWeekIso(sickShift.shift_date));
    if (rowIndex === undefined) continue;

    const key = `${sickShift.employee_id}:${sickShift.shift_date}`;
    if (countedSickChartKeys.has(key)) continue;
    countedSickChartKeys.add(key);
    chartData[rowIndex].__sickDays += 1;
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

  const holidayRows: HolidayRecordRow[] = seriesEmployees
    .flatMap(employee => (holidayDatesByEmployee.get(employee.id) ?? []).sort().map(date => ({
      employeeId: employee.id,
      name: employee.name,
      date,
    })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  const sickRows: SickRecordRow[] = seriesEmployees
    .flatMap(employee => (sickEntriesByEmployee.get(employee.id) ?? [])
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(entry => ({
        employeeId: employee.id,
        name: employee.name,
        date: entry.date,
        reason: entry.reason,
      })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  return {
    fromDate,
    toDate,
    generatedAt: formatInTimeZone(new Date(), TIMEZONE, 'd MMM yyyy HH:mm'),
    chartData,
    series,
    totalHours,
    totalHolidayDays,
    totalSickDays,
    holidayRows,
    sickRows,
  };
}

function buildFilename(model: ReportModel): string {
  return `rota-hours-${model.fromDate}-${model.toDate}.pdf`;
}

export async function GET(request: NextRequest) {
  try {
    const [canViewTimeclock, canViewRota] = await Promise.all([
      checkUserPermission('timeclock', 'view'),
      checkUserPermission('rota', 'view'),
    ]);

    if (!canViewTimeclock || !canViewRota) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const url = new URL(request.url);
    const previewInline = url.searchParams.get('preview') === '1';
    const model = await buildReportModel(url.searchParams);
    const html = buildReportHtml(model);
    const pdfBuffer = await generatePDFFromHTML(html, {
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
      },
    });

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${previewInline ? 'inline' : 'attachment'}; filename="${buildFilename(model)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Rota hours PDF export failed:', error);
    return NextResponse.json({ error: 'Failed to generate rota hours PDF.' }, { status: 500 });
  }
}
