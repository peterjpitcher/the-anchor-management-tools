import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getOrCreateRotaWeek,
  getWeekShifts,
  getActiveEmployeesForRota,
  getLeaveDaysForWeek,
} from '@/app/actions/rota';
import type { RotaWeek, RotaShift, RotaEmployee, LeaveDayWithRequest } from '@/app/actions/rota';
import { getShiftTemplates } from '@/app/actions/rota-templates';
import type { ShiftTemplate } from '@/app/actions/rota-templates';
import { generatePDFFromHTML } from '@/lib/pdf-generator';
import { checkUserPermission } from '@/app/actions/rbac';
import { displayName } from '@/lib/employees/display-name';
import { calculatePaidHours } from '@/lib/rota/pay-math';
import { countsTowardHours } from '@/lib/rota/shift-counting';
import {
  SHIFT_TEMPLATE_COLOURS,
  getShiftColourLabel,
  resolveShiftColour,
  shiftColourNeedsLightText,
} from '@/lib/rota/shift-template-colours';
import { CATEGORY, STAFF } from '@/lib/brand/palette';
import { rotaDepartmentCategory } from '@/lib/rota/status-ui';
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils';

// ---------------------------------------------------------------------------
// Helpers. Paid hours and the counting rule come from the shared rota modules.
// ---------------------------------------------------------------------------

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Paid hours come from the shared pure module. The copy that used to live here
// treated an equal start and end as a full 24 hours, so every absence marker
// (stored as 00:00:00 to 00:00:00) inflated the printed weekly total by a day.
function shiftPaidHours(shift: RotaShift): number {
  return calculatePaidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
}

// Hours are only ever shown on a row that actually counts. A sick or cancelled
// row still appears on the sheet, but printing hours beside it would not add up
// to the weekly total, which deliberately excludes it.
function shiftHoursSuffix(shift: RotaShift): string {
  return countsTowardHours(shift) ? ` · ${shiftPaidHours(shift).toFixed(1)}h` : '';
}

// Internal staff-facing sheet, so it shows the same preferred name as the on-screen rota.
function empDisplayName(emp: RotaEmployee): string {
  return displayName(emp);
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

// Only `scheduled` rows count, as a positive rule rather than an exclusion list.
// Absence and cancelled markers stay visible in the grid below but never add to
// the total staff read off the sheet.
function empWeekHours(employeeId: string, shifts: RotaShift[]): number {
  return shifts
    .filter(s => s.employee_id === employeeId && countsTowardHours(s))
    .reduce((sum, s) => sum + shiftPaidHours(s), 0);
}

// Names come from staff records and settings, so they are escaped before they go into the page
// the PDF renderer loads.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The shift's department, capitalised as payroll shows it. Every department that was not bar
// used to print as "Kitchen", runners and hosts included.
function departmentLabel(department: string): string {
  const name = department.trim().replace(/[_-]+/g, ' ');
  return escapeHtml(name.charAt(0).toUpperCase() + name.slice(1));
}

// ---------------------------------------------------------------------------
// Colours. A shift takes the colour /rota draws it in.
// ---------------------------------------------------------------------------

type ChipColours = { bg: string; border: string; fg: string };

/** White ink on the dark shift colours, as /rota draws it. */
const ON_DARK_TEXT = STAFF.primaryFg;

const SICK_CHIP: ChipColours = { bg: STAFF.dangerSoft, border: STAFF.dangerBorder, fg: STAFF.dangerFg };

/** The name /rota and its legend give a sick shift. The print said "Sick" until 18 Sep 2026. */
const COULDNT_WORK_LABEL = "Couldn't Work";

/** 20% opacity as the last two digits of a hex colour (0x33 is 51, a fifth of 255). */
const ALPHA_20 = '33';

// A department's own look, the same as rotaDepartmentClasses gives it on /rota: its category's
// soft background, dark text and a border of the category colour at 20% (border-cat-N/20), or the
// neutral chip for a department with no category.
function departmentChipColours(department: string): ChipColours {
  const category = rotaDepartmentCategory(department);
  if (!category) return { bg: STAFF.surface2, border: STAFF.border, fg: STAFF.textMuted };
  const { base, soft, fg } = CATEGORY[category - 1];
  return { bg: soft, border: `${base}${ALPHA_20}`, fg };
}

// The same choices as the shift blocks on /rota: the template or automatic colour, white text on
// the dark ones and a strong edge on white; a Couldn't Work shift in danger; and the department
// look when neither the template nor the role and start time give a colour. Each chip carries a
// 1px border, paid for with 1px less padding, so the white shifts show on white paper and the
// cell sizes do not change.
function shiftChipColours(shift: RotaShift, templateById: Map<string, ShiftTemplate>): ChipColours {
  if (shift.status === 'sick') return SICK_CHIP;
  const colour = resolveShiftColour(shift, shift.template_id ? templateById.get(shift.template_id) : null);
  if (!colour) return departmentChipColours(shift.department);
  return {
    bg: colour,
    border: getShiftColourLabel(colour) === 'White' ? STAFF.borderStrong : colour,
    fg: shiftColourNeedsLightText(colour) ? ON_DARK_TEXT : STAFF.text,
  };
}

function leaveChipColours(status: LeaveDayWithRequest['status']): ChipColours {
  return status === 'approved'
    ? { bg: STAFF.successSoft, border: STAFF.successBorder, fg: STAFF.successFg }
    : { bg: STAFF.warningSoft, border: STAFF.warningBorder, fg: STAFF.warningFg };
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
  templateById: Map<string, ShiftTemplate>,
): string {
  const cellShifts = shifts.filter(
    s => s.employee_id === employeeId && s.shift_date === date && s.status !== 'cancelled'
  );
  const cellLeave = leaveDays.find(l => l.employee_id === employeeId && l.leave_date === date);

  let leaveHtml = '';
  if (cellLeave) {
    const leave = leaveChipColours(cellLeave.status);
    leaveHtml = `<div style="text-align:center;border-radius:3px;font-size:${fs - 1}px;padding:0 2px;border:1px solid ${leave.border};margin-bottom:2px;font-weight:600;
        background:${leave.bg};
        color:${leave.fg}">
        ${cellLeave.status === 'approved' ? 'Holiday' : 'Holiday&nbsp;(P)'}
      </div>`;
  }

  const shiftsHtml = cellShifts.map(shift => {
    const isSick = shift.status === 'sick';
    const chip = shiftChipColours(shift, templateById);
    const nameHtml = shift.name
      ? `<div style="font-size:${fs - 1}px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(shift.name)}</div>`
      : '';
    return `<div style="background:${chip.bg};color:${chip.fg};border:1px solid ${chip.border};border-radius:3px;padding:1px 3px;margin-bottom:2px;font-size:${fs}px">
      ${nameHtml}
      <div style="font-weight:600">${formatTime(shift.start_time)}–${formatTime(shift.end_time)}</div>
      <div style="font-size:${fs - 1}px;opacity:0.85">${isSick ? COULDNT_WORK_LABEL : departmentLabel(shift.department)}${shiftHoursSuffix(shift)}</div>
    </div>`;
  }).join('');

  return `<td style="padding:3px 4px;border:1px solid ${STAFF.borderStrong};vertical-align:top">${leaveHtml}${shiftsHtml}</td>`;
}

function buildRotaHTML(
  week: RotaWeek,
  employees: RotaEmployee[],
  shifts: RotaShift[],
  leaveDays: LeaveDayWithRequest[],
  days: string[],
  generatedAt: string,
  templates: ShiftTemplate[],
): string {
  const templateById = new Map(templates.map(template => [template.id, template]));
  const openShifts = shifts.filter(s => s.is_open_shift || !s.employee_id);

  // Scale font sizes down when there are many employees so everything fits
  const rowCount = employees.length + (openShifts.length > 0 ? 1 : 0);
  const baseFontSize = rowCount <= 12 ? 10 : rowCount <= 16 ? 9 : 8;
  const headerFontSize = baseFontSize - 1;

  const dayHeaders = days.map(d => {
    const { weekday, date } = formatDayHeader(d);
    return `<th style="padding:4px 4px;border:1px solid ${STAFF.borderStrong};text-align:center;font-weight:600;color:${STAFF.text};font-size:${headerFontSize}px">
      <div>${weekday}</div>
      <div style="font-weight:400;color:${STAFF.textMuted};font-size:${headerFontSize - 1}px">${date}</div>
    </th>`;
  }).join('');

  const employeeRows = employees.map(emp => {
    const totalHrs = empWeekHours(emp.employee_id, shifts);
    const cells = days.map(d => buildShiftCell(shifts, leaveDays, emp.employee_id, d, baseFontSize, templateById)).join('');
    return `<tr>
      <td style="padding:4px 6px;border:1px solid ${STAFF.borderStrong};font-weight:600;font-size:${headerFontSize}px;vertical-align:top;word-break:break-word">
        ${escapeHtml(empDisplayName(emp))}
        ${emp.job_title ? `<div style="font-weight:400;color:${STAFF.textMuted};font-size:${headerFontSize - 1}px">${escapeHtml(emp.job_title)}</div>` : ''}
      </td>
      ${cells}
      <td style="padding:4px 4px;border:1px solid ${STAFF.borderStrong};text-align:center;font-weight:700;font-size:${headerFontSize}px;vertical-align:top;color:${totalHrs > 0 ? STAFF.text : STAFF.textMuted}">
        ${totalHrs > 0 ? totalHrs.toFixed(1) : '-'}
      </td>
    </tr>`;
  }).join('');

  const openShiftsRow = openShifts.length > 0 ? (() => {
    const cells = days.map(d => {
      const dayOpen = openShifts.filter(s => s.shift_date === d && s.status !== 'cancelled');
      const inner = dayOpen.map(shift => {
        const chip = shiftChipColours(shift, templateById);
        return `<div style="border-radius:3px;padding:1px 3px;border:1px solid ${chip.border};margin-bottom:2px;font-size:${baseFontSize}px;
          background:${chip.bg};color:${chip.fg}">
          <div style="font-weight:600">${formatTime(shift.start_time)}–${formatTime(shift.end_time)}</div>
          <div style="font-size:${baseFontSize - 1}px;opacity:0.85">${departmentLabel(shift.department)}${shiftHoursSuffix(shift)}</div>
        </div>`;
      }).join('');
      return `<td style="padding:3px 4px;border:1px solid ${STAFF.borderStrong};vertical-align:top">${inner}</td>`;
    }).join('');
    return `<tr style="background:${STAFF.warningSoft}">
      <td style="padding:4px 6px;border:1px solid ${STAFF.borderStrong};font-weight:600;font-size:${headerFontSize}px;vertical-align:top;color:${STAFF.warningFg}">Open shifts</td>
      ${cells}
      <td style="border:1px solid ${STAFF.borderStrong}"></td>
    </tr>`;
  })() : '';

  // Shift colours follow /rota, so the key is the /rota one: the eight shift colours in one
  // strip. The status chips keep their own entries.
  const shiftColourKey = `<span style="display:flex;align-items:center;gap:4px;font-size:9px;color:${STAFF.text}">
      <span style="display:inline-flex">${SHIFT_TEMPLATE_COLOURS.map(({ value }) =>
        `<span style="display:inline-block;width:5px;height:10px;background:${value};border:1px solid ${STAFF.borderStrong}"></span>`
      ).join('')}</span>
      Shift colour follows role and start time
    </span>`;
  const statusItems = [
    { colours: SICK_CHIP, label: COULDNT_WORK_LABEL },
    { colours: leaveChipColours('approved'), label: 'Holiday (approved)' },
    { colours: leaveChipColours('pending'), label: 'Holiday (pending)' },
  ].map(({ colours, label }) =>
    `<span style="display:flex;align-items:center;gap:4px;font-size:9px;color:${STAFF.text}">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colours.bg};border:1px solid ${colours.border}"></span>
      ${label}
    </span>`
  ).join('');
  const legendItems = shiftColourKey + statusItems;

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
    color: ${STAFF.text};
    background: ${STAFF.surface};
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
      <div style="font-size:11px;color:${STAFF.text};margin-top:2px">${formatWeekRange(days)}</div>
    </div>
    <div style="text-align:right">
      <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:600;
        background:${week.status === 'published' ? STAFF.successSoft : STAFF.warningSoft};
        color:${week.status === 'published' ? STAFF.successFg : STAFF.warningFg};margin-bottom:3px">
        ${week.status === 'published' ? 'Published' : 'Draft'}
      </span>
      <div style="font-size:9px;color:${STAFF.textMuted}">Printed ${generatedAt}</div>
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
      <tr style="background:${STAFF.surface2}">
        <th style="padding:4px 6px;border:1px solid ${STAFF.borderStrong};text-align:left;font-weight:600;color:${STAFF.text};font-size:${headerFontSize}px">Employee</th>
        ${dayHeaders}
        <th style="padding:4px 4px;border:1px solid ${STAFF.borderStrong};text-align:center;font-weight:600;color:${STAFF.text};font-size:${headerFontSize}px">Hrs</th>
      </tr>
    </thead>
    <tbody>
      ${employeeRows}
      ${openShiftsRow}
    </tbody>
  </table>

  <!-- Legend -->
  <div style="margin-top:8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <span style="font-size:9px;color:${STAFF.textMuted};font-weight:600">Legend:</span>
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
    // "Today" is a London date. A raw `new Date()` here printed the previous week
    // during the first hour of a British Summer Time Monday.
    return getMondayOfWeek(new Date(getTodayIsoDate() + 'T00:00:00Z')).toISOString().split('T')[0];
  })();

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split('T')[0];
  });

  // Fetch data
  const [weekResult, employeesResult, shiftsResult, leaveDaysResult, templatesResult] = await Promise.all([
    getOrCreateRotaWeek(weekStart),
    getActiveEmployeesForRota(weekStart),
    getWeekShifts(weekStart),
    getLeaveDaysForWeek(weekStart),
    getShiftTemplates(),
  ]);

  if (!weekResult.success) {
    return NextResponse.json({ error: 'Failed to load rota data' }, { status: 500 });
  }

  const week: RotaWeek = weekResult.data;
  const employees: RotaEmployee[] = employeesResult.success ? employeesResult.data : [];
  const shifts: RotaShift[] = shiftsResult.success ? shiftsResult.data : [];
  const leaveDays: LeaveDayWithRequest[] = leaveDaysResult.success ? leaveDaysResult.data : [];
  // Same as /rota: active templates only, and without them every shift takes its automatic colour.
  const templates: ShiftTemplate[] = templatesResult.success ? templatesResult.data.filter(t => t.is_active) : [];

  // London, not the server clock: the print stamp was an hour out through BST.
  const generatedAt = formatDateInLondon(new Date(), {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Build HTML
  const html = buildRotaHTML(week, employees, shifts, leaveDays, days, generatedAt, templates);

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
