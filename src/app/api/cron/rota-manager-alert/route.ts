import { NextResponse } from 'next/server';
import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/emailService';
import { buildManagerAlertEmailHtml, type UnfilledShiftSummary } from '@/lib/rota/email-templates';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { displayName } from '@/lib/employees/display-name';

// Vercel Cron: runs at 18:00 Europe/London every Sunday
const TIMEZONE = 'Europe/London';

/**
 * How far ahead to chase unfilled shifts. Rejections land well before the shift
 * (staff must decide at least 14 days out), so a week-ahead window would miss
 * most of them.
 */
const UNFILLED_HORIZON_DAYS = 56;

type OpenShiftRow = {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  department: string;
  name: string | null;
};

type RejectionRow = {
  shift_id: string;
  employee_id: string;
  rejection_note: string | null;
  rejected_at: string;
};

type EmployeeNameRow = {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Unfilled shifts from today up to the horizon, annotated with the rejection
 * that freed them where there was one.
 */
async function getUnfilledShifts(
  supabase: ReturnType<typeof createAdminClient>,
  todayIso: string,
): Promise<UnfilledShiftSummary[]> {
  const { data: shiftRows } = await supabase
    .from('rota_shifts')
    .select('id, shift_date, start_time, end_time, department, name')
    .eq('is_open_shift', true)
    .eq('status', 'scheduled')
    .gte('shift_date', todayIso)
    .lte('shift_date', addDaysIso(todayIso, UNFILLED_HORIZON_DAYS))
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true });

  const shifts = (shiftRows ?? []) as OpenShiftRow[];
  if (shifts.length === 0) return [];

  const { data: rejectionRows } = await supabase
    .from('rota_shift_rejections')
    .select('shift_id, employee_id, rejection_note, rejected_at')
    .in('shift_id', shifts.map(shift => shift.id))
    .order('rejected_at', { ascending: false });

  const rejections = (rejectionRows ?? []) as RejectionRow[];
  const latestByShift = new Map<string, RejectionRow>();
  for (const rejection of rejections) {
    if (!latestByShift.has(rejection.shift_id)) latestByShift.set(rejection.shift_id, rejection);
  }

  const employeeIds = [...new Set(rejections.map(rejection => rejection.employee_id))];
  const { data: employeeRows } = employeeIds.length
    ? await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, preferred_name')
        .in('employee_id', employeeIds)
    : { data: [] };
  const nameById = new Map<string, string>(
    ((employeeRows ?? []) as EmployeeNameRow[]).map(row => [row.employee_id, displayName(row, 'a staff member')]),
  );

  return shifts.map(shift => {
    const rejection = latestByShift.get(shift.id) ?? null;
    return {
      date: shift.shift_date,
      startTime: shift.start_time,
      endTime: shift.end_time,
      department: shift.department,
      templateName: shift.name,
      rejectedByName: rejection ? (nameById.get(rejection.employee_id) ?? 'a staff member') : null,
      rejectionNote: rejection?.rejection_note ?? null,
    };
  });
}

function getNextMondayIso(nowUtc: Date): string {
  const nowLocal = toZonedTime(nowUtc, TIMEZONE);
  const day = nowLocal.getDay(); // 0=Sun, 1=Mon...
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  const nextMon = new Date(nowLocal.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
  return formatInTimeZone(nextMon, TIMEZONE, 'yyyy-MM-dd');
}

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request);
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowUtc = new Date();
  const nowLocal = toZonedTime(nowUtc, TIMEZONE);

  if (nowLocal.getDay() !== 0) {
    return NextResponse.json({ skipped: true, reason: 'Not Sunday' });
  }

  const weekStart = getNextMondayIso(nowUtc);
  const supabase = createAdminClient();

  // Check rota_weeks for the upcoming week
  const { data: week } = await supabase
    .from('rota_weeks')
    .select('id, status, has_unpublished_changes')
    .eq('week_start', weekStart)
    .single();

  const needsPublishing = !week || week.status === 'draft' || week.has_unpublished_changes;
  const reason: 'not_published' | 'unpublished_changes' | null = needsPublishing
    ? (!week || week.status === 'draft' ? 'not_published' : 'unpublished_changes')
    : null;

  // A shift nobody has picked up is just as much a problem as an unpublished
  // week, and until now nothing chased it: the only prompt was the one-off email
  // sent at the moment of rejection.
  const todayIso = formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd');
  const unfilledShifts = await getUnfilledShifts(supabase, todayIso);

  if (!reason && unfilledShifts.length === 0) {
    return NextResponse.json({ ok: true, action: 'no_alert_needed', weekStart });
  }

  const { data: managerEmailSetting } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'rota_manager_email')
    .single();
  const managerEmail =
    (managerEmailSetting?.value as { value: string } | null)?.value ||
    process.env.ROTA_MANAGER_EMAIL;
  if (!managerEmail) {
    return NextResponse.json({ ok: true, action: 'skipped_no_email', weekStart });
  }

  const subject = reason
    ? `Rota Alert: week of ${weekStart} needs attention`
    : `Rota Alert: ${unfilledShifts.length} shift${unfilledShifts.length === 1 ? '' : 's'} still ${unfilledShifts.length === 1 ? 'needs' : 'need'} somebody`;

  const emailResult = await sendEmail({
    to: managerEmail,
    subject,
    html: buildManagerAlertEmailHtml(weekStart, reason, unfilledShifts),
  });

  await supabase.from('rota_email_log').insert({
    email_type: 'manager_alert',
    entity_type: 'rota_week',
    entity_id: week?.id ?? null,
    to_addresses: [managerEmail],
    subject,
    status: emailResult.success ? 'sent' : 'failed',
    error_message: emailResult.success ? null : (emailResult.error ?? null),
  });

  return NextResponse.json({
    ok: true,
    action: 'alert_sent',
    weekStart,
    reason,
    unfilledShifts: unfilledShifts.length,
    rejectedUnfilled: unfilledShifts.filter(shift => shift.rejectedByName).length,
    localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
  });
}
