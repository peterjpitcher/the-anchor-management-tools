import 'server-only';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/app/actions/audit';

type AdminClient = ReturnType<typeof createAdminClient>;

type ActorUser = {
  user_id?: string | null;
  user_email?: string | null;
};

type FinalizeEmployeeSeparationOptions = {
  adminClient?: AdminClient;
  actorUser?: ActorUser | null;
  todayIso?: string;
  source?: 'manual' | 'automatic';
  blockShiftsOnOrAfterToday?: boolean;
};

export type FinalizeEmployeeSeparationResult =
  | { success: true; employmentEndDate: string; authUserDeleted: boolean }
  | { success: false; error: string; code?: string };

function todayUtcIso(): string {
  return new Date().toISOString().split('T')[0];
}

export async function finalizeEmployeeSeparation(
  employeeId: string,
  options: FinalizeEmployeeSeparationOptions = {},
): Promise<FinalizeEmployeeSeparationResult> {
  const adminClient = options.adminClient ?? createAdminClient();
  const source = options.source ?? 'manual';
  const today = options.todayIso ?? todayUtcIso();
  const now = new Date().toISOString();

  const { data: employee, error: employeeError } = await adminClient
    .from('employees')
    .select('auth_user_id, email_address, status, employment_end_date')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (employeeError) {
    return { success: false, error: 'Failed to load employee.', code: 'employee_fetch_failed' };
  }

  if (!employee) {
    return { success: false, error: 'Employee not found.', code: 'employee_not_found' };
  }

  if (employee.status === 'Former') {
    return { success: false, error: 'Employee is already a former employee.', code: 'already_former' };
  }

  if (employee.status === 'Onboarding') {
    return {
      success: false,
      error: 'Cannot revoke access for an employee who has not yet been activated. Use delete instead.',
      code: 'onboarding_employee',
    };
  }

  if (employee.employment_end_date && employee.employment_end_date > today) {
    return {
      success: false,
      error: `This employee's recorded last working day is ${employee.employment_end_date}. Update the end date before marking them as Former.`,
      code: 'last_working_day_in_future',
    };
  }

  const shiftDateFilter = options.blockShiftsOnOrAfterToday
    ? adminClient
        .from('rota_shifts')
        .select('id, shift_date')
        .eq('employee_id', employeeId)
        .neq('status', 'cancelled')
        .gte('shift_date', today)
        .limit(1)
    : adminClient
        .from('rota_shifts')
        .select('id, shift_date')
        .eq('employee_id', employeeId)
        .neq('status', 'cancelled')
        .gt('shift_date', today)
        .limit(1);

  const [openSessionResult, blockingShiftResult] = await Promise.all([
    adminClient
      .from('timeclock_sessions')
      .select('id')
      .eq('employee_id', employeeId)
      .is('clock_out_at', null)
      .limit(1),
    shiftDateFilter,
  ]);

  if (openSessionResult.error) {
    return { success: false, error: 'Failed to check open timeclock sessions.', code: 'timeclock_check_failed' };
  }

  if (blockingShiftResult.error) {
    return { success: false, error: 'Failed to check future rota shifts.', code: 'shift_check_failed' };
  }

  if ((openSessionResult.data ?? []).length > 0) {
    return {
      success: false,
      error: 'This employee is currently clocked in. Clock them out before marking them as Former.',
      code: 'open_timeclock_session',
    };
  }

  if ((blockingShiftResult.data ?? []).length > 0) {
    return {
      success: false,
      error: 'This employee still has future rota shifts. Reassign or cancel those shifts before marking them as Former.',
      code: 'future_rota_shifts',
    };
  }

  // Clear future template pre-assignments before status changes so old templates
  // cannot put a former employee back on generated rotas.
  await adminClient
    .from('rota_shift_templates')
    .update({ employee_id: null })
    .eq('employee_id', employeeId);

  // Removing roles is a hard security prerequisite. If this fails, leave the
  // employee in their current status so the action can be retried.
  if (employee.auth_user_id) {
    const { error: rolesError } = await adminClient
      .from('user_roles')
      .delete()
      .eq('user_id', employee.auth_user_id);

    if (rolesError) {
      console.error('[finalizeEmployeeSeparation] CRITICAL: Failed to delete user roles:', rolesError);
      return {
        success: false,
        error: 'Failed to remove system access. Please try again or contact an administrator.',
        code: 'role_delete_failed',
      };
    }
  }

  await adminClient
    .from('employee_invite_tokens')
    .update({ expires_at: now })
    .eq('employee_id', employeeId)
    .is('completed_at', null);

  const employmentEndDate = employee.employment_end_date ?? today;
  const { data: updatedRows, error: updateError } = await adminClient
    .from('employees')
    .update({
      status: 'Former',
      employment_end_date: employmentEndDate,
      updated_at: now,
    })
    .eq('employee_id', employeeId)
    .in('status', ['Active', 'Started Separation'])
    .select('employee_id');

  if (updateError) {
    console.error('[finalizeEmployeeSeparation] Error updating status:', updateError);
    return { success: false, error: 'Failed to update employee status.', code: 'status_update_failed' };
  }

  if (!updatedRows || updatedRows.length === 0) {
    return { success: false, error: 'Employee status could not be updated.', code: 'status_update_empty' };
  }

  let authUserDeleted = false;
  if (employee.auth_user_id) {
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(employee.auth_user_id);
    if (authDeleteError) {
      console.error('[finalizeEmployeeSeparation] Failed to delete auth user:', authDeleteError);
    } else {
      authUserDeleted = true;
    }

    await adminClient
      .from('employees')
      .update({ auth_user_id: null })
      .eq('employee_id', employeeId);
  }

  if (source === 'automatic') {
    await adminClient
      .from('employee_notes')
      .insert({
        employee_id: employeeId,
        note_text: `Automatically marked as Former on ${today} after last working day ${employmentEndDate}.`,
        created_by_user_id: null,
      });
  }

  try {
    await logAuditEvent({
      user_id: options.actorUser?.user_id ?? undefined,
      user_email: options.actorUser?.user_email ?? undefined,
      operation_type: 'access_revoked',
      resource_type: 'employee',
      resource_id: employeeId,
      operation_status: 'success',
      new_values: {
        status: 'Former',
        employment_end_date: employmentEndDate,
        auth_user_id_cleared: Boolean(employee.auth_user_id),
      },
      additional_info: { source },
    });
  } catch (auditError) {
    console.error('[finalizeEmployeeSeparation] Audit log failed:', auditError);
  }

  revalidatePath('/employees');
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/rota');
  revalidatePath('/timeclock');

  return { success: true, employmentEndDate, authUserDeleted };
}
