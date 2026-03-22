'use server'

import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkUserPermission } from './rbac';
import { logAuditEvent } from './audit';
import { getCurrentUser } from '@/lib/audit-helpers';
import { getErrorMessage } from '@/lib/errors';
import {
  sendWelcomeEmail,
  sendChaseEmail,
  sendOnboardingCompleteEmail,
  sendPortalInviteEmail,
} from '@/lib/email/employee-invite-emails';
import { FinancialDetailsSchema, HealthRecordSchema, EmergencyContactSchema } from '@/services/employees';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://manage.the-anchor.pub';

// DEF-015 verified: the employee_invite_tokens table column is defined as
// `expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'`
// in migration 20260227000001_employee_invite_onboarding.sql.
// The create_employee_invite RPC relies on this default. Welcome and portal
// invite emails both promise "7 days" — this matches the DB constraint.

function buildOnboardingUrl(token: string): string {
  return `${BASE_URL}/onboarding/${token}`;
}

// ---------------------------------------------------------------------------
// Manager-side actions
// ---------------------------------------------------------------------------

export async function inviteEmployee(prevState: any, formData: FormData) {
  const canCreate = await checkUserPermission('employees', 'create');
  if (!canCreate) {
    return { type: 'error', message: 'You do not have permission to invite employees.' };
  }

  const email = (formData.get('email') as string | null)?.trim().toLowerCase() ?? '';
  const jobTitle = (formData.get('job_title') as string | null)?.trim() || null;

  const emailSchema = z.string().email('Please enter a valid email address.');
  const emailResult = emailSchema.safeParse(email);
  if (!emailResult.success) {
    return { type: 'error', message: emailResult.error.errors[0].message };
  }

  const adminClient = createAdminClient();

  try {
    const { data, error } = await adminClient.rpc('create_employee_invite', {
      p_email: email,
      p_job_title: jobTitle,
    });

    if (error) {
      console.error('[inviteEmployee] RPC error:', error);
      // DEF-013: also catch Postgres unique violation code 23505
      if (error.message?.toLowerCase().includes('already exists') || error.code === '23505') {
        return { type: 'error', message: 'An employee with this email address already exists.' };
      }
      return { type: 'error', message: 'Failed to create invite. Please try again.' };
    }

    const result = data as { employee_id: string; token: string } | null;
    if (!result?.employee_id || !result?.token) {
      return { type: 'error', message: 'Invite created but token was not returned.' };
    }

    // DEF-007: Set invited_at timestamp — check for error and fail fast on failure
    const { error: invitedAtError } = await adminClient
      .from('employees')
      .update({ invited_at: new Date().toISOString() })
      .eq('employee_id', result.employee_id);

    if (invitedAtError) {
      console.error('[inviteEmployee] Failed to set invited_at:', invitedAtError);
      return { type: 'error', message: 'Failed to record invite timestamp. Please try again.' };
    }

    // Send welcome email (best-effort)
    try {
      await sendWelcomeEmail(email, buildOnboardingUrl(result.token));
    } catch (emailError) {
      console.error('[inviteEmployee] Failed to send welcome email:', emailError);
    }

    // Audit log
    try {
      const user = await getCurrentUser();
      await logAuditEvent({
        user_id: user?.user_id ?? undefined,
        user_email: user?.user_email ?? undefined,
        operation_type: 'invite',
        resource_type: 'employee',
        resource_id: result.employee_id,
        operation_status: 'success',
        new_values: { email, job_title: jobTitle, status: 'Onboarding' },
      });
    } catch (auditError) {
      console.error('[inviteEmployee] Audit log failed:', auditError);
    }

    revalidatePath('/employees');
    return { type: 'success', message: `Invite sent to ${email}.`, employeeId: result.employee_id };
  } catch (err: unknown) {
    console.error('[inviteEmployee] Unexpected error:', err);
    return { type: 'error', message: getErrorMessage(err) };
  }
}

export async function sendPortalInvite(employeeId: string) {
  const canEdit = await checkUserPermission('employees', 'edit');
  if (!canEdit) {
    return { type: 'error', message: 'You do not have permission to send portal invites.' };
  }

  const adminClient = createAdminClient();

  const { data: employee, error: empError } = await adminClient
    .from('employees')
    .select('email_address, auth_user_id')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (empError || !employee) {
    return { type: 'error', message: 'Employee not found.' };
  }
  if (employee.auth_user_id) {
    return { type: 'error', message: 'This employee already has a portal login.' };
  }
  if (!employee.email_address) {
    return { type: 'error', message: 'This employee has no email address on file.' };
  }

  const { data: tokenData, error: tokenError } = await adminClient
    .from('employee_invite_tokens')
    .insert({ employee_id: employeeId, email: employee.email_address })
    .select('token')
    .single();

  if (tokenError || !tokenData?.token) {
    return { type: 'error', message: 'Failed to create invite token.' };
  }

  // DEF-009: If email fails, clean up the orphaned token before returning error
  try {
    await sendPortalInviteEmail(employee.email_address, buildOnboardingUrl(tokenData.token));
  } catch (emailError) {
    console.error('[sendPortalInvite] Failed to send email:', emailError);
    // Clean up orphaned token
    await adminClient
      .from('employee_invite_tokens')
      .delete()
      .eq('token', tokenData.token);
    return { type: 'error', message: 'Token created but email could not be sent.' };
  }

  try {
    const user = await getCurrentUser();
    await logAuditEvent({
      user_id: user?.user_id ?? undefined,
      user_email: user?.user_email ?? undefined,
      operation_type: 'invite',
      resource_type: 'employee',
      resource_id: employeeId,
      operation_status: 'success',
      new_values: { portal_invite_sent: true },
    });
  } catch (auditError) {
    console.error('[sendPortalInvite] Audit log failed:', auditError);
  }

  return { type: 'success', message: `Portal invite sent to ${employee.email_address}.` };
}

export async function resendInvite(employeeId: string) {
  const canEdit = await checkUserPermission('employees', 'edit');
  if (!canEdit) {
    return { type: 'error', message: 'You do not have permission to resend invites.' };
  }

  const adminClient = createAdminClient();

  // Get employee email
  const { data: employee, error: empError } = await adminClient
    .from('employees')
    .select('email_address, status')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (empError || !employee) {
    return { type: 'error', message: 'Employee not found.' };
  }
  if (employee.status !== 'Onboarding') {
    return { type: 'error', message: 'Can only resend invites for Onboarding employees.' };
  }

  // DEF-014: Expire all existing pending tokens before creating a new one
  await adminClient
    .from('employee_invite_tokens')
    .update({ expires_at: new Date().toISOString() })
    .eq('employee_id', employeeId)
    .is('completed_at', null);

  // Create a new token
  const { data: tokenData, error: tokenError } = await adminClient
    .from('employee_invite_tokens')
    .insert({ employee_id: employeeId, email: employee.email_address })
    .select('token')
    .single();

  if (tokenError || !tokenData?.token) {
    return { type: 'error', message: 'Failed to create new invite token.' };
  }

  try {
    await sendWelcomeEmail(employee.email_address, buildOnboardingUrl(tokenData.token));
  } catch (emailError) {
    console.error('[resendInvite] Failed to send email:', emailError);
    return { type: 'error', message: 'Token created but email could not be sent.' };
  }

  return { type: 'success', message: `Invite resent to ${employee.email_address}.` };
}

// ---------------------------------------------------------------------------
// Employee-side actions (token-authenticated, no permission check)
// ---------------------------------------------------------------------------

export async function validateInviteToken(token: string): Promise<{
  valid: boolean;
  expired: boolean;
  completed: boolean;
  employee_id: string | null;
  email: string | null;
  hasAuthUser: boolean;
  error?: string;
}> {
  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from('employee_invite_tokens')
    .select('id, employee_id, email, expires_at, completed_at')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    return { valid: false, expired: false, completed: false, employee_id: null, email: null, hasAuthUser: false, error: 'Failed to validate token.' };
  }

  if (!data) {
    return { valid: false, expired: false, completed: false, employee_id: null, email: null, hasAuthUser: false, error: 'Invalid invite link.' };
  }

  if (data.completed_at) {
    return { valid: false, expired: false, completed: true, employee_id: data.employee_id, email: data.email, hasAuthUser: false };
  }

  const now = new Date();
  const expiresAt = new Date(data.expires_at);
  if (expiresAt < now) {
    return { valid: false, expired: true, completed: false, employee_id: data.employee_id, email: data.email, hasAuthUser: false };
  }

  // Check if employee already has an auth user
  const { data: emp } = await adminClient
    .from('employees')
    .select('auth_user_id')
    .eq('employee_id', data.employee_id)
    .maybeSingle();

  const hasAuthUser = Boolean(emp?.auth_user_id);

  return {
    valid: true,
    expired: false,
    completed: false,
    employee_id: data.employee_id,
    email: data.email,
    hasAuthUser,
  };
}

export async function createEmployeeAccount(token: string, password: string): Promise<{ success: boolean; error?: string }> {
  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters.' };
  }

  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id || !validation.email) {
    return { success: false, error: validation.error || 'Invalid or expired invite link.' };
  }

  if (validation.hasAuthUser) {
    return { success: false, error: 'Account already created. Please sign in.' };
  }

  const adminClient = createAdminClient();

  // Create Supabase auth user
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: validation.email,
    password,
    email_confirm: true,
  });

  if (authError) {
    console.error('[createEmployeeAccount] Auth error:', authError);
    if (authError.message?.includes('already registered')) {
      return { success: false, error: 'This email address already has an account.' };
    }
    return { success: false, error: 'Failed to create account. Please try again.' };
  }

  const authUserId = authData.user?.id;
  if (!authUserId) {
    // Edge case: auth user was created but no ID returned — attempt cleanup is not possible
    // without the ID; return error immediately
    return { success: false, error: 'Account created but no user ID returned.' };
  }

  // DEF-002: Link auth_user_id to employee — failure here means the user cannot sign in.
  // On failure, delete the orphaned auth user and surface the error.
  const { error: linkError } = await adminClient
    .from('employees')
    .update({ auth_user_id: authUserId })
    .eq('employee_id', validation.employee_id);

  if (linkError) {
    console.error('[createEmployeeAccount] Failed to link auth user to employee:', linkError);
    // Attempt to clean up the orphaned auth user
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(authUserId);
    if (deleteAuthError) {
      console.error('[createEmployeeAccount] CRITICAL: Failed to delete orphaned auth user after link failure. Manual cleanup required. auth_user_id:', authUserId, deleteAuthError);
    }
    return { success: false, error: 'Failed to link account. Please try again.' };
  }

  return { success: true };
}

const PersonalSectionSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  date_of_birth: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  post_code: z.string().optional().nullable(),
  phone_number: z.string().optional().nullable(),
  mobile_number: z.string().optional().nullable(),
});

const EmergencyContactsSectionSchema = z.object({
  primary: z.object({
    name: z.string().min(1, 'Primary contact name is required'),
    relationship: z.string().optional().nullable(),
    phone_number: z.string().optional().nullable(),
    mobile_number: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
  }),
  secondary: z.object({
    name: z.string().optional().nullable(),
    relationship: z.string().optional().nullable(),
    phone_number: z.string().optional().nullable(),
    mobile_number: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
  }).optional(),
});

const FinancialSectionSchema = z.object({
  ni_number: z.string().optional().nullable(),
  bank_name: z.string().optional().nullable(),
  payee_name: z.string().optional().nullable(),
  branch_address: z.string().optional().nullable(),
  bank_sort_code: z.string().optional().nullable(),
  bank_account_number: z.string().optional().nullable(),
});

const HealthSectionSchema = z.object({
  doctor_name: z.string().optional().nullable(),
  doctor_address: z.string().optional().nullable(),
  allergies: z.string().optional().nullable(),
  has_allergies: z.boolean().default(false),
  had_absence_over_2_weeks_last_3_years: z.boolean().default(false),
  had_outpatient_treatment_over_3_months_last_3_years: z.boolean().default(false),
  absence_or_treatment_details: z.string().optional().nullable(),
  illness_history: z.string().optional().nullable(),
  recent_treatment: z.string().optional().nullable(),
  has_diabetes: z.boolean().default(false),
  has_epilepsy: z.boolean().default(false),
  has_skin_condition: z.boolean().default(false),
  has_depressive_illness: z.boolean().default(false),
  has_bowel_problems: z.boolean().default(false),
  has_ear_problems: z.boolean().default(false),
  is_registered_disabled: z.boolean().default(false),
  disability_reg_number: z.string().optional().nullable(),
  disability_reg_expiry_date: z.string().optional().nullable(),
  disability_details: z.string().optional().nullable(),
});

export async function saveOnboardingSection(
  token: string,
  section: 'personal' | 'emergency_contacts' | 'financial' | 'health',
  data: unknown
): Promise<{ success: boolean; error?: string }> {
  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id) {
    return { success: false, error: 'Invalid or expired invite link.' };
  }

  const adminClient = createAdminClient();
  const employeeId = validation.employee_id;

  try {
    if (section === 'personal') {
      const parsed = PersonalSectionSchema.parse(data);
      const { error } = await adminClient
        .from('employees')
        .update({
          first_name: parsed.first_name,
          last_name: parsed.last_name,
          date_of_birth: parsed.date_of_birth ?? null,
          address: parsed.address ?? null,
          post_code: parsed.post_code ?? null,
          phone_number: parsed.phone_number ?? null,
          mobile_number: parsed.mobile_number ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('employee_id', employeeId);

      if (error) throw error;

    } else if (section === 'emergency_contacts') {
      const parsed = EmergencyContactsSectionSchema.parse(data);

      // DEF-001: Compensation pattern — back up existing contacts before destructive delete
      const { data: existingContacts } = await adminClient
        .from('employee_emergency_contacts')
        .select('*')
        .eq('employee_id', employeeId);

      // Helper to restore contacts from backup
      async function restoreContacts(contacts: any[]): Promise<void> {
        if (!contacts?.length) return;
        try {
          await adminClient.from('employee_emergency_contacts').insert(
            contacts.map((c) => ({
              employee_id: c.employee_id,
              name: c.name,
              relationship: c.relationship,
              phone_number: c.phone_number,
              mobile_number: c.mobile_number,
              address: c.address,
              priority: c.priority,
            }))
          );
        } catch (restoreErr) {
          console.error('[saveOnboardingSection] CRITICAL: Failed to restore emergency contacts after failed save:', restoreErr);
        }
      }

      // Delete existing contacts for this employee
      await adminClient
        .from('employee_emergency_contacts')
        .delete()
        .eq('employee_id', employeeId);

      // Insert primary contact
      if (parsed.primary.name) {
        const { error: primaryError } = await adminClient.from('employee_emergency_contacts').insert({
          employee_id: employeeId,
          name: parsed.primary.name,
          relationship: parsed.primary.relationship ?? null,
          phone_number: parsed.primary.phone_number ?? null,
          mobile_number: parsed.primary.mobile_number ?? null,
          address: parsed.primary.address ?? null,
          priority: 'Primary',
        });

        if (primaryError) {
          console.error('[saveOnboardingSection] Failed to insert primary emergency contact — attempting restore:', primaryError);
          await restoreContacts(existingContacts ?? []);
          return { success: false, error: 'Failed to save primary emergency contact. Previous contacts have been restored. Please try again.' };
        }
      }

      // Insert secondary contact if provided
      if (parsed.secondary?.name) {
        const { error: secondaryError } = await adminClient.from('employee_emergency_contacts').insert({
          employee_id: employeeId,
          name: parsed.secondary.name,
          relationship: parsed.secondary.relationship ?? null,
          phone_number: parsed.secondary.phone_number ?? null,
          mobile_number: parsed.secondary.mobile_number ?? null,
          address: parsed.secondary.address ?? null,
          priority: 'Secondary',
        });

        if (secondaryError) {
          console.error('[saveOnboardingSection] Failed to insert secondary emergency contact — attempting restore:', secondaryError);
          // Remove the primary we just inserted, then restore original state
          await adminClient
            .from('employee_emergency_contacts')
            .delete()
            .eq('employee_id', employeeId)
            .eq('priority', 'Primary');
          await restoreContacts(existingContacts ?? []);
          return { success: false, error: 'Failed to save secondary emergency contact. Previous contacts have been restored. Please try again.' };
        }
      }

    } else if (section === 'financial') {
      const parsed = FinancialSectionSchema.parse(data);
      const { error } = await adminClient
        .from('employee_financial_details')
        .upsert({
          employee_id: employeeId,
          ni_number: parsed.ni_number ?? null,
          bank_name: parsed.bank_name ?? null,
          payee_name: parsed.payee_name ?? null,
          branch_address: parsed.branch_address ?? null,
          bank_sort_code: parsed.bank_sort_code ?? null,
          bank_account_number: parsed.bank_account_number ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'employee_id' });

      if (error) throw error;

    } else if (section === 'health') {
      const parsed = HealthSectionSchema.parse(data);
      const { error } = await adminClient
        .from('employee_health_records')
        .upsert({
          employee_id: employeeId,
          ...parsed,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'employee_id' });

      if (error) throw error;
    }

    return { success: true };
  } catch (err: unknown) {
    console.error(`[saveOnboardingSection] Section ${section} error:`, err);
    if (err instanceof z.ZodError) {
      return { success: false, error: err.errors[0]?.message || 'Validation failed.' };
    }
    return { success: false, error: getErrorMessage(err) };
  }
}

export async function submitOnboardingProfile(token: string): Promise<{ success: boolean; error?: string }> {
  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id || !validation.email) {
    return { success: false, error: 'Invalid or expired invite link.' };
  }

  const adminClient = createAdminClient();
  const employeeId = validation.employee_id;

  // Check personal details are complete
  const { data: employee } = await adminClient
    .from('employees')
    .select('first_name, last_name')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (!employee?.first_name || !employee?.last_name) {
    return { success: false, error: 'Personal details must be completed before submitting.' };
  }

  const now = new Date().toISOString();

  // Update employee to Active
  const { error: updateError } = await adminClient
    .from('employees')
    .update({
      status: 'Active',
      onboarding_completed_at: now,
      updated_at: now,
    })
    .eq('employee_id', employeeId);

  if (updateError) {
    console.error('[submitOnboardingProfile] Failed to activate employee:', updateError);
    return { success: false, error: 'Failed to complete profile. Please try again.' };
  }

  // DEF-005: Mark token as completed — failure here is critical: employee is Active but cron will keep chasing
  const { error: tokenMarkError } = await adminClient
    .from('employee_invite_tokens')
    .update({ completed_at: now })
    .eq('token', token);

  if (tokenMarkError) {
    console.error('[submitOnboardingProfile] CRITICAL: Failed to mark token as completed. Employee is Active but token shows incomplete.', tokenMarkError);
    return {
      success: false,
      error: 'Profile submitted but a system error occurred. Please contact your manager to confirm your account is active.',
    };
  }

  // DEF-010: Update profile full_name if auth user exists — non-fatal on failure
  if (validation.hasAuthUser) {
    const { data: empData } = await adminClient
      .from('employees')
      .select('auth_user_id, first_name, last_name')
      .eq('employee_id', employeeId)
      .maybeSingle();

    if (empData?.auth_user_id) {
      const { error: profileUpdateError } = await adminClient
        .from('profiles')
        .update({
          full_name: `${empData.first_name} ${empData.last_name}`,
          updated_at: now,
        })
        .eq('id', empData.auth_user_id);

      if (profileUpdateError) {
        console.error('[submitOnboardingProfile] Failed to update profile name:', profileUpdateError);
        // Non-fatal — employee is Active, log and continue
      }
    }
  }

  // Send completion email to manager (best-effort)
  try {
    const fullName = `${employee.first_name} ${employee.last_name}`;
    await sendOnboardingCompleteEmail(fullName, validation.email);
  } catch (emailError) {
    console.error('[submitOnboardingProfile] Failed to send completion email:', emailError);
  }

  // Audit log
  try {
    await logAuditEvent({
      operation_type: 'onboarding_complete',
      resource_type: 'employee',
      resource_id: employeeId,
      operation_status: 'success',
      new_values: { status: 'Active', onboarding_completed_at: now },
    });
  } catch (auditError) {
    console.error('[submitOnboardingProfile] Audit log failed:', auditError);
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Status transition actions
// ---------------------------------------------------------------------------

// H13 fix: added count check — returns error when 0 rows updated (employee not in Active status)
export async function beginSeparation(employeeId: string): Promise<{ success: boolean; error?: string }> {
  const canEdit = await checkUserPermission('employees', 'edit');
  if (!canEdit) {
    return { success: false, error: 'You do not have permission to perform this action.' };
  }

  const adminClient = createAdminClient();

  const { data: updated, error } = await adminClient
    .from('employees')
    .update({ status: 'Started Separation', updated_at: new Date().toISOString() })
    .eq('employee_id', employeeId)
    .eq('status', 'Active')
    .select('employee_id');

  if (error) {
    console.error('[beginSeparation] Error:', error);
    return { success: false, error: 'Failed to update employee status.' };
  }

  if (!updated || updated.length === 0) {
    return { success: false, error: 'Employee status could not be updated. They may not be in Active status.' };
  }

  try {
    const user = await getCurrentUser();
    await logAuditEvent({
      user_id: user?.user_id ?? undefined,
      user_email: user?.user_email ?? undefined,
      operation_type: 'status_change',
      resource_type: 'employee',
      resource_id: employeeId,
      operation_status: 'success',
      new_values: { status: 'Started Separation' },
    });
  } catch (auditError) {
    console.error('[beginSeparation] Audit log failed:', auditError);
  }

  revalidatePath(`/employees/${employeeId}`);
  return { success: true };
}

export async function revokeEmployeeAccess(employeeId: string): Promise<{ success: boolean; error?: string }> {
  const canEdit = await checkUserPermission('employees', 'edit');
  if (!canEdit) {
    return { success: false, error: 'You do not have permission to perform this action.' };
  }

  const adminClient = createAdminClient();

  // DEF-006: Fetch status along with auth_user_id and email for guard checks
  const { data: employee } = await adminClient
    .from('employees')
    .select('auth_user_id, email_address, status')
    .eq('employee_id', employeeId)
    .maybeSingle();

  // DEF-006: Guard against invalid status transitions
  if (employee?.status === 'Former') {
    return { success: false, error: 'Employee is already a former employee.' };
  }
  if (employee?.status === 'Onboarding') {
    return { success: false, error: 'Cannot revoke access for an employee who has not yet been activated. Use delete instead.' };
  }

  const now = new Date().toISOString();
  const today = new Date().toISOString().split('T')[0];

  // Update status to Former
  const { error: updateError } = await adminClient
    .from('employees')
    .update({
      status: 'Former',
      employment_end_date: today,
      updated_at: now,
    })
    .eq('employee_id', employeeId);

  if (updateError) {
    console.error('[revokeEmployeeAccess] Error updating status:', updateError);
    return { success: false, error: 'Failed to update employee status.' };
  }

  // Clear this employee's pre-assignment from any shift templates
  await adminClient
    .from('rota_shift_templates')
    .update({ employee_id: null })
    .eq('employee_id', employeeId);

  // DEF-004: Delete all user_roles if auth user exists — this is a hard failure.
  // A former employee with active roles is a security issue.
  if (employee?.auth_user_id) {
    const { error: rolesError } = await adminClient
      .from('user_roles')
      .delete()
      .eq('user_id', employee.auth_user_id);

    if (rolesError) {
      console.error('[revokeEmployeeAccess] CRITICAL: Failed to delete user roles:', rolesError);
      return { success: false, error: 'Failed to remove system access. Please try again or contact an administrator.' };
    }
  }

  // DEF-011: Expire all pending invite tokens
  await adminClient
    .from('employee_invite_tokens')
    .update({ expires_at: now })
    .eq('employee_id', employeeId)
    .is('completed_at', null);

  // DEF-011: Delete the auth user to prevent sign-in
  if (employee?.auth_user_id) {
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(employee.auth_user_id);
    if (authDeleteError) {
      console.error('[revokeEmployeeAccess] Failed to delete auth user:', authDeleteError);
      // Non-fatal if roles are already deleted — log for manual follow-up
    }

    // DEF-011: Clear auth_user_id on the employee record
    await adminClient
      .from('employees')
      .update({ auth_user_id: null })
      .eq('employee_id', employeeId);
  }

  try {
    const user = await getCurrentUser();
    await logAuditEvent({
      user_id: user?.user_id ?? undefined,
      user_email: user?.user_email ?? undefined,
      operation_type: 'access_revoked',
      resource_type: 'employee',
      resource_id: employeeId,
      operation_status: 'success',
      new_values: { status: 'Former', auth_user_id_cleared: Boolean(employee?.auth_user_id) },
    });
  } catch (auditError) {
    console.error('[revokeEmployeeAccess] Audit log failed:', auditError);
  }

  revalidatePath(`/employees/${employeeId}`);
  return { success: true };
}
