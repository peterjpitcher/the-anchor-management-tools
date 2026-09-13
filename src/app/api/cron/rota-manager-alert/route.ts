import { NextResponse } from 'next/server';
import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { queueManagerReportEmail } from '@/lib/manager-report/queue';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { displayName } from '@/lib/employees/display-name';
import {
  getUnfilledShifts,
  addDaysIso,
  type UnfilledShift,
  type UnfilledQueryFailure as QueryFailure,
} from '@/lib/rota/unfilled-shifts';
import { resolveRotaManagerEmail } from '@/lib/rota/manager-email';
import {
  readinessWeekFromRow,
  summariseRotaReadiness,
  type RotaWeekReadiness,
  type RotaWeekReadinessInput,
} from '@/lib/rota/week-readiness';
import type { PublishedShiftSnapshot, RotaPublishShift } from '@/lib/rota/publish-status';
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils';

// Prepare a fresh snapshot at 08:00 London on Friday, before the combined manager report.
const TIMEZONE = 'Europe/London';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';

/**
 * How far ahead this alert looks. One horizon, used for both halves of the email:
 * unfilled shifts and week readiness. It was already 56 days for unfilled shifts
 * (rejections land at least 14 days before a shift, so a week-ahead window missed
 * most of them) and publish readiness now uses the same 56 days deliberately, so a
 * manager is never told about two different planning windows in one email.
 *
 * Before this, readiness was checked for next Monday alone, which is how a week
 * three weeks out came to sit with 28 shifts staff could not see.
 */
const HORIZON_DAYS = 56;
const HORIZON_WEEKS = Math.ceil(HORIZON_DAYS / 7);

/** Rows of detail shown per section before the email switches to "and N more". */
const MAX_DETAIL_ROWS = 5;

type WeekRow = {
  id: string;
  week_start: string;
  status: string | null;
  published_at: string | null;
};

type LiveShiftRow = RotaPublishShift & { week_id: string };
type PublishedShiftRow = PublishedShiftSnapshot & { week_id: string };

type EmployeeNameRow = {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

type PendingLeaveRow = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  created_at: string;
};

type PendingLeave = {
  employeeName: string;
  startDate: string;
  endDate: string;
  requestedAt: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDayLabel(isoDate: string): string {
  return formatDateInLondon(isoDate + 'T00:00:00Z', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatWeekLabel(isoDate: string): string {
  return formatDateInLondon(isoDate + 'T00:00:00Z', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * Unfilled shifts from today up to the horizon, annotated with the rejection that
 * freed them where there was one. The error is returned rather than swallowed.
 */

/**
 * Leave requests still waiting for a decision, most urgent first, which means the
 * leave that starts soonest rather than the request that was raised first. Names and
 * dates only: the manager's own note is personal and belongs on the leave page,
 * behind its permission check, not in an inbox.
 */
async function getPendingLeave(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ leave: PendingLeave[]; failures: QueryFailure[] }> {
  const failures: QueryFailure[] = [];

  const { data: leaveRows, error: leaveError } = await supabase
    .from('leave_requests')
    .select('id, employee_id, start_date, end_date, created_at')
    .eq('status', 'pending')
    .order('start_date', { ascending: true })
    .order('created_at', { ascending: true });

  if (leaveError) {
    return { leave: [], failures: [{ step: 'pending_leave', message: leaveError.message }] };
  }

  const requests = (leaveRows ?? []) as PendingLeaveRow[];
  if (requests.length === 0) return { leave: [], failures };

  const employeeIds = [...new Set(requests.map(request => request.employee_id))];
  const { data: employeeRows, error: employeesError } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name, preferred_name')
    .in('employee_id', employeeIds);

  if (employeesError) {
    failures.push({ step: 'leave_employee_names', message: employeesError.message });
  }

  const nameById = new Map<string, string>(
    ((employeeRows ?? []) as EmployeeNameRow[]).map(row => [row.employee_id, displayName(row, 'a staff member')]),
  );

  return {
    leave: requests.map(request => ({
      employeeName: nameById.get(request.employee_id) ?? 'a staff member',
      startDate: request.start_date,
      endDate: request.end_date,
      requestedAt: request.created_at,
    })),
    failures,
  };
}

/**
 * Which weeks the manager is actually asked to do something about.
 *
 * Reporting every week in the horizon that is not `published_current` would put
 * eight "not ready" lines in front of a manager every Sunday, and an alert that is
 * always red is an alert nobody reads. A week earns its place when:
 *
 *   - it is next week, which is emailed to staff at 21:00 tonight, or
 *   - it holds shifts staff cannot see, or ghost shifts they can still see, or
 *   - it sits before a week that is already published, which is the out-of-order
 *     hole a per-week flag can never spot.
 *
 * A far-out week with nothing on it yet is normal planning, not a problem. The
 * required publish lead time is still an open question; when one is agreed this is
 * the single place it belongs.
 */
function weekNeedsAttention(
  readiness: RotaWeekReadiness,
  index: number,
  lastPublishedIndex: number,
): boolean {
  if (readiness.state === 'published_current') return false;
  if (index === 0) return true;
  if (readiness.unpublishedCount > 0 || readiness.removedCount > 0) return true;
  return index < lastPublishedIndex;
}

function readinessStateLabel(state: RotaWeekReadiness['state']): string {
  switch (state) {
    case 'missing':
      return 'no rota week yet';
    case 'draft':
      return 'still a draft';
    case 'published_stale':
      return 'published but out of date';
    default:
      return 'ready';
  }
}

function moreLine(shown: number, total: number, noun: string): string {
  if (total <= shown) return '';
  const remaining = total - shown;
  return `<p style="margin:6px 0 0;color:#666">and ${remaining} more ${plural(remaining, noun, `${noun}s`)}.</p>`;
}

function button(href: string, label: string, background: string): string {
  return `<p style="margin:12px 0 0">
      <a href="${href}" style="background:${background};color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none">${escapeHtml(label)}</a>
    </p>`;
}

function unfilledShiftLine(shift: UnfilledShift): string {
  const template = shift.templateName ? `, ${escapeHtml(shift.templateName)}` : '';
  const base = `${escapeHtml(formatDayLabel(shift.date))}, ${escapeHtml(formatTime12Hour(shift.startTime))} to ${escapeHtml(formatTime12Hour(shift.endTime))} (${escapeHtml(shift.department)})${template}`;
  if (!shift.rejectedByName) {
    return `<li style="margin-bottom:6px">${base}</li>`;
  }
  const note = shift.rejectionNote
    ? `<br><span style="color:#666;font-style:italic">${escapeHtml(shift.rejectionNote)}</span>`
    : '';
  return `<li style="margin-bottom:6px">${base}<br><span style="color:#b91c1c">Turned down by ${escapeHtml(shift.rejectedByName)}</span>${note}</li>`;
}

function pendingLeaveLine(leave: PendingLeave): string {
  const range = leave.startDate === leave.endDate
    ? formatDayLabel(leave.startDate)
    : `${formatDayLabel(leave.startDate)} to ${formatDayLabel(leave.endDate)}`;
  const asked = formatDateInLondon(leave.requestedAt, { day: 'numeric', month: 'short' });
  return `<li style="margin-bottom:6px">${escapeHtml(leave.employeeName)}, ${escapeHtml(range)} <span style="color:#666">(asked ${escapeHtml(asked)})</span></li>`;
}

function weekReadinessLine(readiness: RotaWeekReadiness): string {
  const reasons = readiness.reasons.length
    ? `<br><span style="color:#666">${escapeHtml(readiness.reasons.join(' '))}</span>`
    : '';
  return `<li style="margin-bottom:8px"><strong>Week of ${escapeHtml(formatWeekLabel(readiness.weekStart))}</strong>: ${escapeHtml(readinessStateLabel(readiness.state))}${reasons}</li>`;
}

/**
 * The Sunday manager email. Built here rather than in `@/lib/rota/email-templates`
 * because it now carries three grouped sections that the old single-week template
 * has no shape for. Worth moving into the shared template module when that file is
 * next touched.
 */
function buildRotaAlertEmailHtml(input: {
  weeksNeedingAttention: RotaWeekReadiness[];
  unfilledShifts: UnfilledShift[];
  pendingLeave: PendingLeave[];
  failures: QueryFailure[];
}): string {
  const weekBlock = input.weeksNeedingAttention.length
    ? `
      <h3 style="color:#b91c1c;margin-bottom:4px">${input.weeksNeedingAttention.length} ${plural(input.weeksNeedingAttention.length, 'week is', 'weeks are')} not ready for staff</h3>
      <p style="margin-top:0;color:#666">Checked over the next ${HORIZON_WEEKS} weeks.</p>
      <ul style="padding-left:18px;margin:0">${input.weeksNeedingAttention.slice(0, MAX_DETAIL_ROWS).map(weekReadinessLine).join('')}</ul>
      ${moreLine(MAX_DETAIL_ROWS, input.weeksNeedingAttention.length, 'week')}
      ${button(`${APP_URL}/rota`, 'Open the rota', '#b91c1c')}
    `
    : '';

  const rejectedCount = input.unfilledShifts.filter(shift => shift.rejectedByName).length;
  const unfilledBlock = input.unfilledShifts.length
    ? `
      <h3 style="color:#b91c1c;margin-bottom:4px">${input.unfilledShifts.length} ${plural(input.unfilledShifts.length, 'shift still needs', 'shifts still need')} somebody</h3>
      <p style="margin-top:0;color:#666">${
        rejectedCount > 0
          ? `${rejectedCount} of these ${plural(rejectedCount, 'was', 'were')} turned down by staff and ${plural(rejectedCount, 'has', 'have')} not been picked up.`
          : 'These are open shifts with nobody assigned.'
      }</p>
      <ul style="padding-left:18px;margin:0">${input.unfilledShifts.slice(0, MAX_DETAIL_ROWS).map(unfilledShiftLine).join('')}</ul>
      ${moreLine(MAX_DETAIL_ROWS, input.unfilledShifts.length, 'shift')}
      ${button(`${APP_URL}/rota/reassign`, 'Reassign these shifts', '#b91c1c')}
    `
    : '';

  const leaveBlock = input.pendingLeave.length
    ? `
      <h3 style="color:#92400e;margin-bottom:4px">${input.pendingLeave.length} holiday ${plural(input.pendingLeave.length, 'request is', 'requests are')} waiting for a decision</h3>
      <p style="margin-top:0;color:#666">Soonest first. Full details are on the leave page.</p>
      <ul style="padding-left:18px;margin:0">${input.pendingLeave.slice(0, MAX_DETAIL_ROWS).map(pendingLeaveLine).join('')}</ul>
      ${moreLine(MAX_DETAIL_ROWS, input.pendingLeave.length, 'request')}
      ${button(`${APP_URL}/rota/leave`, 'Review holiday requests', '#92400e')}
    `
    : '';

  const failureBlock = input.failures.length
    ? `
      <h3 style="color:#92400e;margin-bottom:4px">Some checks could not run</h3>
      <p style="margin-top:0;color:#666">This email may be incomplete. Please check the rota directly.</p>
      <ul style="padding-left:18px;margin:0">${input.failures
        .map(failure => `<li style="margin-bottom:4px">${escapeHtml(failure.step)}: ${escapeHtml(failure.message)}</li>`)
        .join('')}</ul>
    `
    : '';

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#b91c1c">Rota Action Required</h2>
      ${weekBlock}
      ${unfilledBlock}
      ${leaveBlock}
      ${failureBlock}
      <p style="color:#aaa;font-size:12px">The Anchor Management Tools</p>
    </div>
  `;
}

function getNextMondayIso(nowUtc: Date): string {
  const nowLocal = toZonedTime(nowUtc, TIMEZONE);
  const day = nowLocal.getDay(); // 0=Sun, 1=Mon...
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  const nextMon = new Date(nowLocal.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
  return formatInTimeZone(nextMon, TIMEZONE, 'yyyy-MM-dd');
}

/** Week readiness across the horizon, and the `rota_weeks` ids behind it. */
async function getWeekReadiness(
  supabase: ReturnType<typeof createAdminClient>,
  firstWeekStart: string,
): Promise<{
  byWeek: RotaWeekReadiness[];
  lastPublishedIndex: number;
  weekIdByStart: Map<string, string>;
  failures: QueryFailure[];
}> {
  const weekStarts = Array.from({ length: HORIZON_WEEKS }, (_, index) => addDaysIso(firstWeekStart, index * 7));
  const lastWeekStart = weekStarts[weekStarts.length - 1];

  const { data: weekRows, error: weeksError } = await supabase
    .from('rota_weeks')
    .select('id, week_start, status, published_at')
    .gte('week_start', firstWeekStart)
    .lte('week_start', lastWeekStart);

  if (weeksError) {
    return {
      byWeek: [],
      lastPublishedIndex: -1,
      weekIdByStart: new Map(),
      failures: [{ step: 'rota_weeks', message: weeksError.message }],
    };
  }

  const weeks = (weekRows ?? []) as WeekRow[];
  const weekByStart = new Map(weeks.map(week => [week.week_start, week]));
  const weekIds = weeks.map(week => week.id);

  const failures: QueryFailure[] = [];
  let liveShifts: LiveShiftRow[] = [];
  let publishedShifts: PublishedShiftRow[] = [];

  if (weekIds.length > 0) {
    const [liveResult, publishedResult] = await Promise.all([
      supabase
        .from('rota_shifts')
        .select(
          'id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, reassignment_reason, created_at, updated_at',
        )
        .in('week_id', weekIds),
      supabase
        .from('rota_published_shifts')
        .select(
          'id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name',
        )
        .in('week_id', weekIds),
    ]);

    if (liveResult.error) failures.push({ step: 'rota_shifts', message: liveResult.error.message });
    if (publishedResult.error) failures.push({ step: 'rota_published_shifts', message: publishedResult.error.message });

    // A half-read diff would report a healthy week as stale, or worse, a stale week
    // as healthy. Better to report the failure than to publish a wrong verdict.
    if (liveResult.error || publishedResult.error) {
      return { byWeek: [], lastPublishedIndex: -1, weekIdByStart: new Map(), failures };
    }

    liveShifts = (liveResult.data ?? []) as LiveShiftRow[];
    publishedShifts = (publishedResult.data ?? []) as PublishedShiftRow[];
  }

  const liveByWeekId = new Map<string, RotaPublishShift[]>();
  for (const shift of liveShifts) {
    const existing = liveByWeekId.get(shift.week_id) ?? [];
    existing.push(shift);
    liveByWeekId.set(shift.week_id, existing);
  }

  const publishedByWeekId = new Map<string, PublishedShiftSnapshot[]>();
  for (const shift of publishedShifts) {
    const existing = publishedByWeekId.get(shift.week_id) ?? [];
    existing.push(shift);
    publishedByWeekId.set(shift.week_id, existing);
  }

  const inputs: RotaWeekReadinessInput[] = weekStarts.map(weekStart => {
    const row = weekByStart.get(weekStart) ?? null;
    return {
      week: readinessWeekFromRow(weekStart, row),
      liveShifts: row ? (liveByWeekId.get(row.id) ?? []) : [],
      publishedShifts: row ? (publishedByWeekId.get(row.id) ?? []) : [],
    };
  });

  let lastPublishedIndex = -1;
  for (let index = weekStarts.length - 1; index >= 0; index -= 1) {
    const row = weekByStart.get(weekStarts[index]);
    if (row?.status === 'published' && row.published_at) {
      lastPublishedIndex = index;
      break;
    }
  }

  return {
    byWeek: summariseRotaReadiness(inputs, HORIZON_WEEKS).byWeek,
    lastPublishedIndex,
    weekIdByStart: new Map(weeks.map(week => [week.week_start, week.id])),
    failures,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const authResult = authorizeCronRequest(request);
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowUtc = new Date();
  const nowLocal = toZonedTime(nowUtc, TIMEZONE);

  if (nowLocal.getDay() !== 5 || nowLocal.getHours() !== 8) {
    return NextResponse.json({ skipped: true, reason: 'Not Friday 08:00 London' });
  }

  const firstWeekStart = getNextMondayIso(nowUtc);
  const todayIso = formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd');
  const supabase = createAdminClient();

  const [readinessResult, unfilledResult, leaveResult] = await Promise.all([
    getWeekReadiness(supabase, firstWeekStart),
    getUnfilledShifts(supabase, todayIso, HORIZON_DAYS),
    getPendingLeave(supabase),
  ]);

  const failures = [...readinessResult.failures, ...unfilledResult.failures, ...leaveResult.failures];
  const weeksNeedingAttention = readinessResult.byWeek.filter((readiness, index) =>
    weekNeedsAttention(readiness, index, readinessResult.lastPublishedIndex),
  );
  const unfilledShifts = unfilledResult.shifts;
  const pendingLeave = leaveResult.leave;

  const managerEmailResult = await resolveRotaManagerEmail(supabase);
  if ('error' in managerEmailResult) {
    return NextResponse.json(
      {
        ok: false,
        action: 'skipped_no_email',
        firstWeekStart,
        error: managerEmailResult.error,
        weeksNeedingAttention: weeksNeedingAttention.length,
        unfilledShifts: unfilledShifts.length,
        pendingLeave: pendingLeave.length,
        failures,
      },
      { status: 500 },
    );
  }

  const managerEmail = managerEmailResult.email;

  const subjectParts: string[] = [];
  if (weeksNeedingAttention.length > 0) {
    subjectParts.push(`${weeksNeedingAttention.length} ${plural(weeksNeedingAttention.length, 'week', 'weeks')} not ready`);
  }
  if (unfilledShifts.length > 0) {
    subjectParts.push(`${unfilledShifts.length} ${plural(unfilledShifts.length, 'shift', 'shifts')} unfilled`);
  }
  if (pendingLeave.length > 0) {
    subjectParts.push(`${pendingLeave.length} holiday ${plural(pendingLeave.length, 'request', 'requests')} waiting`);
  }
  if (failures.length > 0) {
    subjectParts.push('some checks failed');
  }
  const subject = `Rota summary: ${subjectParts.join(', ') || 'no outstanding issues found'}`;

  const emailResult = await queueManagerReportEmail({
    section: 'rota',
    key: todayIso,
    metadata: { snapshot_date: todayIso, weeks_needing_attention: weeksNeedingAttention.length,
      unfilled_shifts: unfilledShifts.length, pending_leave: pendingLeave.length, failed_checks: failures.length },
    to: managerEmail,
    subject,
    html: buildRotaAlertEmailHtml({ weeksNeedingAttention, unfilledShifts, pendingLeave, failures }),
  });

  return NextResponse.json(
    {
      ok: failures.length === 0 && emailResult.success,
      action: emailResult.success ? 'summary_queued' : 'queue_failed',
      firstWeekStart,
      horizonWeeks: HORIZON_WEEKS,
      weeksNeedingAttention: weeksNeedingAttention.map(readiness => ({
        weekStart: readiness.weekStart,
        state: readiness.state,
        unpublishedCount: readiness.unpublishedCount,
        removedCount: readiness.removedCount,
      })),
      unfilledShifts: unfilledShifts.length,
      rejectedUnfilled: unfilledShifts.filter(shift => shift.rejectedByName).length,
      pendingLeave: pendingLeave.length,
      emailSent: false,
      queued: emailResult.success,
      failures,
      localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
    },
    { status: failures.length > 0 || !emailResult.success ? 500 : 200 },
  );
}
