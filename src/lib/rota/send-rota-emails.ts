/**
 * Shared utility for sending per-employee rota shift emails.
 * Used by both publishRotaWeek (server action) and the Sunday cron job.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/emailService';
import { buildStaffRotaEmailHtml, buildRotaChangeEmailHtml, type ShiftSummary, type ShiftChange } from '@/lib/rota/email-templates';

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function fmtDate(iso: string, includeYear: boolean): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

type ShiftRow = {
  employee_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  department: string;
  name: string | null;
  is_open_shift: boolean;
};

export async function sendRotaWeekEmails(
  weekId: string,
  weekStart: string,
): Promise<{ sent: number; errors: number }> {
  const weekEnd = addDays(weekStart, 6);
  const supabase = createAdminClient();

  const [{ data: employees }, { data: shifts }, { data: openShifts }] = await Promise.all([
    supabase
      .from('employees')
      .select('employee_id, first_name, last_name, email_address')
      .in('status', ['Active', 'Started Separation']),
    supabase
      .from('rota_published_shifts')
      .select('employee_id, shift_date, start_time, end_time, department, name, is_open_shift')
      .eq('week_id', weekId)
      .eq('is_open_shift', false)
      .not('employee_id', 'is', null)
      .order('shift_date')
      .order('start_time'),
    supabase
      .from('rota_published_shifts')
      .select('shift_date, start_time, end_time, department, name')
      .eq('week_id', weekId)
      .eq('is_open_shift', true)
      .order('shift_date')
      .order('start_time'),
  ]);

  const shiftsByEmployee: Record<string, ShiftRow[]> = {};
  (shifts ?? []).forEach((s: ShiftRow) => {
    if (!shiftsByEmployee[s.employee_id]) shiftsByEmployee[s.employee_id] = [];
    shiftsByEmployee[s.employee_id]!.push(s);
  });

  let sent = 0;
  let errors = 0;

  const eligible = (employees ?? []).filter(
    emp => emp.email_address && (shiftsByEmployee[emp.employee_id] ?? []).length > 0,
  );

  const subject = (weekEndStr: string) =>
    `Your shifts: ${fmtDate(weekStart, false)} – ${fmtDate(weekEndStr, true)}`;

  const results = await Promise.allSettled(
    eligible.map(async emp => {
      const empShifts = shiftsByEmployee[emp.employee_id]!;
      const empName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'there';

      const shiftSummaries: ShiftSummary[] = empShifts.map((s: ShiftRow) => ({
        date: s.shift_date,
        startTime: s.start_time,
        endTime: s.end_time,
        department: s.department,
        templateName: s.name ?? '',
      }));

      const openShiftSummaries: ShiftSummary[] = (openShifts ?? []).map(s => ({
        date: s.shift_date,
        startTime: s.start_time,
        endTime: s.end_time,
        department: s.department,
        templateName: s.name ?? '',
      }));

      const emailSubject = subject(weekEnd);
      const emailResult = await sendEmail({
        to: emp.email_address!,
        subject: emailSubject,
        html: buildStaffRotaEmailHtml(empName, weekStart, weekEnd, shiftSummaries, openShiftSummaries),
      });

      await supabase.from('rota_email_log').insert({
        email_type: 'staff_rota',
        entity_type: 'rota_week',
        entity_id: weekId,
        to_addresses: [emp.email_address!],
        subject: emailSubject,
        status: emailResult.success ? 'sent' : 'failed',
        error_message: emailResult.success ? null : ((emailResult as { success: false; error?: string }).error ?? null),
      });

      return emailResult.success;
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) sent++;
    else errors++;
  }

  return { sent, errors };
}

// ---------------------------------------------------------------------------
// Re-publish: only email employees whose shifts actually changed
// ---------------------------------------------------------------------------

export type DiffShiftRow = {
  id: string;
  employee_id: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  department: string;
  name: string | null;
  is_open_shift: boolean;
};

function toShiftSummary(s: DiffShiftRow): ShiftSummary {
  return {
    date: s.shift_date,
    startTime: s.start_time,
    endTime: s.end_time,
    department: s.department,
    templateName: s.name ?? '',
  };
}

function computeEmployeeChanges(
  previous: DiffShiftRow[],
  current: DiffShiftRow[],
): ShiftChange[] {
  const prevById = new Map(previous.map(s => [s.id, s]));
  const currById = new Map(current.map(s => [s.id, s]));
  const changes: ShiftChange[] = [];

  // Removed: present in previous publish but absent from new publish
  for (const [id, prev] of prevById) {
    if (!currById.has(id)) {
      changes.push({ type: 'removed', before: toShiftSummary(prev) });
    }
  }

  // Added: present in new publish but absent from previous publish
  for (const [id, curr] of currById) {
    if (!prevById.has(id)) {
      changes.push({ type: 'added', after: toShiftSummary(curr) });
    }
  }

  // Modified: same id in both but at least one field differs
  for (const [id, curr] of currById) {
    const prev = prevById.get(id);
    if (
      prev &&
      (prev.shift_date !== curr.shift_date ||
        prev.start_time !== curr.start_time ||
        prev.end_time !== curr.end_time ||
        prev.department !== curr.department)
    ) {
      changes.push({ type: 'modified', before: toShiftSummary(prev), after: toShiftSummary(curr) });
    }
  }

  // Sort by the effective date of the change (use 'after' date where available)
  changes.sort((a, b) => {
    const dateA = (a.after ?? a.before)!.date;
    const dateB = (b.after ?? b.before)!.date;
    return dateA.localeCompare(dateB);
  });

  return changes;
}

/**
 * Send rota-update emails only to employees whose shifts changed since the
 * previous publish. Called by publishRotaWeek when status was already 'published'.
 */
export async function sendRotaWeekChangeEmails(
  weekId: string,
  weekStart: string,
  previousShifts: DiffShiftRow[],
  newShifts: DiffShiftRow[],
): Promise<{ sent: number; errors: number }> {
  const weekEnd = addDays(weekStart, 6);
  const supabase = createAdminClient();

  const [{ data: employees }, { data: openShifts }] = await Promise.all([
    supabase
      .from('employees')
      .select('employee_id, first_name, last_name, email_address')
      .in('status', ['Active', 'Started Separation']),
    supabase
      .from('rota_published_shifts')
      .select('shift_date, start_time, end_time, department, name')
      .eq('week_id', weekId)
      .eq('is_open_shift', true)
      .order('shift_date')
      .order('start_time'),
  ]);

  // Group non-open shifts by employee
  const prevByEmployee: Record<string, DiffShiftRow[]> = {};
  for (const s of previousShifts) {
    if (!s.employee_id || s.is_open_shift) continue;
    if (!prevByEmployee[s.employee_id]) prevByEmployee[s.employee_id] = [];
    prevByEmployee[s.employee_id]!.push(s);
  }

  const newByEmployee: Record<string, DiffShiftRow[]> = {};
  for (const s of newShifts) {
    if (!s.employee_id || s.is_open_shift) continue;
    if (!newByEmployee[s.employee_id]) newByEmployee[s.employee_id] = [];
    newByEmployee[s.employee_id]!.push(s);
  }

  const allEmployeeIds = new Set([
    ...Object.keys(prevByEmployee),
    ...Object.keys(newByEmployee),
  ]);

  const openShiftSummaries: ShiftSummary[] = (openShifts ?? []).map(s => ({
    date: s.shift_date,
    startTime: s.start_time,
    endTime: s.end_time,
    department: s.department,
    templateName: s.name ?? '',
  }));

  const emailSubject = `Your rota has been updated: ${fmtDate(weekStart, false)} – ${fmtDate(weekEnd, true)}`;

  // Only include employees who have at least one change
  const eligible = (employees ?? []).filter(emp => {
    if (!emp.email_address || !allEmployeeIds.has(emp.employee_id)) return false;
    const changes = computeEmployeeChanges(
      prevByEmployee[emp.employee_id] ?? [],
      newByEmployee[emp.employee_id] ?? [],
    );
    return changes.length > 0;
  });

  let sent = 0;
  let errors = 0;

  const results = await Promise.allSettled(
    eligible.map(async emp => {
      const changes = computeEmployeeChanges(
        prevByEmployee[emp.employee_id] ?? [],
        newByEmployee[emp.employee_id] ?? [],
      );
      const empName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'there';
      const allShifts: ShiftSummary[] = (newByEmployee[emp.employee_id] ?? []).map(toShiftSummary);

      const emailResult = await sendEmail({
        to: emp.email_address!,
        subject: emailSubject,
        html: buildRotaChangeEmailHtml(empName, weekStart, weekEnd, changes, allShifts, openShiftSummaries),
      });

      await supabase.from('rota_email_log').insert({
        email_type: 'staff_rota_change',
        entity_type: 'rota_week',
        entity_id: weekId,
        to_addresses: [emp.email_address!],
        subject: emailSubject,
        status: emailResult.success ? 'sent' : 'failed',
        error_message: emailResult.success ? null : ((emailResult as { success: false; error?: string }).error ?? null),
      });

      return emailResult.success;
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) sent++;
    else errors++;
  }

  return { sent, errors };
}
