/**
 * Shared utility for sending per-employee rota shift emails.
 * Used by both publishRotaWeek (server action) and the Sunday cron job.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/emailService';
import { buildStaffRotaEmailHtml, type ShiftSummary } from '@/lib/rota/email-templates';

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

  const [{ data: employees }, { data: shifts }] = await Promise.all([
    supabase
      .from('employees')
      .select('employee_id, first_name, last_name, email_address')
      .eq('status', 'Active'),
    supabase
      .from('rota_published_shifts')
      .select('employee_id, shift_date, start_time, end_time, department, name, is_open_shift')
      .eq('week_id', weekId)
      .eq('is_open_shift', false)
      .not('employee_id', 'is', null)
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

  for (const emp of employees ?? []) {
    if (!emp.email_address) continue;

    const empShifts = shiftsByEmployee[emp.employee_id] ?? [];
    if (empShifts.length === 0) continue;

    const empName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'there';

    const shiftSummaries: ShiftSummary[] = empShifts.map((s: ShiftRow) => ({
      date: s.shift_date,
      startTime: s.start_time,
      endTime: s.end_time,
      department: s.department,
      templateName: s.name ?? '',
    }));

    const subject = `Your shifts: ${fmtDate(weekStart, false)} – ${fmtDate(weekEnd, true)}`;

    const emailResult = await sendEmail({
      to: emp.email_address,
      subject,
      html: buildStaffRotaEmailHtml(empName, weekStart, weekEnd, shiftSummaries),
    });

    await supabase.from('rota_email_log').insert({
      email_type: 'staff_rota',
      entity_type: 'rota_week',
      entity_id: weekId,
      to_addresses: [emp.email_address],
      subject,
      status: emailResult.success ? 'sent' : 'failed',
      error_message: emailResult.success ? null : ((emailResult as { success: false; error?: string }).error ?? null),
    });

    if (emailResult.success) sent++;
    else errors++;
  }

  return { sent, errors };
}
