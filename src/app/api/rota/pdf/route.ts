import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getOrCreateRotaWeek,
  getWeekShifts,
  getActiveEmployeesForRota,
  getLeaveDaysForWeek,
} from '@/app/actions/rota';
import type { RotaWeek, RotaShift, RotaEmployee, LeaveDayWithRequest } from '@/app/actions/rota';
import { generatePDFFromHTML } from '@/lib/pdf-generator';
import { checkUserPermission } from '@/app/actions/rbac';

// ---------------------------------------------------------------------------
// Helpers (duplicated from print page — no shared module to keep things simple)
// ---------------------------------------------------------------------------

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function paidHours(start: string, end: string, breakMins: number, overnight: boolean): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (overnight || endM <= startM) endM += 24 * 60;
  return Math.max(0, endM - startM - breakMins) / 60;
}

function empDisplayName(emp: RotaEmployee): string {
  return [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown';
}

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const period = h < 12 ? 'am' : 'pm';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour}:${String(m).padStart(2, '0')}${period}`;
}

function formatDayHeader(iso: string): { weekday: string; date: string } {
  const d = new Date(iso + 'T00:00:00Z');
  return {
    weekday: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  };
}

function formatWeekRange(days: string[]): string {
  const s = new Date(days[0] + 'T00:00:00Z');
  const e = new Date(days[6] + 'T00:00:00Z');
  const startStr = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const endStr = e.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `${startStr} – ${endStr}`;
}

function empWeekHours(employeeId: string, shifts: RotaShift[]): number {
  return shifts
    .filter(s => s.employee_id === employeeId && s.status !== 'cancelled')
    .reduce((sum, s) => sum + paidHours(s.start_time, s.end_time, s.unpaid_break_minutes, s.is_overnight), 0);
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function buildShiftCell(
  shifts: RotaShift[],
  leaveDays: LeaveDayWithRequest[],
  employeeId: string,
  date: string,
  fs: number,
): string {
  const cellShifts = shifts.filter(
    s => s.employee_id === employeeId && s.shift_date === date && s.status !== 'cancelled'
  );
  const cellLeave = leaveDays.find(l => l.employee_id === employeeId && l.leave_date === date);

  const leaveHtml = cellLeave
    ? `<div style="text-align:center;border-radius:3px;font-size:${fs - 1}px;padding:1px 3px;margin-bottom:2px;font-weight:600;
        background:${cellLeave.status === 'approved' ? '#dcfce7' : '#fef9c3'};
        color:${cellLeave.status === 'approved' ? '#166534' : '#854d0e'}">
        ${cellLeave.status === 'approved' ? 'Holiday' : 'Holiday&nbsp;(P)'}
      </div>`
    : '';

  const shiftsHtml = cellShifts.map(shift => {
    const ph = paidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
    const isSick = shift.status === 'sick';
    const isBar = shift.department === 'bar';
    const bg = isSick ? '#fee2e2' : isBar ? '#dbeafe' : '#ffedd5';
    const fg = isSick ? '#991b1b' : isBar ? '#1e40af' : '#9a3412';
    const nameHtml = shift.name
      ? `<div style="font-size:${fs - 1}px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${shift.name}</div>`
      : '';
    return `<div style="background:${bg};color:${fg};border-radius:3px;padding:2px 4px;margin-bottom:2px;font-size:${fs}px">
      ${nameHtml}
      <div style="font-weight:600">${formatTime(shift.start_time)}–${formatTime(shift.end_time)}</div>
      <div style="font-size:${fs - 1}px;opacity:0.85">${isSick ? 'Sick' : isBar ? 'Bar' : 'Kitchen'} · ${ph.toFixed(1)}h</div>
    </div>`;
  }).join('');

  return `<td style="padding:3px 4px;border:1px solid #d1d5db;vertical-align:top">${leaveHtml}${shiftsHtml}</td>`;
}

function buildRotaHTML(
  week: RotaWeek,
  employees: RotaEmployee[],
  shifts: RotaShift[],
  leaveDays: LeaveDayWithRequest[],
  days: string[],
  generatedAt: string,
): string {
  const openShifts = shifts.filter(s => s.is_open_shift || !s.employee_id);

  // Scale font sizes down when there are many employees so everything fits
  const rowCount = employees.length + (openShifts.length > 0 ? 1 : 0);
  const baseFontSize = rowCount <= 12 ? 10 : rowCount <= 16 ? 9 : 8;
  const headerFontSize = baseFontSize - 1;

  const dayHeaders = days.map(d => {
    const { weekday, date } = formatDayHeader(d);
    return `<th style="padding:4px 4px;border:1px solid #d1d5db;text-align:center;font-weight:600;color:#374151;font-size:${headerFontSize}px">
      <div>${weekday}</div>
      <div style="font-weight:400;color:#6b7280;font-size:${headerFontSize - 1}px">${date}</div>
    </th>`;
  }).join('');

  const employeeRows = employees.map(emp => {
    const totalHrs = empWeekHours(emp.employee_id, shifts);
    const cells = days.map(d => buildShiftCell(shifts, leaveDays, emp.employee_id, d, baseFontSize)).join('');
    return `<tr>
      <td style="padding:4px 6px;border:1px solid #d1d5db;font-weight:600;font-size:${headerFontSize}px;vertical-align:top;word-break:break-word">
        ${empDisplayName(emp)}
        ${emp.job_title ? `<div style="font-weight:400;color:#6b7280;font-size:${headerFontSize - 1}px">${emp.job_title}</div>` : ''}
      </td>
      ${cells}
      <td style="padding:4px 4px;border:1px solid #d1d5db;text-align:center;font-weight:700;font-size:${headerFontSize}px;vertical-align:top;color:${totalHrs > 0 ? '#111' : '#d1d5db'}">
        ${totalHrs > 0 ? totalHrs.toFixed(1) : '—'}
      </td>
    </tr>`;
  }).join('');

  const openShiftsRow = openShifts.length > 0 ? (() => {
    const cells = days.map(d => {
      const dayOpen = openShifts.filter(s => s.shift_date === d && s.status !== 'cancelled');
      const inner = dayOpen.map(shift => {
        const ph = paidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
        const isBar = shift.department === 'bar';
        return `<div style="border-radius:3px;padding:2px 4px;margin-bottom:2px;font-size:${baseFontSize}px;
          background:${isBar ? '#dbeafe' : '#ffedd5'};color:${isBar ? '#1e40af' : '#9a3412'}">
          <div style="font-weight:600">${formatTime(shift.start_time)}–${formatTime(shift.end_time)}</div>
          <div style="font-size:${baseFontSize - 1}px;opacity:0.85">${isBar ? 'Bar' : 'Kitchen'} · ${ph.toFixed(1)}h</div>
        </div>`;
      }).join('');
      return `<td style="padding:3px 4px;border:1px solid #d1d5db;vertical-align:top">${inner}</td>`;
    }).join('');
    return `<tr style="background:#fffbeb">
      <td style="padding:4px 6px;border:1px solid #d1d5db;font-weight:600;font-size:${headerFontSize}px;vertical-align:top;color:#92400e">Open shifts</td>
      ${cells}
      <td style="border:1px solid #d1d5db"></td>
    </tr>`;
  })() : '';

  const legendItems = [
    { bg: '#dbeafe', label: 'Bar' },
    { bg: '#ffedd5', label: 'Kitchen' },
    { bg: '#fee2e2', label: 'Sick' },
    { bg: '#dcfce7', label: 'Holiday (approved)' },
    { bg: '#fef9c3', label: 'Holiday (pending)' },
  ].map(({ bg, label }) =>
    `<span style="display:flex;align-items:center;gap:4px;font-size:9px;color:#374151">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${bg};border:1px solid #e5e7eb"></span>
      ${label}
    </span>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: ${baseFontSize}px;
    color: #111;
    background: white;
    padding: 0;
  }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  @media print {
    @page { size: A4 landscape; margin: 0; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div style="padding: 10px 12px">
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
    <div>
      <div style="font-size:16px;font-weight:700">Weekly Rota</div>
      <div style="font-size:11px;color:#374151;margin-top:2px">${formatWeekRange(days)}</div>
    </div>
    <div style="text-align:right">
      <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:600;
        background:${week.status === 'published' ? '#dcfce7' : '#fef9c3'};
        color:${week.status === 'published' ? '#166534' : '#854d0e'};margin-bottom:3px">
        ${week.status === 'published' ? 'Published' : 'Draft'}
      </span>
      <div style="font-size:9px;color:#9ca3af">Printed ${generatedAt}</div>
    </div>
  </div>

  <!-- Rota table -->
  <table>
    <colgroup>
      <col style="width:90px">
      ${days.map(() => '<col>').join('')}
      <col style="width:36px">
    </colgroup>
    <thead>
      <tr style="background:#f9fafb">
        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left;font-weight:600;color:#374151;font-size:${headerFontSize}px">Employee</th>
        ${dayHeaders}
        <th style="padding:4px 4px;border:1px solid #d1d5db;text-align:center;font-weight:600;color:#374151;font-size:${headerFontSize}px">Hrs</th>
      </tr>
    </thead>
    <tbody>
      ${employeeRows}
      ${openShiftsRow}
    </tbody>
  </table>

  <!-- Legend -->
  <div style="margin-top:8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <span style="font-size:9px;color:#6b7280;font-weight:600">Legend:</span>
    ${legendItems}
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const canView = await checkUserPermission('rota', 'view', user.id);
  if (!canView) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Resolve week
  const { searchParams } = request.nextUrl;
  const weekParam = searchParams.get('week');

  const weekStart = (() => {
    if (weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
      return getMondayOfWeek(new Date(weekParam + 'T00:00:00Z')).toISOString().split('T')[0];
    }
    return getMondayOfWeek(new Date()).toISOString().split('T')[0];
  })();

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split('T')[0];
  });

  // Fetch data
  const [weekResult, employeesResult, shiftsResult, leaveDaysResult] = await Promise.all([
    getOrCreateRotaWeek(weekStart),
    getActiveEmployeesForRota(weekStart),
    getWeekShifts(weekStart),
    getLeaveDaysForWeek(weekStart),
  ]);

  if (!weekResult.success) {
    return NextResponse.json({ error: 'Failed to load rota data' }, { status: 500 });
  }

  const week: RotaWeek = weekResult.data;
  const employees: RotaEmployee[] = employeesResult.success ? employeesResult.data : [];
  const shifts: RotaShift[] = shiftsResult.success ? shiftsResult.data : [];
  const leaveDays: LeaveDayWithRequest[] = leaveDaysResult.success ? leaveDaysResult.data : [];

  const generatedAt = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Build HTML
  const html = buildRotaHTML(week, employees, shifts, leaveDays, days, generatedAt);

  // Generate PDF (A4 landscape, single page)
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generatePDFFromHTML(html, {
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '8mm', right: '6mm', bottom: '8mm', left: '6mm' },
      displayHeaderFooter: false,
    });
  } catch (err) {
    console.error('Rota PDF generation failed:', err);
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }

  const filename = `rota-${weekStart}.pdf`;

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
