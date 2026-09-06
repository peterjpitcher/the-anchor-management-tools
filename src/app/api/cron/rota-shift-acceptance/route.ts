import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { sendEmail } from '@/lib/email/emailService';
import { queueManagerReportEmail } from '@/lib/manager-report/queue';
import type { ManagerReportInput } from '@/lib/manager-report/types';
import {
  buildShiftAutoAcceptWarningEmailHtml,
  type PortalShiftEmailSummary,
} from '@/lib/rota/email-templates';
import { recordShiftReliabilityEvent } from '@/services/employee-reliability';
import { displayName } from '@/lib/employees/display-name';
import { formatDateInLondon } from '@/lib/dateUtils';
import {
  SHIFT_ACCEPTANCE_CUTOFF_DAYS,
  isInsideAcceptanceCutoff,
  latePublishGraceEnd,
  shiftStartInstant,
} from '@/lib/rota/acceptance-cutoff';
import { resolveRotaManagerEmail } from '@/lib/rota/manager-email';

const WARNING_DAYS_BEFORE_CUTOFF = 2;
const SHIFT_AUTO_ACCEPT_POLICY_NOTE =
  'In line with our policy, all shifts must be accepted or rejected no less than two weeks before the shift.';

// Publishing a shift inside the cutoff is allowed but must never auto-accept it:
// nobody can be treated as having accepted work they were never given a chance to
// turn down. A shift first published to somebody inside the cutoff gets 48 hours
// from that publish in which they can still reject it, and this cron leaves it
// alone until that window closes. The window itself is decided by
// latePublishGraceEnd() in @/lib/rota/acceptance-cutoff, shared with the staff
// portal and the server actions.

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
  first_published_at: string | null;
};

type EmployeeRow = {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
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

// Goes to the employee and greets them, so use the name they go by.
function employeeName(employee: EmployeeRow | undefined): string {
  return displayName(employee ?? {}, 'there');
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
    cc: string[];
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
    cc_addresses: input.cc,
    subject: input.subject,
    status: input.status,
    error_message: input.error,
    message_id: input.messageId ?? null,
  });
}

const MANAGER_RETRY_PREFIX = 'manager-report-retry:';

function managerRetryId(input: ManagerReportInput): string {
  const hash = createHash('sha256').update(`rota-manager-retry:${input.key}:${input.to}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function collectManagerWarnings(
  supabase: ReturnType<typeof createAdminClient>,
  warnings: Array<{ input: ManagerReportInput; shiftId: string }>,
): Promise<{ queued: number; failed: number; retryStorageErrors: number }> {
  const result = { queued: 0, failed: 0, retryStorageErrors: 0 };
  const attempted = new Set<string>();
  // Failed collections survive staff delivery and later shift acceptance or deletion.
  let retryRows: Array<{ id: string; entity_id: string; to_addresses: string[]; error_message: string }> = [];
  try {
    const { data, error } = await supabase.from('rota_email_log')
      .select('id, entity_id, to_addresses, error_message')
      .eq('email_type', 'shift_auto_accept_warning')
      .eq('status', 'failed')
      .like('error_message', `${MANAGER_RETRY_PREFIX}%`)
      .order('created_at')
      .limit(100);
    if (error) result.retryStorageErrors += 1;
    else retryRows = data ?? [];
  } catch {
    result.retryStorageErrors += 1;
  }

  const pending = [...warnings];
  for (const row of retryRows ?? []) {
    try {
      const envelope = JSON.parse(row.error_message.slice(MANAGER_RETRY_PREFIX.length)) as { input: ManagerReportInput };
      if (envelope.input.section !== 'staff_shift_reminders' || typeof envelope.input.key !== 'string'
        || typeof envelope.input.subject !== 'string' || typeof envelope.input.html !== 'string'
        || !row.to_addresses?.[0]) throw new Error('Invalid manager warning retry');
      pending.push({ input: { ...envelope.input, to: row.to_addresses[0] }, shiftId: row.entity_id });
    } catch {
      result.retryStorageErrors += 1;
    }
  }

  for (const { input, shiftId } of pending) {
    const id = managerRetryId(input);
    if (attempted.has(id)) continue;
    attempted.add(id);
    let queueResult: { success: boolean; error?: string };
    try {
      queueResult = await queueManagerReportEmail(input);
    } catch (error) {
      queueResult = { success: false, error: error instanceof Error ? error.message : 'Manager report collection failed' };
    }
    try {
      if (queueResult.success) {
        result.queued += 1;
        const { error } = await supabase.from('rota_email_log')
          .update({ error_message: 'Manager report collection recovered; entry queued for Friday delivery.' })
          .eq('id', id)
          .eq('status', 'failed')
          .like('error_message', `${MANAGER_RETRY_PREFIX}%`);
        if (error) result.retryStorageErrors += 1;
      } else {
        result.failed += 1;
        const { error } = await supabase.from('rota_email_log').upsert({
          id,
          email_type: 'shift_auto_accept_warning',
          entity_type: 'rota_shift',
          entity_id: shiftId,
          to_addresses: [input.to],
          cc_addresses: [],
          subject: input.subject,
          status: 'failed',
          error_message: `${MANAGER_RETRY_PREFIX}${JSON.stringify({ error: queueResult.error, input })}`,
          message_id: null,
        }, { onConflict: 'id', ignoreDuplicates: true });
        if (error) result.retryStorageErrors += 1;
      }
    } catch {
      result.retryStorageErrors += 1;
    }
  }
  return result;
}

export async function GET(request: Request): Promise<NextResponse> {
  const authResult = authorizeCronRequest(request);
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const warningWindowMs = (SHIFT_ACCEPTANCE_CUTOFF_DAYS + WARNING_DAYS_BEFORE_CUTOFF) * 24 * 60 * 60 * 1000;
  const warningHorizonIso = toIsoDate(addDays(now, SHIFT_ACCEPTANCE_CUTOFF_DAYS + WARNING_DAYS_BEFORE_CUTOFF + 1));
  const supabase = createAdminClient();

  // No hard-coded mailbox: the address comes from Rota Settings, then the
  // environment. A missing one must not stop staff being warned, so it downgrades
  // to sending without a copy to the manager and is reported in the response.
  const managerEmailResult = await resolveRotaManagerEmail(supabase);
  const managerEmail = 'email' in managerEmailResult ? managerEmailResult.email : null;
  const managerEmailError = 'error' in managerEmailResult ? managerEmailResult.error : null;

  const { data: shifts, error: shiftsError } = await supabase
    .from('rota_published_shifts')
    .select('id, week_id, employee_id, shift_date, start_time, end_time, department, name, auto_accept_warning_sent_at, first_published_at')
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
  // The error is kept, not dropped: without it a failed lookup looks identical to
  // "nobody has an email address" and every warning is silently skipped.
  const { data: employees, error: employeesError } = employeeIds.length > 0
    ? await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, preferred_name, email_address')
        .in('employee_id', employeeIds)
    : { data: [] as EmployeeRow[], error: null };

  if (employeesError) {
    console.error(`[rota] Could not read employees for shift acceptance warnings: ${employeesError.message}`);
  }

  const employeeById = new Map((employees ?? []).map((employee: EmployeeRow) => [employee.employee_id, employee]));

  const warningByEmployee = new Map<string, PendingShiftRow[]>();
  const autoAcceptShifts: PendingShiftRow[] = [];
  let heldForLatePublishGrace = 0;

  for (const shift of pendingShifts) {
    if (isInsideAcceptanceCutoff(shift.shift_date, shift.start_time, now)) {
      const graceEndsAt = latePublishGraceEnd(shift);
      if (graceEndsAt && now.getTime() < graceEndsAt.getTime()) {
        heldForLatePublishGrace += 1;
        continue;
      }
      autoAcceptShifts.push(shift);
      continue;
    }

    const msUntilShift = shiftStartInstant(shift.shift_date, shift.start_time).getTime() - now.getTime();
    if (!shift.auto_accept_warning_sent_at && msUntilShift <= warningWindowMs) {
      const existing = warningByEmployee.get(shift.employee_id) ?? [];
      existing.push(shift);
      warningByEmployee.set(shift.employee_id, existing);
    }
  }

  let warningSent = 0;
  const managerWarnings: Array<{ input: ManagerReportInput; shiftId: string }> = [];
  let warningFailed = 0;
  let warningSkipped = 0;

  for (const [employeeId, employeeShifts] of warningByEmployee.entries()) {
    const employee = employeeById.get(employeeId);
    if (!employee?.email_address) {
      warningSkipped += employeeShifts.length;
      continue;
    }

    const subject = 'Please accept or reject your upcoming shifts';
    const html = buildShiftAutoAcceptWarningEmailHtml(
      employeeName(employee),
      employeeShifts.map(toEmailSummary),
    );
    if (managerEmail) {
      for (const shift of employeeShifts) {
        managerWarnings.push({ shiftId: shift.id, input: {
          section: 'staff_shift_reminders',
          key: `${employeeId}:${shift.id}`,
          to: managerEmail,
          subject: `Shift acceptance reminder: ${employeeName(employee)}`,
          html: buildShiftAutoAcceptWarningEmailHtml(employeeName(employee), [toEmailSummary(shift)]),
          metadata: {
            employee_id: employeeId,
            shift_ids: [shift.id],
            source_recorded_at: now.toISOString(),
            summary: `${employeeName(employee)}: reminder generated ${formatDateInLondon(now)} for ${formatDateInLondon(shift.shift_date)}, ${shift.start_time}`,
          },
        } });
      }
      // A shared manager mailbox receives this cohort through the report only.
      if (employee.email_address.trim().toLowerCase() === managerEmail.trim().toLowerCase()) continue;
    }
    const emailResult = await sendEmail({
      to: employee.email_address,
      subject,
      html,
    });

    await logWarningEmail(supabase, {
      shiftId: employeeShifts[0]!.id,
      to: employee.email_address,
      cc: [],
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

  // Run manager collection after immediate staff sends. Collection or storage failure
  // cannot suppress a staff warning, and previous failures retry outside the pending-shift scan.
  let managerCollection = { queued: 0, failed: 0, retryStorageErrors: 0 };
  try {
    managerCollection = await collectManagerWarnings(supabase, managerWarnings);
  } catch (error) {
    managerCollection.retryStorageErrors += 1;
    console.error('[rota] Manager warning collection failed:', error instanceof Error ? error.message : 'Unknown error');
  }

  const acceptedAt = now.toISOString();
  let autoAccepted = 0;
  let autoAcceptFailed = 0;
  // The published snapshot said auto-accepted and the live rota still says pending,
  // and the compensating rollback failed too. That is real drift between the two
  // tables, so the run reports it as a failure rather than a quiet success.
  let autoAcceptDesynced = 0;
  // The snapshot row was accepted but the live shift has gone (deleted or handed to
  // somebody else since publish). Nothing to mirror, so this is recorded, not retried.
  let autoAcceptMissingLiveShift = 0;

  for (const shift of autoAcceptShifts) {
    const acceptance = {
      acceptance_status: 'auto_accepted',
      acceptance_decided_at: acceptedAt,
      acceptance_decided_by: shift.employee_id,
      acceptance_note: null,
      auto_accept_reason: SHIFT_AUTO_ACCEPT_POLICY_NOTE,
    };

    const { data: acceptedShift, error } = await supabase
      .from('rota_published_shifts')
      .update(acceptance)
      .eq('id', shift.id)
      .eq('employee_id', shift.employee_id)
      .eq('acceptance_status', 'pending')
      .select('id')
      .maybeSingle();

    if (error || !acceptedShift) {
      autoAcceptFailed += 1;
      continue;
    }

    // The snapshot and the live rota are two tables and this is two statements, so
    // the second one failing used to leave them disagreeing with nobody any the
    // wiser. Roll the snapshot back on a mirror error so the next run can retry.
    const { data: mirroredShift, error: mirrorError } = await supabase
      .from('rota_shifts')
      .update(acceptance)
      .eq('id', shift.id)
      .eq('employee_id', shift.employee_id)
      .select('id')
      .maybeSingle();

    if (mirrorError) {
      console.error(
        `[rota] Auto-accept could not be mirrored to rota_shifts for shift ${shift.id}: ${mirrorError.message}`,
      );

      const { error: rollbackError } = await supabase
        .from('rota_published_shifts')
        .update({
          acceptance_status: 'pending',
          acceptance_decided_at: null,
          acceptance_decided_by: null,
          acceptance_note: null,
          auto_accept_reason: null,
        })
        .eq('id', shift.id)
        .eq('employee_id', shift.employee_id);

      if (rollbackError) {
        console.error(
          `[rota] Auto-accept rollback failed for shift ${shift.id}, the published snapshot and the live rota now disagree: ${rollbackError.message}`,
        );
        autoAcceptDesynced += 1;
      } else {
        autoAcceptFailed += 1;
      }
      continue;
    }

    if (!mirroredShift) {
      // No error, no row: the live shift no longer exists for this employee. The
      // snapshot change stands (it is what staff see) and is still audited below.
      console.warn(
        `[rota] Auto-accepted published shift ${shift.id} has no matching live rota_shifts row for employee ${shift.employee_id}.`,
      );
      autoAcceptMissingLiveShift += 1;
    }

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
        live_shift_updated: Boolean(mirroredShift),
      },
    });

    await recordShiftReliabilityEvent({
      eventType: 'shift_auto_accepted',
      employeeId: shift.employee_id,
      shift,
      eventAt: acceptedAt,
      source: 'rota-shift-acceptance-cron',
      metadata: {
        acceptance_status: 'auto_accepted',
        reason: SHIFT_AUTO_ACCEPT_POLICY_NOTE,
      },
      supabase,
    });

    autoAccepted += 1;
  }

  return NextResponse.json(
    {
      ok: autoAcceptDesynced === 0 && managerCollection.retryStorageErrors === 0,
      pendingChecked: pendingShifts.length,
      warningEmailsSent: warningSent,
      managerCopiesQueued: managerCollection.queued,
      managerCopiesFailed: managerCollection.failed,
      managerRetryStorageErrors: managerCollection.retryStorageErrors,
      warningEmailsFailed: warningFailed,
      warningShiftsSkippedNoEmail: warningSkipped,
      autoAccepted,
      autoAcceptFailed,
      autoAcceptDesynced,
      autoAcceptMissingLiveShift,
      heldForLatePublishGrace,
      managerEmailError,
      employeeLookupError: employeesError?.message ?? null,
    },
    // Drift or an unavailable retry ledger needs a visible operational failure. Staff
    // deliveries have already completed and their warning timestamps prevent resends.
    { status: autoAcceptDesynced > 0 || managerCollection.retryStorageErrors > 0 ? 500 : 200 },
  );
}
