'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eachDayOfInterval, parseISO, getYear } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { sendEmail } from '@/lib/email/emailService';
import {
  buildHolidaySubmittedEmailHtml,
  buildHolidayDecisionEmailHtml,
} from '@/lib/rota/email-templates';
import { logAuditEvent } from '@/app/actions/audit';
import { getRotaSettings } from '@/app/actions/rota-settings';

export type LeaveRequest = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  note: string | null;
  status: 'pending' | 'approved' | 'declined';
  manager_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  holiday_year: number;
  created_at: string;
  updated_at: string;
};

function getHolidayYear(date: Date, startMonth: number, startDay: number): number {
  const year = getYear(date);
  const yearStart = new Date(year, startMonth - 1, startDay);
  return date >= yearStart ? year : year - 1;
}

// ---------------------------------------------------------------------------
// Submit a leave request (employee)
// ---------------------------------------------------------------------------

const SubmitLeaveSchema = z.object({
  employeeId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).nullable().optional(),
});

// Returns true if the current session user IS the employee identified by employeeId
async function isOwnEmployeeRecord(employeeId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('employees')
    .select('employee_id')
    .eq('employee_id', employeeId)
    .eq('auth_user_id', user.id)
    .maybeSingle();
  return Boolean(data);
}

export async function submitLeaveRequest(input: z.infer<typeof SubmitLeaveSchema>): Promise<
  { success: true; data: LeaveRequest } | { success: false; error: string }
> {
  const parsed = SubmitLeaveSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const { startDate, endDate, employeeId, note } = parsed.data;

  const canRequest = await checkUserPermission('leave', 'request');
  const canCreate = await checkUserPermission('leave', 'create');
  const selfService = !canRequest && !canCreate ? await isOwnEmployeeRecord(employeeId) : false;
  if (!canRequest && !canCreate && !selfService) return { success: false, error: 'Permission denied' };

  if (new Date(endDate) < new Date(startDate)) {
    return { success: false, error: 'End date must be on or after start date' };
  }

  const todayLocal = toZonedTime(new Date(), 'Europe/London').toISOString().split('T')[0];
  if (startDate < todayLocal) {
    return { success: false, error: 'Leave requests cannot be submitted for past dates' };
  }

  // Check for overlapping non-declined requests
  const supabaseCheck = await createClient();
  const { data: overlapping } = await supabaseCheck
    .from('leave_requests')
    .select('id')
    .eq('employee_id', employeeId)
    .neq('status', 'declined')
    .lte('start_date', endDate)
    .gte('end_date', startDate);
  if (overlapping && overlapping.length > 0) {
    return { success: false, error: 'You already have a leave request covering some of these dates' };
  }

  const { holidayYearStartMonth, holidayYearStartDay } = await getRotaSettings();
  const holidayYear = getHolidayYear(parseISO(startDate), holidayYearStartMonth, holidayYearStartDay);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Insert request
  const { data: request, error: reqError } = await supabase
    .from('leave_requests')
    .insert({
      employee_id: employeeId,
      start_date: startDate,
      end_date: endDate,
      note: note ?? null,
      holiday_year: holidayYear,
      created_by: user?.id ?? null,
    })
    .select('*')
    .single();

  if (reqError) return { success: false, error: reqError.message };

  // Expand leave days immediately (used for rota overlay even while pending)
  const days = eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) });
  const dayRows = days.map(d => ({
    request_id: request.id,
    employee_id: employeeId,
    leave_date: d.toISOString().split('T')[0],
  }));

  // Use ON CONFLICT DO NOTHING — employee may already have a day from another request
  await supabase.from('leave_days').upsert(dayRows, { onConflict: 'employee_id,leave_date', ignoreDuplicates: true });

  // Send confirmation email to employee
  const { data: employee } = await supabase
    .from('employees')
    .select('email_address, first_name')
    .eq('employee_id', employeeId)
    .single();

  if (employee?.email_address) {
    const emailSubject = `Holiday Request Received — ${startDate} to ${endDate}`;
    const emailResult = await sendEmail({
      to: employee.email_address,
      subject: emailSubject,
      html: buildHolidaySubmittedEmailHtml(
        employee.first_name ?? 'there',
        startDate,
        endDate,
      ),
    });

    await supabase.from('rota_email_log').insert({
      email_type: 'holiday_submitted',
      entity_type: 'leave_request',
      entity_id: request.id,
      to_addresses: [employee.email_address],
      subject: emailSubject,
      status: emailResult.success ? 'sent' : 'failed',
      error_message: emailResult.success ? null : emailResult.error ?? null,
      sent_by: user?.id ?? null,
    });
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'create',
    resource_type: 'leave_request',
    resource_id: request.id,
    operation_status: 'success',
    new_values: { employee_id: employeeId, start_date: startDate, end_date: endDate },
  });

  revalidatePath('/rota/leave');
  revalidatePath('/portal/leave');
  return { success: true, data: request as LeaveRequest };
}

// ---------------------------------------------------------------------------
// Approve or decline a leave request (manager)
// ---------------------------------------------------------------------------

export async function reviewLeaveRequest(
  requestId: string,
  decision: 'approved' | 'declined',
  managerNote?: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const canApprove = await checkUserPermission('leave', 'approve');
  if (!canApprove) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: request, error: fetchError } = await supabase
    .from('leave_requests')
    .select('*, employees(email_address, first_name)')
    .eq('id', requestId)
    .single();

  if (fetchError || !request) return { success: false, error: 'Request not found' };
  if (request.status !== 'pending') return { success: false, error: 'Request is not pending' };

  const { error } = await supabase
    .from('leave_requests')
    .update({
      status: decision,
      manager_note: managerNote ?? null,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  if (error) return { success: false, error: error.message };

  // If declined, remove the pending leave_days
  if (decision === 'declined') {
    await supabase.from('leave_days').delete().eq('request_id', requestId);
  }

  // Send decision email to employee
  const employee = (request as { employees: { email_address: string; first_name: string } | null }).employees;
  if (employee?.email_address) {
    const decisionSubject = `Holiday Request ${decision === 'approved' ? 'Approved' : 'Declined'}`;
    const decisionResult = await sendEmail({
      to: employee.email_address,
      subject: decisionSubject,
      html: buildHolidayDecisionEmailHtml(
        employee.first_name ?? 'there',
        request.start_date,
        request.end_date,
        decision,
        managerNote,
      ),
    });

    await supabase.from('rota_email_log').insert({
      email_type: 'holiday_decision',
      entity_type: 'leave_request',
      entity_id: requestId,
      to_addresses: [employee.email_address],
      subject: decisionSubject,
      status: decisionResult.success ? 'sent' : 'failed',
      error_message: decisionResult.success ? null : decisionResult.error ?? null,
      sent_by: user?.id ?? null,
    });
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: decision === 'approved' ? 'approve' : 'decline',
    resource_type: 'leave_request',
    resource_id: requestId,
    operation_status: 'success',
    new_values: { status: decision, manager_note: managerNote },
  });

  revalidatePath('/rota');
  revalidatePath('/rota/leave');
  revalidatePath('/portal/leave');
  return { success: true };
}

// ---------------------------------------------------------------------------
// Get leave requests for a manager view
// ---------------------------------------------------------------------------

export async function getLeaveRequests(filters?: {
  status?: 'pending' | 'approved' | 'declined';
  employeeId?: string;
  holidayYear?: number;
}): Promise<{ success: true; data: LeaveRequest[] } | { success: false; error: string }> {
  const canView = await checkUserPermission('leave', 'view');
  if (!canView) {
    // Allow portal employees to view their own requests
    const selfService = filters?.employeeId ? await isOwnEmployeeRecord(filters.employeeId) : false;
    if (!selfService) return { success: false, error: 'Permission denied' };
  }

  const supabase = await createClient();
  let query = supabase
    .from('leave_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.employeeId) query = query.eq('employee_id', filters.employeeId);
  if (filters?.holidayYear) query = query.eq('holiday_year', filters.holidayYear);

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as LeaveRequest[] };
}

// ---------------------------------------------------------------------------
// Get holiday usage count for an employee in a given year
// ---------------------------------------------------------------------------

export async function getHolidayUsage(employeeId: string, holidayYear: number): Promise<
  { success: true; count: number; allowance: number; overThreshold: boolean } | { success: false; error: string }
> {
  const supabase = await createClient();

  // Fetch the employee's personal allowance (falls back to default if no pay settings row)
  const { data: paySetting } = await supabase
    .from('employee_pay_settings')
    .select('holiday_allowance_days')
    .eq('employee_id', employeeId)
    .single();

  const { defaultHolidayDays } = await getRotaSettings();
  const allowance = paySetting?.holiday_allowance_days ?? defaultHolidayDays;

  // Fetch approved/pending request IDs for this employee and year
  const { data: requests } = await supabase
    .from('leave_requests')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('holiday_year', holidayYear)
    .neq('status', 'declined');

  const requestIds = (requests ?? []).map(r => r.id);

  const { count, error } = requestIds.length === 0
    ? { count: 0, error: null }
    : await supabase
        .from('leave_days')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', employeeId)
        .in('request_id', requestIds);

  if (error) return { success: false, error: error.message };
  const total = count ?? 0;
  return { success: true, count: total, allowance, overThreshold: total >= allowance };
}
