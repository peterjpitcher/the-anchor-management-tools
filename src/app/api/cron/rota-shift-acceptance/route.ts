import { NextResponse } from 'next/server';
import { fromZonedTime } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { sendEmail } from '@/lib/email/emailService';
import {
  buildShiftAutoAcceptWarningEmailHtml,
  type PortalShiftEmailSummary,
} from '@/lib/rota/email-templates';

const TIMEZONE = 'Europe/London';
const MANAGER_SHIFT_EMAIL = 'manager@the-anchor.pub';
const CUTOFF_DAYS = 14;
const WARNING_DAYS_BEFORE_CUTOFF = 2;
const SHIFT_AUTO_ACCEPT_POLICY_NOTE =
  'In line with our policy, all shifts must be accepted or rejected no less than two weeks before the shift.';

type PendingShiftRow = {
  id: string;
  week_id: string;
  employee_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  department: string;
  name: string | null;
  auto_accept_warning_sent_at: string | null;
};

type EmployeeRow = {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  email_address: string | null;
};

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function shiftStartInstant(shift: Pick<PendingShiftRow, 'shift_date' | 'start_time'>): Date {
  return fromZonedTime(`${shift.shift_date}T${shift.start_time}`, TIMEZONE);
}

function employeeName(employee: EmployeeRow | undefined): string {
  return [employee?.first_name, employee?.last_name].filter(Boolean).join(' ') || 'there';
}

function toEmailSummary(shift: PendingShiftRow): PortalShiftEmailSummary {
  return {
    date: shift.shift_date,
    startTime: shift.start_time,
    endTime: shift.end_time,
    department: shift.department,
    templateName: shift.name,
  };
}

async function logWarningEmail(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    shiftId: string;
    to: string;
    subject: string;
    status: 'sent' | 'failed';
    error: string | null;
    messageId?: string | null;
  },
) {
  await supabase.from('rota_email_log').insert({
    email_type: 'shift_auto_accept_warning',
    entity_type: 'rota_shift',
    entity_id: input.shiftId,
    to_addresses: [input.to],
    cc_addresses: [MANAGER_SHIFT_EMAIL],
    subject: input.subject,
    status: input.status,
    error_message: input.error,
    message_id: input.messageId ?? null,
  });
}

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request);
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const cutoffMs = CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  const warningWindowMs = (CUTOFF_DAYS + WARNING_DAYS_BEFORE_CUTOFF) * 24 * 60 * 60 * 1000;
  const warningHorizonIso = toIsoDate(addDays(now, CUTOFF_DAYS + WARNING_DAYS_BEFORE_CUTOFF + 1));
  const supabase = createAdminClient();

  const { data: shifts, error: shiftsError } = await supabase
    .from('rota_published_shifts')
    .select('id, week_id, employee_id, shift_date, start_time, end_time, department, name, auto_accept_warning_sent_at')
    .eq('status', 'scheduled')
    .eq('is_open_shift', false)
    .eq('acceptance_status', 'pending')
    .not('employee_id', 'is', null)
    .lte('shift_date', warningHorizonIso)
    .order('shift_date')
    .order('start_time');

  if (shiftsError) {
    return NextResponse.json({ error: shiftsError.message }, { status: 500 });
  }

  const pendingShifts = (shifts ?? []) as PendingShiftRow[];
  const employeeIds = [...new Set(pendingShifts.map(shift => shift.employee_id))];
  const { data: employees } = employeeIds.length > 0
    ? await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, email_address')
        .in('employee_id', employeeIds)
    : { data: [] as EmployeeRow[] };

  const employeeById = new Map((employees ?? []).map((employee: EmployeeRow) => [employee.employee_id, employee]));

  const warningByEmployee = new Map<string, PendingShiftRow[]>();
  const autoAcceptShifts: PendingShiftRow[] = [];

  for (const shift of pendingShifts) {
    const msUntilShift = shiftStartInstant(shift).getTime() - now.getTime();
    if (msUntilShift <= cutoffMs) {
      autoAcceptShifts.push(shift);
      continue;
    }

    if (!shift.auto_accept_warning_sent_at && msUntilShift <= warningWindowMs) {
      const existing = warningByEmployee.get(shift.employee_id) ?? [];
      existing.push(shift);
      warningByEmployee.set(shift.employee_id, existing);
    }
  }

  let warningSent = 0;
  let warningFailed = 0;
  let warningSkipped = 0;

  for (const [employeeId, employeeShifts] of warningByEmployee.entries()) {
    const employee = employeeById.get(employeeId);
    if (!employee?.email_address) {
      warningSkipped += employeeShifts.length;
      continue;
    }

    const subject = 'Please accept or reject your upcoming shifts';
    const emailResult = await sendEmail({
      to: employee.email_address,
      cc: [MANAGER_SHIFT_EMAIL],
      subject,
      html: buildShiftAutoAcceptWarningEmailHtml(
        employeeName(employee),
        employeeShifts.map(toEmailSummary),
      ),
    });

    await logWarningEmail(supabase, {
      shiftId: employeeShifts[0]!.id,
      to: employee.email_address,
      subject,
      status: emailResult.success ? 'sent' : 'failed',
      error: emailResult.success ? null : emailResult.error ?? null,
      messageId: emailResult.success ? emailResult.messageId ?? null : null,
    });

    if (emailResult.success) {
      warningSent += 1;
      const warnedAt = now.toISOString();
      const shiftIds = employeeShifts.map(shift => shift.id);
      await Promise.all([
        supabase
          .from('rota_published_shifts')
          .update({ auto_accept_warning_sent_at: warnedAt })
          .in('id', shiftIds),
        supabase
          .from('rota_shifts')
          .update({ auto_accept_warning_sent_at: warnedAt })
          .in('id', shiftIds),
      ]);
    } else {
      warningFailed += 1;
    }
  }

  const acceptedAt = now.toISOString();
  let autoAccepted = 0;
  let autoAcceptFailed = 0;

  for (const shift of autoAcceptShifts) {
    const acceptance = {
      acceptance_status: 'auto_accepted',
      acceptance_decided_at: acceptedAt,
      acceptance_decided_by: shift.employee_id,
      acceptance_note: null,
      auto_accept_reason: SHIFT_AUTO_ACCEPT_POLICY_NOTE,
    };

    const { error } = await supabase
      .from('rota_published_shifts')
      .update(acceptance)
      .eq('id', shift.id)
      .eq('employee_id', shift.employee_id)
      .eq('acceptance_status', 'pending');

    if (error) {
      autoAcceptFailed += 1;
      continue;
    }

    await supabase
      .from('rota_shifts')
      .update(acceptance)
      .eq('id', shift.id)
      .eq('employee_id', shift.employee_id);

    await supabase.from('audit_logs').insert({
      user_id: null,
      user_email: null,
      operation_type: 'auto_accept',
      resource_type: 'rota_shift',
      resource_id: shift.id,
      operation_status: 'success',
      old_values: { acceptance_status: 'pending' },
      new_values: acceptance,
      additional_info: {
        reason: SHIFT_AUTO_ACCEPT_POLICY_NOTE,
        source: 'rota-shift-acceptance-cron',
      },
    });

    autoAccepted += 1;
  }

  return NextResponse.json({
    ok: true,
    pendingChecked: pendingShifts.length,
    warningEmailsSent: warningSent,
    warningEmailsFailed: warningFailed,
    warningShiftsSkippedNoEmail: warningSkipped,
    autoAccepted,
    autoAcceptFailed,
  });
}
