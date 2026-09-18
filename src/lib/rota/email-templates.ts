import { format, parseISO } from 'date-fns';
import { STAFF } from '@/lib/brand/palette';

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
  totalPay: number | null; // null for salaried; premium-inclusive when set
  // Premium-rate breakdown (optional for backward compatibility with snapshots
  // frozen before the premium feature — treated as no premium when absent).
  standardHours?: number; // hours paid at the base rate
  premiumHours?: number;  // hours paid at the premium (effective) rate
};

export type LeavingEmployee = {
  name: string;
  employmentEndDate: string; // YYYY-MM-DD
};

export type PortalShiftEmailSummary = {
  employeeName?: string;
  date: string;
  startTime: string;
  endTime: string;
  department: string;
  templateName?: string | null;
  note?: string | null;
};

export type OpenShiftRequestDayContext = {
  date: string;
  shifts: Array<{
    employeeName: string;
    jobTitle?: string | null;
    startTime: string;
    endTime: string;
    department: string;
    templateName?: string | null;
    isOpenShift: boolean;
  }>;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shiftLine(shift: PortalShiftEmailSummary): string {
  const date = format(parseISO(shift.date), 'EEE d MMM yyyy');
  const name = shift.templateName ? ` — ${escapeHtml(shift.templateName)}` : '';
  return `${date}, ${escapeHtml(shift.startTime)} – ${escapeHtml(shift.endTime)} (${escapeHtml(shift.department)})${name}`;
}

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
        <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">${format(parseISO(s.date), 'EEE d MMM')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">${s.startTime} – ${s.endTime}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border};text-transform:capitalize">${s.department}</td>
      </tr>
    `).join('');

  const shiftsTable = (items: ShiftSummary[], headerBg: string) => `
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <thead>
        <tr style="background:${headerBg};color:${STAFF.primaryFg}">
          <th style="padding:8px 12px;text-align:left">Day</th>
          <th style="padding:8px 12px;text-align:left">Time</th>
          <th style="padding:8px 12px;text-align:left">Area</th>
        </tr>
      </thead>
      <tbody>${shiftRows(items)}</tbody>
    </table>
  `;

  const openShiftsSection = openShifts.length === 0 ? '' : `
    <div style="margin-top:32px;padding:16px 20px;background:${STAFF.warningSoft};border:1px solid ${STAFF.warningBorder};border-radius:6px">
      <h3 style="margin:0 0 8px;color:${STAFF.warningFg};font-size:16px">Shifts still to be filled</h3>
      <p style="margin:0 0 12px;color:${STAFF.warningFg};font-size:14px">
        The following shifts are still available this week. If you can help out, please let management know.
      </p>
      ${shiftsTable(openShifts, STAFF.warningFg)}
    </div>
  `;

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${STAFF.text}">Your shifts for ${weekLabel}</h2>
      <p>Hi ${employeeName},</p>
      <p>Here are your shifts for the coming week:</p>
      ${shifts.length > 0 ? shiftsTable(shifts, STAFF.primary) : `<p style="color:${STAFF.textMuted}">No shifts scheduled this week.</p>`}
      ${openShiftsSection}
      <div style="margin-top:24px">
        <a href="${APP_URL}/portal/shifts"
           style="display:inline-block;background:${STAFF.primary};color:${STAFF.primaryFg};padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px">
          View your rota
        </a>
      </div>
      <p style="color:${STAFF.textMuted};font-size:12px;margin-top:24px">The Anchor</p>
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
          <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">
            <span style="display:inline-block;background:${STAFF.successSoft};color:${STAFF.successFg};padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;margin-right:8px">Added</span>
            ${fmtShift(c.after!)}
          </td>
        </tr>`;
    }
    if (c.type === 'removed') {
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">
            <span style="display:inline-block;background:${STAFF.dangerSoft};color:${STAFF.dangerFg};padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;margin-right:8px">Removed</span>
            <span style="text-decoration:line-through;color:${STAFF.textMuted}">${fmtShift(c.before!)}</span>
          </td>
        </tr>`;
    }
    // modified
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">
          <span style="display:inline-block;background:${STAFF.warningSoft};color:${STAFF.warningFg};padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;margin-right:8px">Changed</span>
          <span style="text-decoration:line-through;color:${STAFF.textMuted}">${fmtShift(c.before!)}</span>
          <span style="margin:0 6px;color:${STAFF.textMuted}">→</span>
          ${fmtShift(c.after!)}
        </td>
      </tr>`;
  }).join('');

  const shiftRows = allShifts.map(s => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">${format(parseISO(s.date), 'EEE d MMM')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">${s.startTime} – ${s.endTime}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border};text-transform:capitalize">${s.department}</td>
    </tr>
  `).join('');

  const openShiftRows = openShifts.map(s => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">${format(parseISO(s.date), 'EEE d MMM')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">${s.startTime} – ${s.endTime}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border};text-transform:capitalize">${s.department}</td>
    </tr>
  `).join('');

  const openShiftsSection = openShifts.length === 0 ? '' : `
    <div style="margin-top:32px;padding:16px 20px;background:${STAFF.warningSoft};border:1px solid ${STAFF.warningBorder};border-radius:6px">
      <h3 style="margin:0 0 8px;color:${STAFF.warningFg};font-size:16px">Shifts still to be filled</h3>
      <p style="margin:0 0 12px;color:${STAFF.warningFg};font-size:14px">
        The following shifts are still available this week. If you can help out, please let management know.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0">
        <thead>
          <tr style="background:${STAFF.warningFg};color:${STAFF.primaryFg}">
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
        <tr style="background:${STAFF.primary};color:${STAFF.primaryFg}">
          <th style="padding:8px 12px;text-align:left">Day</th>
          <th style="padding:8px 12px;text-align:left">Time</th>
          <th style="padding:8px 12px;text-align:left">Area</th>
        </tr>
      </thead>
      <tbody>${shiftRows}</tbody>
    </table>
  ` : `<p style="color:${STAFF.textMuted}">No shifts scheduled for you this week.</p>`;

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${STAFF.text}">Your rota has been updated — ${weekLabel}</h2>
      <p>Hi ${employeeName},</p>
      <p>The rota for the coming week has been updated. Here's what changed for you:</p>

      <div style="background:${STAFF.surface2};border:1px solid ${STAFF.border};border-radius:6px;margin:16px 0;overflow:hidden">
        <div style="background:${STAFF.text};padding:10px 12px">
          <h3 style="color:${STAFF.primaryFg};margin:0;font-size:14px;font-weight:600">Changes to your shifts</h3>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <tbody>${changesHtml}</tbody>
        </table>
      </div>

      <h3 style="color:${STAFF.text};margin:24px 0 8px">Your full schedule this week</h3>
      ${scheduleSection}

      ${openShiftsSection}

      <div style="margin-top:24px">
        <a href="${APP_URL}/portal/shifts"
           style="display:inline-block;background:${STAFF.primary};color:${STAFF.primaryFg};padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px">
          View your rota
        </a>
      </div>
      <p style="color:${STAFF.textMuted};font-size:12px;margin-top:24px">The Anchor</p>
    </div>
  `;
}

/**
 * Sunday manager alert: next week's rota is not ready.
 */
/** An unfilled shift for the weekly manager chaser. */
export type UnfilledShiftSummary = PortalShiftEmailSummary & {
  /** Set when the shift is open because a staff member turned it down. */
  rejectedByName?: string | null;
  rejectionNote?: string | null;
};

function unfilledShiftLine(shift: UnfilledShiftSummary): string {
  const base = shiftLine(shift);
  if (!shift.rejectedByName) {
    return `<li style="margin-bottom:6px">${base}</li>`;
  }
  const note = shift.rejectionNote
    ? `<br><span style="color:${STAFF.textMuted};font-style:italic">${escapeHtml(shift.rejectionNote)}</span>`
    : '';
  return `<li style="margin-bottom:6px">${base}<br><span style="color:${STAFF.danger}">Turned down by ${escapeHtml(shift.rejectedByName)}</span>${note}</li>`;
}

export function buildManagerAlertEmailHtml(
  weekStart: string,
  reason: 'not_published' | 'unpublished_changes' | null,
  unfilledShifts: UnfilledShiftSummary[] = [],
): string {
  const weekLabel = format(parseISO(weekStart), 'd MMM yyyy');

  const publishBlock = reason
    ? `
      <p>${
        reason === 'not_published'
          ? `The rota for the week starting <strong>${weekLabel}</strong> has not been published yet.`
          : `The rota for the week starting <strong>${weekLabel}</strong> has unpublished changes.`
      }</p>
      <p>Staff emails are scheduled for 21:00. Please publish the rota before then.</p>
    `
    : '';

  const rejectedCount = unfilledShifts.filter(shift => shift.rejectedByName).length;
  const unfilledBlock = unfilledShifts.length
    ? `
      <h3 style="color:${STAFF.danger};margin-bottom:4px">${unfilledShifts.length} shift${unfilledShifts.length === 1 ? '' : 's'} still ${unfilledShifts.length === 1 ? 'needs' : 'need'} somebody</h3>
      <p style="margin-top:0;color:${STAFF.textMuted}">${
        rejectedCount > 0
          ? `${rejectedCount} of these ${rejectedCount === 1 ? 'was' : 'were'} turned down by staff and ${rejectedCount === 1 ? 'has' : 'have'} not been picked up.`
          : 'These are open shifts with nobody assigned.'
      }</p>
      <ul style="padding-left:18px">${unfilledShifts.map(unfilledShiftLine).join('')}</ul>
      <p>
        <a href="${APP_URL}/rota/reassign"
           style="background:${STAFF.danger};color:${STAFF.primaryFg};padding:10px 20px;border-radius:4px;text-decoration:none">
          Reassign these shifts
        </a>
      </p>
    `
    : '';

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${STAFF.danger}">Rota Action Required</h2>
      ${publishBlock}
      ${unfilledBlock}
      <p>
        <a href="${APP_URL}/rota"
           style="background:${STAFF.primary};color:${STAFF.primaryFg};padding:10px 20px;border-radius:4px;text-decoration:none">
          Open Rota
        </a>
      </p>
      <p style="color:${STAFF.textMuted};font-size:12px">The Anchor Management Tools</p>
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
      <h2 style="color:${STAFF.text}">Holiday Request Received</h2>
      <p>Hi ${employeeName},</p>
      <p>Your holiday request for <strong>${start} – ${end}</strong> has been submitted and is pending approval.</p>
      <p>You'll receive an email once it has been reviewed.</p>
      <p>
        <a href="${APP_URL}/portal/leave">View your requests</a>
      </p>
      <p style="color:${STAFF.textMuted};font-size:12px">The Anchor</p>
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
  const colour = isApproved ? STAFF.successFg : STAFF.danger;
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
      <p style="color:${STAFF.textMuted};font-size:12px">The Anchor</p>
    </div>
  `;
}

export function buildShiftRejectedManagerEmailHtml(
  shift: PortalShiftEmailSummary,
  rejectionNote?: string | null,
): string {
  const staffName = escapeHtml(shift.employeeName || 'A staff member');
  const noteHtml = rejectionNote?.trim()
    ? `<p><strong>Staff note:</strong> ${escapeHtml(rejectionNote.trim())}</p>`
    : '<p><strong>Staff note:</strong> No note provided.</p>';

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${STAFF.danger}">Shift Rejected</h2>
      <p>${staffName} rejected this shift:</p>
      <p><strong>${shiftLine(shift)}</strong></p>
      ${noteHtml}
      <p>The shift has been moved to open shifts.</p>
      <p>
        <a href="${APP_URL}/rota"
           style="display:inline-block;background:${STAFF.primary};color:${STAFF.primaryFg};padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px">
          Open rota
        </a>
      </p>
      <p style="color:${STAFF.textMuted};font-size:12px">The Anchor Management Tools</p>
    </div>
  `;
}

export function buildOpenShiftRequestManagerEmailHtml(
  shift: PortalShiftEmailSummary,
  requestNote?: string | null,
  options: {
    autoAcceptUrl?: string | null;
    openRotaUrl?: string | null;
    dayContext?: OpenShiftRequestDayContext[];
  } = {},
): string {
  const staffName = escapeHtml(shift.employeeName || 'A staff member');
  const noteHtml = requestNote?.trim()
    ? `<p><strong>Staff note:</strong> ${escapeHtml(requestNote.trim())}</p>`
    : '<p><strong>Staff note:</strong> No note provided.</p>';
  const autoAcceptUrl = options.autoAcceptUrl?.trim() || null;
  const openRotaUrl = options.openRotaUrl?.trim() || `${APP_URL}/rota`;
  const dayContext = options.dayContext ?? [];
  const contextHtml = dayContext.length > 0
    ? `
      <h3 style="color:${STAFF.text};margin-top:24px">Who's working around this shift</h3>
      ${dayContext.map(day => {
        const dateLabel = format(parseISO(day.date), 'EEE d MMM yyyy');
        const rows = day.shifts.length > 0
          ? day.shifts.map(item => {
              const title = item.templateName ? ` — ${escapeHtml(item.templateName)}` : '';
              const role = item.jobTitle ? `, ${escapeHtml(item.jobTitle)}` : '';
              const openLabel = item.isOpenShift ? ` <span style="color:${STAFF.warningFg}">(open)</span>` : '';
              return `<li><strong>${escapeHtml(item.startTime)}–${escapeHtml(item.endTime)}</strong> ${escapeHtml(item.employeeName)}${role} — ${escapeHtml(item.department)}${title}${openLabel}</li>`;
            }).join('')
          : '<li>No scheduled shifts listed.</li>';
        return `
          <div style="margin:12px 0">
            <p style="margin:0 0 4px 0"><strong>${escapeHtml(dateLabel)}</strong></p>
            <ul style="margin:0;padding-left:18px">${rows}</ul>
          </div>
        `;
      }).join('')}
    `
    : '';
  const autoAcceptButton = autoAcceptUrl
    ? `
      <a href="${escapeHtml(autoAcceptUrl)}"
         style="display:inline-block;background:${STAFF.primary};color:${STAFF.primaryFg};padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px;margin-right:8px">
        Auto-accept and publish
      </a>
    `
    : '';

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${STAFF.text}">Open Shift Request</h2>
      <p>${staffName} has asked to work this open shift:</p>
      <p><strong>${shiftLine(shift)}</strong></p>
      ${noteHtml}
      ${contextHtml}
      <p>If the requested shift is still open and unchanged, you can approve it here. If it has changed, this will open the rota instead.</p>
      <p>
        ${autoAcceptButton}
        <a href="${escapeHtml(openRotaUrl)}"
           style="display:inline-block;background:${STAFF.surfaceHover};color:${STAFF.text};padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px">
          Open rota
        </a>
      </p>
      <p style="color:${STAFF.textMuted};font-size:12px">The Anchor Management Tools</p>
    </div>
  `;
}

export function buildShiftAutoAcceptWarningEmailHtml(
  employeeName: string,
  shifts: PortalShiftEmailSummary[],
): string {
  const rows = shifts.map(shift => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">${format(parseISO(shift.date), 'EEE d MMM yyyy')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">${escapeHtml(shift.startTime)} – ${escapeHtml(shift.endTime)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border};text-transform:capitalize">${escapeHtml(shift.department)}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${STAFF.text}">Shift Acceptance Reminder</h2>
      <p>Hi ${escapeHtml(employeeName)},</p>
      <p>The following shifts are still waiting for you to accept or reject. They will be automatically accepted in 2 days.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:${STAFF.primary};color:${STAFF.primaryFg}">
            <th style="padding:8px 12px;text-align:left">Day</th>
            <th style="padding:8px 12px;text-align:left">Time</th>
            <th style="padding:8px 12px;text-align:left">Area</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p><strong>Policy:</strong> All shifts must be accepted or rejected no less than two weeks before the shift.</p>
      <p>
        <a href="${APP_URL}/portal/shifts"
           style="display:inline-block;background:${STAFF.primary};color:${STAFF.primaryFg};padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px">
          Review shifts
        </a>
      </p>
      <p style="color:${STAFF.textMuted};font-size:12px">The Anchor</p>
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
      <td style="padding:10px 14px;border-bottom:1px solid ${STAFF.dangerBorder};font-weight:600">${e.name}</td>
      <td style="padding:10px 14px;border-bottom:1px solid ${STAFF.dangerBorder};text-align:right;font-weight:700;color:${STAFF.dangerFg}">£${e.totalPay.toFixed(2)}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:${STAFF.danger};padding:20px 24px;border-radius:6px 6px 0 0">
        <h2 style="color:${STAFF.primaryFg};margin:0;font-size:20px">⚠ Action Required — Earnings Limit Alert</h2>
        <p style="color:${STAFF.dangerSoft};margin:6px 0 0;font-size:14px">${monthLabel} payroll</p>
      </div>
      <div style="background:${STAFF.dangerSoft};border:2px solid ${STAFF.danger};border-top:0;padding:20px 24px;border-radius:0 0 6px 6px">
        <p style="color:${STAFF.text};margin:0 0 12px">
          The following employee(s) earned <strong>over £833 this month</strong>.
          To keep them below the annual threshold, their hours should be reduced next month.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 16px">
          <thead>
            <tr style="background:${STAFF.dangerBorder}">
              <th style="padding:10px 14px;text-align:left;color:${STAFF.dangerFg}">Employee</th>
              <th style="padding:10px 14px;text-align:right;color:${STAFF.dangerFg}">Total Earned</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:${STAFF.dangerFg};font-size:14px;margin:0;font-weight:600">
          Please review their scheduled hours for next month as soon as possible.
        </p>
      </div>
      <p style="color:${STAFF.textMuted};font-size:12px;margin-top:16px">The Anchor — sent via management tools</p>
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
  const paid = employees.filter(e => e.totalPay !== null);
  const totalPay = paid.reduce((sum, e) => sum + (e.totalPay ?? 0), 0);
  const totalStandardHours = paid.reduce((sum, e) => sum + (e.standardHours ?? e.actualHours ?? 0), 0);
  const totalPremiumHours = paid.reduce((sum, e) => sum + (e.premiumHours ?? 0), 0);
  const anyPremium = totalPremiumHours > 0;

  const rows = paid
    .map(e => {
      // Back-compat: pre-feature summaries lack the split — treat as no premium.
      const premiumHours = e.premiumHours ?? 0;
      const standardHours = e.standardHours ?? e.actualHours ?? 0;
      return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border}">${e.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border};text-align:right">${standardHours.toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border};text-align:right">${premiumHours > 0 ? premiumHours.toFixed(2) : '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border};text-align:right">£${(e.hourlyRate ?? 0).toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.border};text-align:right"><strong>£${(e.totalPay ?? 0).toFixed(2)}</strong></td>
      </tr>
    `;
    }).join('');

  return `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <h2 style="color:${STAFF.text}">Payroll Summary — ${monthLabel}</h2>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:${STAFF.primary};color:${STAFF.primaryFg}">
            <th style="padding:8px 12px;text-align:left">Employee</th>
            <th style="padding:8px 12px;text-align:right">Standard Hours</th>
            <th style="padding:8px 12px;text-align:right">Premium Hours</th>
            <th style="padding:8px 12px;text-align:right">Base Rate</th>
            <th style="padding:8px 12px;text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="background:${STAFF.primarySoft}">
            <td style="padding:8px 12px"><strong>Total</strong></td>
            <td style="padding:8px 12px;text-align:right"><strong>${totalStandardHours.toFixed(2)}</strong></td>
            <td style="padding:8px 12px;text-align:right"><strong>${anyPremium ? totalPremiumHours.toFixed(2) : '—'}</strong></td>
            <td style="padding:8px 12px"></td>
            <td style="padding:8px 12px;text-align:right"><strong>£${totalPay.toFixed(2)}</strong></td>
          </tr>
        </tfoot>
      </table>
      <p style="color:${STAFF.textMuted};font-size:14px">
        Full shift-level detail is in the attached Excel file.
        Amounts are premium-inclusive; ${anyPremium
          ? 'premium hours are paid above the base rate (see the Excel for the multiplier and effective rate per shift).'
          : 'no premium hours applied this period.'}
        Salaried staff are excluded from the amounts above.
      </p>
      ${leavingEmployees.length > 0 ? `
      <div style="margin-top:24px;padding:16px;background:${STAFF.warningSoft};border:1px solid ${STAFF.warningBorder};border-radius:4px">
        <h3 style="color:${STAFF.warningFg};margin:0 0 12px">P45 Required — Employees Leaving This Period</h3>
        <p style="color:${STAFF.warningFg};font-size:14px;margin:0 0 12px">
          The following employees are in the process of leaving with an end date within this payroll period.
          Please prepare a P45 for each:
        </p>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:${STAFF.warningBorder}">
              <th style="padding:8px 12px;text-align:left;color:${STAFF.text}">Employee</th>
              <th style="padding:8px 12px;text-align:left;color:${STAFF.text}">Employment End Date</th>
            </tr>
          </thead>
          <tbody>
            ${leavingEmployees.map(e => `
              <tr>
                <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.warningBorder}">${e.name}</td>
                <td style="padding:8px 12px;border-bottom:1px solid ${STAFF.warningBorder}">${format(parseISO(e.employmentEndDate), 'd MMMM yyyy')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}
      <p style="color:${STAFF.textMuted};font-size:12px">The Anchor — sent via management tools</p>
    </div>
  `;
}
