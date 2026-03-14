import { format, parseISO } from 'date-fns';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';

export type ShiftSummary = {
  date: string;       // ISO date
  startTime: string;  // "HH:mm"
  endTime: string;    // "HH:mm"
  department: string;
  templateName: string;
};

export type ShiftChange = {
  type: 'added' | 'removed' | 'modified';
  before?: ShiftSummary; // present for 'removed' and 'modified'
  after?: ShiftSummary;  // present for 'added' and 'modified'
};

export type PayrollEmployeeSummary = {
  name: string;
  plannedHours: number;
  actualHours: number;
  hourlyRate: number | null;
  totalPay: number | null; // null for salaried
};

export type LeavingEmployee = {
  name: string;
  employmentEndDate: string; // YYYY-MM-DD
};

/**
 * Weekly rota email sent to each staff member on Sunday evening.
 */
export function buildStaffRotaEmailHtml(
  employeeName: string,
  weekStart: string, // ISO date (Monday)
  weekEnd: string,   // ISO date (Sunday)
  shifts: ShiftSummary[],
  openShifts: ShiftSummary[] = [],
): string {
  const weekLabel = `${format(parseISO(weekStart), 'd MMM')} – ${format(parseISO(weekEnd), 'd MMM yyyy')}`;

  const shiftRows = (items: ShiftSummary[]) =>
    items.map(s => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${format(parseISO(s.date), 'EEE d MMM')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${s.startTime} – ${s.endTime}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-transform:capitalize">${s.department}</td>
      </tr>
    `).join('');

  const shiftsTable = (items: ShiftSummary[], headerBg: string) => `
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <thead>
        <tr style="background:${headerBg};color:#fff">
          <th style="padding:8px 12px;text-align:left">Day</th>
          <th style="padding:8px 12px;text-align:left">Time</th>
          <th style="padding:8px 12px;text-align:left">Area</th>
        </tr>
      </thead>
      <tbody>${shiftRows(items)}</tbody>
    </table>
  `;

  const openShiftsSection = openShifts.length === 0 ? '' : `
    <div style="margin-top:32px;padding:16px 20px;background:#fff8e1;border:1px solid #f59e0b;border-radius:6px">
      <h3 style="margin:0 0 8px;color:#92400e;font-size:16px">Shifts still to be filled</h3>
      <p style="margin:0 0 12px;color:#78350f;font-size:14px">
        The following shifts are still available this week. If you can help out, please let management know.
      </p>
      ${shiftsTable(openShifts, '#b45309')}
    </div>
  `;

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1a1a1a">Your shifts for ${weekLabel}</h2>
      <p>Hi ${employeeName},</p>
      <p>Here are your shifts for the coming week:</p>
      ${shifts.length > 0 ? shiftsTable(shifts, '#1F5C2E') : '<p style="color:#666">No shifts scheduled this week.</p>'}
      ${openShiftsSection}
      <div style="margin-top:24px">
        <a href="${APP_URL}/portal/shifts"
           style="display:inline-block;background:#1F5C2E;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px">
          View your rota
        </a>
      </div>
      <p style="color:#aaa;font-size:12px;margin-top:24px">The Anchor</p>
    </div>
  `;
}

/**
 * Rota update email sent only to staff whose shifts changed after a re-publish.
 * Shows a "what changed" section followed by their full schedule for the week.
 */
export function buildRotaChangeEmailHtml(
  employeeName: string,
  weekStart: string,
  weekEnd: string,
  changes: ShiftChange[],
  allShifts: ShiftSummary[],
  openShifts: ShiftSummary[] = [],
): string {
  const weekLabel = `${format(parseISO(weekStart), 'd MMM')} – ${format(parseISO(weekEnd), 'd MMM yyyy')}`;

  const fmtShift = (s: ShiftSummary) =>
    `${format(parseISO(s.date), 'EEE d MMM')}, ${s.startTime} – ${s.endTime} (${s.department})`;

  const changesHtml = changes.map(c => {
    if (c.type === 'added') {
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">
            <span style="display:inline-block;background:#dcfce7;color:#166534;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;margin-right:8px">Added</span>
            ${fmtShift(c.after!)}
          </td>
        </tr>`;
    }
    if (c.type === 'removed') {
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">
            <span style="display:inline-block;background:#fee2e2;color:#991b1b;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;margin-right:8px">Removed</span>
            <span style="text-decoration:line-through;color:#666">${fmtShift(c.before!)}</span>
          </td>
        </tr>`;
    }
    // modified
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">
          <span style="display:inline-block;background:#fef9c3;color:#854d0e;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;margin-right:8px">Changed</span>
          <span style="text-decoration:line-through;color:#666">${fmtShift(c.before!)}</span>
          <span style="margin:0 6px;color:#999">→</span>
          ${fmtShift(c.after!)}
        </td>
      </tr>`;
  }).join('');

  const shiftRows = allShifts.map(s => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${format(parseISO(s.date), 'EEE d MMM')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${s.startTime} – ${s.endTime}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-transform:capitalize">${s.department}</td>
    </tr>
  `).join('');

  const openShiftRows = openShifts.map(s => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${format(parseISO(s.date), 'EEE d MMM')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${s.startTime} – ${s.endTime}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-transform:capitalize">${s.department}</td>
    </tr>
  `).join('');

  const openShiftsSection = openShifts.length === 0 ? '' : `
    <div style="margin-top:32px;padding:16px 20px;background:#fff8e1;border:1px solid #f59e0b;border-radius:6px">
      <h3 style="margin:0 0 8px;color:#92400e;font-size:16px">Shifts still to be filled</h3>
      <p style="margin:0 0 12px;color:#78350f;font-size:14px">
        The following shifts are still available this week. If you can help out, please let management know.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0">
        <thead>
          <tr style="background:#b45309;color:#fff">
            <th style="padding:8px 12px;text-align:left">Day</th>
            <th style="padding:8px 12px;text-align:left">Time</th>
            <th style="padding:8px 12px;text-align:left">Area</th>
          </tr>
        </thead>
        <tbody>${openShiftRows}</tbody>
      </table>
    </div>
  `;

  const scheduleSection = allShifts.length > 0 ? `
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <thead>
        <tr style="background:#1F5C2E;color:#fff">
          <th style="padding:8px 12px;text-align:left">Day</th>
          <th style="padding:8px 12px;text-align:left">Time</th>
          <th style="padding:8px 12px;text-align:left">Area</th>
        </tr>
      </thead>
      <tbody>${shiftRows}</tbody>
    </table>
  ` : '<p style="color:#666">No shifts scheduled for you this week.</p>';

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1a1a1a">Your rota has been updated — ${weekLabel}</h2>
      <p>Hi ${employeeName},</p>
      <p>The rota for the coming week has been updated. Here's what changed for you:</p>

      <div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;margin:16px 0;overflow:hidden">
        <div style="background:#374151;padding:10px 12px">
          <h3 style="color:#fff;margin:0;font-size:14px;font-weight:600">Changes to your shifts</h3>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <tbody>${changesHtml}</tbody>
        </table>
      </div>

      <h3 style="color:#1a1a1a;margin:24px 0 8px">Your full schedule this week</h3>
      ${scheduleSection}

      ${openShiftsSection}

      <div style="margin-top:24px">
        <a href="${APP_URL}/portal/shifts"
           style="display:inline-block;background:#1F5C2E;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px">
          View your rota
        </a>
      </div>
      <p style="color:#aaa;font-size:12px;margin-top:24px">The Anchor</p>
    </div>
  `;
}

/**
 * Sunday manager alert: next week's rota is not ready.
 */
export function buildManagerAlertEmailHtml(
  weekStart: string,
  reason: 'not_published' | 'unpublished_changes',
): string {
  const weekLabel = format(parseISO(weekStart), 'd MMM yyyy');
  const message = reason === 'not_published'
    ? `The rota for the week starting <strong>${weekLabel}</strong> has not been published yet.`
    : `The rota for the week starting <strong>${weekLabel}</strong> has unpublished changes.`;

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#b91c1c">Rota Action Required</h2>
      <p>${message}</p>
      <p>Staff emails are scheduled for 21:00. Please publish the rota before then.</p>
      <p>
        <a href="${APP_URL}/rota"
           style="background:#1F5C2E;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none">
          Open Rota
        </a>
      </p>
      <p style="color:#aaa;font-size:12px">The Anchor Management Tools</p>
    </div>
  `;
}

/**
 * Holiday request confirmation sent to employee on submission.
 */
export function buildHolidaySubmittedEmailHtml(
  employeeName: string,
  startDate: string,
  endDate: string,
): string {
  const start = format(parseISO(startDate), 'd MMM yyyy');
  const end = format(parseISO(endDate), 'd MMM yyyy');

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1a1a1a">Holiday Request Received</h2>
      <p>Hi ${employeeName},</p>
      <p>Your holiday request for <strong>${start} – ${end}</strong> has been submitted and is pending approval.</p>
      <p>You'll receive an email once it has been reviewed.</p>
      <p>
        <a href="${APP_URL}/portal/leave">View your requests</a>
      </p>
      <p style="color:#aaa;font-size:12px">The Anchor</p>
    </div>
  `;
}

/**
 * Holiday decision (approved or declined) sent to employee.
 */
export function buildHolidayDecisionEmailHtml(
  employeeName: string,
  startDate: string,
  endDate: string,
  status: 'approved' | 'declined',
  managerNote?: string,
): string {
  const start = format(parseISO(startDate), 'd MMM yyyy');
  const end = format(parseISO(endDate), 'd MMM yyyy');
  const isApproved = status === 'approved';
  const colour = isApproved ? '#15803d' : '#b91c1c';
  const label = isApproved ? 'Approved' : 'Declined';

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${colour}">Holiday Request ${label}</h2>
      <p>Hi ${employeeName},</p>
      <p>
        Your holiday request for <strong>${start} – ${end}</strong> has been
        <strong style="color:${colour}">${label.toLowerCase()}</strong>.
      </p>
      ${managerNote ? `<p><em>${managerNote}</em></p>` : ''}
      <p>
        <a href="${APP_URL}/portal/leave">View your holiday requests</a>
      </p>
      <p style="color:#aaa;font-size:12px">The Anchor</p>
    </div>
  `;
}

/**
 * Urgent manager alert: employees who earned over £833 this month.
 * Sent alongside the payroll email so the manager can reduce hours next month.
 */
export function buildEarningsAlertEmailHtml(
  year: number,
  month: number,
  overThreshold: { name: string; totalPay: number }[],
): string {
  const monthLabel = format(new Date(year, month - 1, 1), 'MMMM yyyy');

  const rows = overThreshold.map(e => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #f5c6cb;font-weight:600">${e.name}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f5c6cb;text-align:right;font-weight:700;color:#7b1e1e">£${e.totalPay.toFixed(2)}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#b91c1c;padding:20px 24px;border-radius:6px 6px 0 0">
        <h2 style="color:#fff;margin:0;font-size:20px">⚠ Action Required — Earnings Limit Alert</h2>
        <p style="color:#fca5a5;margin:6px 0 0;font-size:14px">${monthLabel} payroll</p>
      </div>
      <div style="background:#fff5f5;border:2px solid #b91c1c;border-top:0;padding:20px 24px;border-radius:0 0 6px 6px">
        <p style="color:#1a1a1a;margin:0 0 12px">
          The following employee(s) earned <strong>over £833 this month</strong>.
          To keep them below the annual threshold, their hours should be reduced next month.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 16px">
          <thead>
            <tr style="background:#fecaca">
              <th style="padding:10px 14px;text-align:left;color:#7b1e1e">Employee</th>
              <th style="padding:10px 14px;text-align:right;color:#7b1e1e">Total Earned</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#7b1e1e;font-size:14px;margin:0;font-weight:600">
          Please review their scheduled hours for next month as soon as possible.
        </p>
      </div>
      <p style="color:#aaa;font-size:12px;margin-top:16px">The Anchor — sent via management tools</p>
    </div>
  `;
}

/**
 * Payroll email body sent to accountant with per-employee summary.
 * Returns plain text for the email body (Excel detail is in attachment).
 */
export function buildPayrollEmailHtml(
  year: number,
  month: number,
  employees: PayrollEmployeeSummary[],
  leavingEmployees: LeavingEmployee[] = [],
): string {
  const monthLabel = format(new Date(year, month - 1, 1), 'MMMM yyyy');
  const totalPay = employees.reduce((sum, e) => sum + (e.totalPay ?? 0), 0);

  const rows = employees
    .filter(e => e.totalPay !== null)
    .map(e => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${e.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${e.actualHours.toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">£${(e.hourlyRate ?? 0).toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right"><strong>£${(e.totalPay ?? 0).toFixed(2)}</strong></td>
      </tr>
    `).join('');

  return `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <h2 style="color:#1a1a1a">Payroll Summary — ${monthLabel}</h2>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:#1F5C2E;color:#fff">
            <th style="padding:8px 12px;text-align:left">Employee</th>
            <th style="padding:8px 12px;text-align:right">Hours</th>
            <th style="padding:8px 12px;text-align:right">Rate</th>
            <th style="padding:8px 12px;text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="background:#e8f5e9">
            <td colspan="3" style="padding:8px 12px"><strong>Total</strong></td>
            <td style="padding:8px 12px;text-align:right"><strong>£${totalPay.toFixed(2)}</strong></td>
          </tr>
        </tfoot>
      </table>
      <p style="color:#666;font-size:14px">
        Full shift-level detail is in the attached Excel file.
        Salaried staff are excluded from the amounts above.
      </p>
      ${leavingEmployees.length > 0 ? `
      <div style="margin-top:24px;padding:16px;background:#fff3cd;border:1px solid #ffc107;border-radius:4px">
        <h3 style="color:#856404;margin:0 0 12px">P45 Required — Employees Leaving This Period</h3>
        <p style="color:#856404;font-size:14px;margin:0 0 12px">
          The following employees are in the process of leaving with an end date within this payroll period.
          Please prepare a P45 for each:
        </p>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#ffc107">
              <th style="padding:8px 12px;text-align:left;color:#1a1a1a">Employee</th>
              <th style="padding:8px 12px;text-align:left;color:#1a1a1a">Employment End Date</th>
            </tr>
          </thead>
          <tbody>
            ${leavingEmployees.map(e => `
              <tr>
                <td style="padding:8px 12px;border-bottom:1px solid #ffc107">${e.name}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #ffc107">${format(parseISO(e.employmentEndDate), 'd MMMM yyyy')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}
      <p style="color:#aaa;font-size:12px">The Anchor — sent via management tools</p>
    </div>
  `;
}
