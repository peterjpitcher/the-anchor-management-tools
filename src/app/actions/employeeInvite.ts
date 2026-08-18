'use server'

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  MAX_BLOCKS,
  TIME_OFF_ERRORS,
  validateTimeOffBlocks,
  type TimeOffAnswer,
  type TimeOffBlock,
  type TimeOffErrorCode,
} from '@/lib/leave/onboarding-time-off';
import { checkUserPermission } from './rbac';
import { logAuditEvent } from './audit';
import { getCurrentUser } from '@/lib/audit-helpers';
import { getErrorMessage } from '@/lib/errors';
import { finalizeEmployeeSeparation } from '@/lib/employees/separation';
import {
  sendWelcomeEmail,
  sendOnboardingCompleteEmail,
  sendPortalInviteEmail,
  sendSeparationStartedEmail,
  type SeparationShiftSummary,
} from '@/lib/email/employee-invite-emails';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { normalisePreferredName } from '@/lib/employees/display-name';
import { resolveOnboardingSessionError } from '@/lib/employees/onboarding-session';
import { formatPhoneForStorage } from '@/lib/utils';

// This builds invite links that go out by email, so the fallback must resolve.
// `manage.the-anchor.pub` does not; `management.orangejelly.co.uk` is the live domain.
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk';

// DEF-015 verified: the employee_invite_tokens table column is defined as
// `expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'`
// in migration 20260227000001_employee_invite_onboarding.sql.
// The create_employee_invite RPC relies on this default. Welcome and portal
// invite emails both promise "7 days" — this matches the DB constraint.

function buildOnboardingUrl(token: string): string {
  return `${BASE_URL}/onboarding/${token}`;
}

export type InviteType = 'onboarding' | 'portal_access';
type EmployeeStatus = 'Onboarding' | 'Active' | 'Started Separation' | 'Former';
type OnboardingSectionKey = 'personal' | 'emergency_contacts' | 'financial' | 'health' | 'time_off' | 'right_to_work_notice';

type ValidationResult = {
  valid: boolean;
  expired: boolean;
  completed: boolean;
  employee_id: string | null;
  email: string | null;
  hasAuthUser: boolean;
  inviteType: InviteType | null;
  employeeStatus: EmployeeStatus | null;
  employeeName: string | null;
  error?: string;
};

export type OnboardingSnapshot = {
  personal: {
    first_name: string;
    last_name: string;
    preferred_name: string;
    date_of_birth: string;
    address: string;
    post_code: string;
    phone_number: string;
    mobile_number: string;
  };
  emergency_contacts: {
    primary: {
      name: string;
      relationship: string;
      phone_number: string;
      mobile_number: string;
      address: string;
    };
    secondary: {
      name: string;
      relationship: string;
      phone_number: string;
      mobile_number: string;
      address: string;
    };
  };
  financial: {
    ni_number: string;
    bank_name: string;
    payee_name: string;
    branch_address: string;
    bank_sort_code: string;
    bank_account_number: string;
  };
  health: {
    doctor_name: string;
    doctor_address: string;
    has_allergies: boolean;
    allergies: string;
    had_absence_over_2_weeks_last_3_years: boolean;
    had_outpatient_treatment_over_3_months_last_3_years: boolean;
    absence_or_treatment_details: string;
    illness_history: string;
    recent_treatment: string;
    has_diabetes: boolean;
    has_epilepsy: boolean;
    has_skin_condition: boolean;
    has_depressive_illness: boolean;
    has_bowel_problems: boolean;
    has_ear_problems: boolean;
    is_registered_disabled: boolean;
    disability_reg_number: string;
    disability_reg_expiry_date: string;
    disability_details: string;
  };
  time_off: {
    answer: TimeOffAnswer | null;
    submissionVersion: number;
    blocks: Array<{ startDate: string; endDate: string; leaveType: string; note: string }>;
  };
  right_to_work_notice: { acknowledged: boolean };
  completedSections: Record<OnboardingSectionKey, boolean>;
};

function validationFailure(
  error: string,
  overrides: Partial<ValidationResult> = {},
): ValidationResult {
  return {
    valid: false,
    expired: false,
    completed: false,
    employee_id: null,
    email: null,
    hasAuthUser: false,
    inviteType: null,
    employeeStatus: null,
    employeeName: null,
    error,
    ...overrides,
  };
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

async function deleteTokenByValue(adminClient: ReturnType<typeof createAdminClient>, token: string) {
  const { error } = await adminClient
    .from('employee_invite_tokens')
    .delete()
    .eq('token', token);
  if (error) {
    console.error('[employeeInvite] Failed to clean up invite token:', error);
  }
}

async function expirePendingSiblingTokens(
  adminClient: ReturnType<typeof createAdminClient>,
  employeeId: string,
  inviteType: InviteType,
  activeToken: string,
): Promise<string | null> {
  const { error } = await adminClient
    .from('employee_invite_tokens')
    .update({ expires_at: new Date().toISOString() })
    .eq('employee_id', employeeId)
    .eq('invite_type', inviteType)
    .is('completed_at', null)
    .neq('token', activeToken);

  if (error) {
    console.error('[employeeInvite] Failed to expire older invite tokens:', error);
    return error.message || 'Failed to expire older invite links.';
  }

  return null;
}

/**
 * Server side wrapper around resolveOnboardingSessionError. See that function for the rule and
 * why "no session" has to be allowed here.
 */
async function requireTokenBoundSession(employeeId: string): Promise<string | null> {
  const adminClient = createAdminClient();
  const { data: employee } = await adminClient
    .from('employees')
    .select('auth_user_id')
    .eq('employee_id', employeeId)
    .maybeSingle();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return resolveOnboardingSessionError({
    employeeAuthUserId: (employee as { auth_user_id: string | null } | null)?.auth_user_id ?? null,
    sessionUserId: user?.id ?? null,
  });
}

// ---------------------------------------------------------------------------
// Manager-side actions
// ---------------------------------------------------------------------------

export async function inviteEmployee(prevState: any, formData: FormData) {
  const canCreate = await checkUserPermission('employees', 'create');
  if (!canCreate) {
    return { type: 'error', message: 'You do not have permission to invite employees.' };
  }

  const email = normalizeEmail(formData.get('email') as string | null);
  const jobTitle = (formData.get('job_title') as string | null)?.trim() || null;
  const employmentStartDate = (formData.get('employment_start_date') as string | null)?.trim() || null;

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
      p_employment_start_date: employmentStartDate,
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

    try {
      await sendWelcomeEmail(email, buildOnboardingUrl(result.token));
    } catch (emailError) {
      console.error('[inviteEmployee] Failed to send welcome email:', emailError);
      const { error: cleanupError } = await adminClient
        .from('employees')
        .delete()
        .eq('employee_id', result.employee_id)
        .eq('status', 'Onboarding')
        .is('auth_user_id', null);
      if (cleanupError) {
        console.error('[inviteEmployee] Failed to clean up invite-created employee:', cleanupError);
      }
      return { type: 'error', message: 'Invite could not be sent. No employee record was created.' };
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
        new_values: { email, job_title: jobTitle, employment_start_date: employmentStartDate, status: 'Onboarding' },
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
    .select('email_address, auth_user_id, status')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (empError || !employee) {
    return { type: 'error', message: 'Employee not found.' };
  }
  if (employee.auth_user_id) {
    return { type: 'error', message: 'This employee already has a portal login.' };
  }
  if (!['Active', 'Started Separation'].includes(employee.status)) {
    return { type: 'error', message: 'Portal invites can only be sent to active employees.' };
  }
  if (!employee.email_address) {
    return { type: 'error', message: 'This employee has no email address on file.' };
  }

  const { data: tokenData, error: tokenError } = await adminClient
    .from('employee_invite_tokens')
    .insert({
      employee_id: employeeId,
      email: normalizeEmail(employee.email_address),
      invite_type: 'portal_access',
    })
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
    await deleteTokenByValue(adminClient, tokenData.token);
    return { type: 'error', message: 'Token created but email could not be sent.' };
  }

  const siblingExpiryError = await expirePendingSiblingTokens(
    adminClient,
    employeeId,
    'portal_access',
    tokenData.token,
  );
  if (siblingExpiryError) {
    return { type: 'error', message: 'Invite sent, but old portal invite links could not be expired. Please try again.' };
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

  // Create a new token
  const { data: tokenData, error: tokenError } = await adminClient
    .from('employee_invite_tokens')
    .insert({
      employee_id: employeeId,
      email: normalizeEmail(employee.email_address),
      invite_type: 'onboarding',
    })
    .select('token')
    .single();

  if (tokenError || !tokenData?.token) {
    return { type: 'error', message: 'Failed to create new invite token.' };
  }

  try {
    await sendWelcomeEmail(employee.email_address, buildOnboardingUrl(tokenData.token));
  } catch (emailError) {
    console.error('[resendInvite] Failed to send email:', emailError);
    await deleteTokenByValue(adminClient, tokenData.token);
    return { type: 'error', message: 'Token created but email could not be sent.' };
  }

  const siblingExpiryError = await expirePendingSiblingTokens(
    adminClient,
    employeeId,
    'onboarding',
    tokenData.token,
  );
  if (siblingExpiryError) {
    return { type: 'error', message: 'Invite sent, but old onboarding links could not be expired. Please try again.' };
  }

  return { type: 'success', message: `Invite resent to ${employee.email_address}.` };
}

// ---------------------------------------------------------------------------
// Employee-side actions (token-authenticated, no permission check)
// ---------------------------------------------------------------------------

export async function validateInviteToken(token: string): Promise<ValidationResult> {
  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from('employee_invite_tokens')
    .select('id, employee_id, email, invite_type, expires_at, completed_at')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    return validationFailure('Failed to validate token.');
  }

  if (!data) {
    return validationFailure('Invalid invite link.');
  }

  const inviteType = (data.invite_type ?? 'onboarding') as InviteType;
  if (!['onboarding', 'portal_access'].includes(inviteType)) {
    return validationFailure('Invalid invite link.', {
      employee_id: data.employee_id,
      email: data.email,
      inviteType: null,
    });
  }

  if (data.completed_at) {
    return validationFailure('Invite link has already been used.', {
      completed: true,
      employee_id: data.employee_id,
      email: data.email,
      inviteType,
    });
  }

  const now = new Date();
  const expiresAt = new Date(data.expires_at);
  if (expiresAt <= now) {
    return validationFailure('Invite link has expired.', {
      expired: true,
      employee_id: data.employee_id,
      email: data.email,
      inviteType,
    });
  }

  const { data: emp, error: empError } = await adminClient
    .from('employees')
    .select('auth_user_id, email_address, status, first_name, last_name')
    .eq('employee_id', data.employee_id)
    .maybeSingle();

  if (empError || !emp) {
    return validationFailure('Employee not found.', {
      employee_id: data.employee_id,
      email: data.email,
      inviteType,
    });
  }

  const employeeStatus = emp.status as EmployeeStatus;
  const hasAuthUser = Boolean(emp?.auth_user_id);
  const employeeEmail = normalizeEmail(emp.email_address);
  const tokenEmail = normalizeEmail(data.email);
  const employeeName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || null;

  if (employeeEmail !== tokenEmail) {
    return validationFailure('Invite link no longer matches the employee email address.', {
      employee_id: data.employee_id,
      email: emp.email_address,
      hasAuthUser,
      inviteType,
      employeeStatus,
      employeeName,
    });
  }

  if (inviteType === 'onboarding' && employeeStatus !== 'Onboarding') {
    return validationFailure('This onboarding invite is no longer valid.', {
      employee_id: data.employee_id,
      email: emp.email_address,
      hasAuthUser,
      inviteType,
      employeeStatus,
      employeeName,
    });
  }

  if (inviteType === 'portal_access') {
    if (!['Active', 'Started Separation'].includes(employeeStatus)) {
      return validationFailure('Portal invites can only be used by active employees.', {
        employee_id: data.employee_id,
        email: emp.email_address,
        hasAuthUser,
        inviteType,
        employeeStatus,
        employeeName,
      });
    }

    if (hasAuthUser) {
      return validationFailure('This employee already has a portal login.', {
        employee_id: data.employee_id,
        email: emp.email_address,
        hasAuthUser,
        inviteType,
        employeeStatus,
        employeeName,
      });
    }
  }

  return {
    valid: true,
    expired: false,
    completed: false,
    employee_id: data.employee_id,
    email: emp.email_address,
    hasAuthUser,
    inviteType,
    employeeStatus,
    employeeName,
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

  const { error: linkError } = await adminClient.rpc('link_employee_invite_account', {
    p_token: token,
    p_auth_user_id: authUserId,
  });

  if (linkError) {
    console.error('[createEmployeeAccount] Failed to link auth user to employee:', linkError);
    // Attempt to clean up the orphaned auth user
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(authUserId);
    if (deleteAuthError) {
      console.error('[createEmployeeAccount] CRITICAL: Failed to delete orphaned auth user after link failure. Manual cleanup required. auth_user_id:', authUserId, deleteAuthError);
    }
    return { success: false, error: linkError.message || 'Failed to link account. Please try again.' };
  }

  return { success: true };
}

// Onboarding is employee-facing, so phone fields are optional, but a number that
// is stored exactly as typed can never be found again: every phone search in the
// app matches on E.164. This mirrors phoneNumberSchema in src/services/employees.ts,
// which is what the manager forms already apply.
const onboardingPhoneSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.union([
    z.string().transform((value, ctx) => {
      try {
        return formatPhoneForStorage(value);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Please enter a valid phone number.',
        });
        return z.NEVER;
      }
    }),
    z.null(),
  ])
).optional();

// An onboarding link is a bearer token sent by email, so getOnboardingSnapshot
// masks the NI number and bank account number rather than replaying them in full
// to anyone who reopens it. A masked value coming back on save is therefore a
// value the employee never saw: it must not be written over the real one.
const MASK_CHARACTER = '•';

/** Exactly what maskTail produces: mask characters, then the visible tail. */
const MASKED_VALUE_PATTERN = /^•+[A-Za-z0-9]*$/;

function maskTail(value: string | null | undefined, visibleTail: number): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  if (raw.length <= visibleTail) return MASK_CHARACTER.repeat(raw.length);
  return `${MASK_CHARACTER.repeat(raw.length - visibleTail)}${raw.slice(-visibleTail)}`;
}

/**
 * Optional financial field that applies the same rules as the manager edit form
 * (FinancialDetailsSchema in src/services/employees.ts). Onboarding used to accept
 * anything here, and the malformed records that produced were then rejected by the
 * edit form, so a manager could not correct them.
 *
 * Resolves to `undefined` when the submitted value is still masked, which the save
 * path reads as "leave the stored column alone".
 */
function onboardingFinancialField(options: {
  normalise: (value: string) => string;
  pattern: RegExp;
  message: string;
}) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((value, ctx): string | null | undefined => {
      if (value === null || value === undefined) return null;

      const trimmed = value.trim();
      if (trimmed === '') return null;

      // Only the exact shape maskTail emits counts as "unchanged": a run of mask
      // characters followed by the visible tail, and nothing else. Accepting any
      // value merely CONTAINING a mask character meant a half-edited entry like
      // "••••5678" was silently dropped and the save still reported success, so
      // the employee believed they had corrected a detail they had not.
      if (MASKED_VALUE_PATTERN.test(trimmed)) return undefined;
      if (trimmed.includes(MASK_CHARACTER)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Clear the field and type the full value, or leave it exactly as shown.',
        });
        return z.NEVER;
      }

      const normalised = options.normalise(trimmed);
      if (!options.pattern.test(normalised)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: options.message });
        return z.NEVER;
      }
      return normalised;
    });
}

const PersonalSectionSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  preferred_name: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  post_code: z.string().optional().nullable(),
  phone_number: onboardingPhoneSchema,
  mobile_number: onboardingPhoneSchema,
});

const EmergencyContactsSectionSchema = z.object({
  primary: z.object({
    name: z.string().min(1, 'Primary contact name is required'),
    relationship: z.string().optional().nullable(),
    phone_number: onboardingPhoneSchema,
    mobile_number: onboardingPhoneSchema,
    address: z.string().optional().nullable(),
  }),
  secondary: z.object({
    name: z.string().optional().nullable(),
    relationship: z.string().optional().nullable(),
    phone_number: onboardingPhoneSchema,
    mobile_number: onboardingPhoneSchema,
    address: z.string().optional().nullable(),
  }).optional(),
});

const FinancialSectionSchema = z.object({
  ni_number: onboardingFinancialField({
    normalise: (value) => value.replace(/\s+/g, '').toUpperCase(),
    pattern: /^[A-Z]{2}\d{6}[A-Z]$/,
    message: 'NI number must be in format: AA123456A',
  }),
  bank_name: z.string().optional().nullable(),
  payee_name: z.string().optional().nullable(),
  branch_address: z.string().optional().nullable(),
  bank_sort_code: onboardingFinancialField({
    normalise: (value) => {
      const digits = value.replace(/\D/g, '');
      return digits.length === 6
        ? `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
        : value;
    },
    pattern: /^\d{2}-\d{2}-\d{2}$/,
    message: 'Sort code must be 6 digits',
  }),
  bank_account_number: onboardingFinancialField({
    normalise: (value) => value.replace(/\s+/g, ''),
    pattern: /^\d{8}$/,
    message: 'Account number must be exactly 8 digits',
  }),
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

/**
 * Audit a persisted onboarding section write. Records field names only —
 * never PII values (the sections hold NI, bank, health and contact data).
 */
async function auditOnboardingSectionWrite(
  employeeId: string,
  employeeEmail: string | null,
  section: OnboardingSectionKey,
  fieldsWritten: string[],
) {
  await logAuditEvent({
    user_email: employeeEmail ?? undefined,
    operation_type: 'update',
    resource_type: 'employee_onboarding',
    resource_id: employeeId,
    operation_status: 'success',
    new_values: {
      section,
      fields_written: fieldsWritten,
    },
    additional_info: {
      source: 'employee_onboarding',
      contains_sensitive_values: false,
    },
  });
}

async function auditOnboardingSensitiveSectionWrite(
  employeeId: string,
  employeeEmail: string | null,
  section: Extract<OnboardingSectionKey, 'financial' | 'health'>,
) {
  await logAuditEvent({
    user_email: employeeEmail ?? undefined,
    operation_type: 'update',
    resource_type: section === 'financial' ? 'employee_financial_details' : 'employee_health_records',
    resource_id: employeeId,
    operation_status: 'success',
    new_values: {
      section,
      updated_via: 'employee_onboarding',
    },
    additional_info: {
      source: 'employee_onboarding',
      contains_sensitive_values: false,
    },
  });
}

export async function saveOnboardingSection(
  token: string,
  section: OnboardingSectionKey,
  data: unknown
): Promise<{ success: boolean; error?: string }> {
  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id) {
    return { success: false, error: 'Invalid or expired invite link.' };
  }
  if (validation.inviteType !== 'onboarding') {
    return { success: false, error: 'This link is for portal access only.' };
  }

  const adminClient = createAdminClient();
  const employeeId = validation.employee_id;

  try {
    if (section === 'personal') {
      const parsed = PersonalSectionSchema.parse(data);

      // employees_preferred_name_active_unique is a PARTIAL index: it only covers Active and
      // Started Separation. An onboarding record can therefore save a name that already belongs
      // to somebody, and the collision only surfaces at the very end when completion flips the
      // status to Active, as a raw constraint error on a screen with no field to correct.
      // Check it here instead, on the step where the name was actually typed.
      const preferredName = normalisePreferredName(parsed.preferred_name);
      if (preferredName) {
        const { data: clash } = await adminClient
          .from('employees')
          .select('employee_id, first_name, last_name')
          .in('status', ['Active', 'Started Separation'])
          .ilike('preferred_name', preferredName)
          .neq('employee_id', employeeId)
          .maybeSingle();

        if (clash) {
          return {
            success: false,
            error: `Someone here already goes by "${preferredName}". Please pick something else, for example add your first initial.`,
          };
        }
      }

      const { error } = await adminClient
        .from('employees')
        .update({
          first_name: parsed.first_name,
          last_name: parsed.last_name,
          preferred_name: preferredName,
          date_of_birth: parsed.date_of_birth ?? null,
          address: parsed.address ?? null,
          post_code: parsed.post_code ?? null,
          phone_number: parsed.phone_number ?? null,
          mobile_number: parsed.mobile_number ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('employee_id', employeeId);

      if (error) {
        // A unique index guards preferred names across current employees. Turn the raw
        // constraint error into something a new starter can act on.
        if ((error as { code?: string }).code === '23505') {
          return {
            success: false,
            error: 'Someone here already goes by that name. Please choose a different one, for example add your first initial.',
          };
        }
        throw error;
      }
      await auditOnboardingSectionWrite(employeeId, validation.email, 'personal', Object.keys(parsed));

    } else if (section === 'emergency_contacts') {
      const parsed = EmergencyContactsSectionSchema.parse(data);

      const contacts: Array<Record<string, string | null>> = [];
      if (parsed.primary.name) {
        contacts.push({
          name: parsed.primary.name,
          relationship: parsed.primary.relationship ?? null,
          phone_number: parsed.primary.phone_number ?? null,
          mobile_number: parsed.primary.mobile_number ?? null,
          address: parsed.primary.address ?? null,
          priority: 'Primary',
        });
      }
      if (parsed.secondary?.name) {
        contacts.push({
          name: parsed.secondary.name,
          relationship: parsed.secondary.relationship ?? null,
          phone_number: parsed.secondary.phone_number ?? null,
          mobile_number: parsed.secondary.mobile_number ?? null,
          address: parsed.secondary.address ?? null,
          priority: 'Secondary',
        });
      }

      const { error: contactsError } = await adminClient.rpc('replace_employee_emergency_contacts', {
        p_employee_id: employeeId,
        p_contacts: contacts,
      });

      if (contactsError) {
        console.error('[saveOnboardingSection] Failed to save emergency contacts atomically:', contactsError);
        return { success: false, error: 'Failed to save emergency contacts. Please try again.' };
      }
      await auditOnboardingSectionWrite(
        employeeId,
        validation.email,
        'emergency_contacts',
        contacts.map((contact) => String(contact.priority ?? 'unknown').toLowerCase()),
      );

    } else if (section === 'financial') {
      const parsed = FinancialSectionSchema.parse(data);

      const financialPayload: Record<string, string | null> = {
        employee_id: employeeId,
        bank_name: parsed.bank_name ?? null,
        payee_name: parsed.payee_name ?? null,
        branch_address: parsed.branch_address ?? null,
        updated_at: new Date().toISOString(),
      };

      // A masked field parses to undefined, so it is left out of the upsert and
      // the stored value survives. Anything else (including an explicit blank)
      // is written as submitted.
      if (parsed.ni_number !== undefined) financialPayload.ni_number = parsed.ni_number;
      if (parsed.bank_sort_code !== undefined) financialPayload.bank_sort_code = parsed.bank_sort_code;
      if (parsed.bank_account_number !== undefined) financialPayload.bank_account_number = parsed.bank_account_number;

      const { error } = await adminClient
        .from('employee_financial_details')
        .upsert(financialPayload, { onConflict: 'employee_id' });

      if (error) throw error;
      await auditOnboardingSensitiveSectionWrite(employeeId, validation.email, 'financial');

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
      await auditOnboardingSensitiveSectionWrite(employeeId, validation.email, 'health');
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

/**
 * Save the "time off already booked" step.
 *
 * Deliberately not routed through submitLeaveRequest: that needs an authenticated session and
 * only accepts employees who are already Active, so it rejects everyone still onboarding. The
 * database function does the whole thing in one transaction instead, so a new starter never
 * ends up with half their dates in the rota.
 */
export async function saveOnboardingTimeOff(
  token: string,
  answer: TimeOffAnswer,
  blocks: TimeOffBlock[],
  submissionVersion: number,
): Promise<{ success: true; requestsCreated: number } | { success: false; error: string; blockIndex?: number }> {
  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id) {
    return { success: false, error: TIME_OFF_ERRORS.TIME_OFF_TOKEN_EXPIRED };
  }
  if (validation.inviteType !== 'onboarding') {
    return { success: false, error: 'This link is for portal access only.' };
  }

  const adminClient = createAdminClient();

  // Once the account exists the invite link is no longer the only thing proving who this is,
  // so a forwarded link stops working.
  const boundError = await requireTokenBoundSession(validation.employee_id);
  if (boundError) return { success: false, error: boundError };

  const submitted = answer === 'has_dates' ? blocks.slice(0, MAX_BLOCKS + 1) : [];

  if (answer === 'has_dates') {
    const { data: types } = await adminClient
      .from('leave_types')
      .select('code')
      .eq('is_active', true)
      .eq('allowed_at_onboarding', true);

    const allowedTypes = new Set((types ?? []).map((row: { code: string }) => row.code));
    const problem = validateTimeOffBlocks(submitted, { allowedTypes });
    if (problem) {
      return {
        success: false,
        error: TIME_OFF_ERRORS[problem.code as TimeOffErrorCode],
        blockIndex: problem.blockIndex,
      };
    }
  }

  const { data, error } = await adminClient.rpc('save_onboarding_time_off', {
    p_token: token,
    p_answer: answer,
    p_blocks: submitted,
    p_submission_version: submissionVersion,
  });

  if (error) {
    console.error('[saveOnboardingTimeOff] RPC error:', error);
    const code = Object.keys(TIME_OFF_ERRORS).find(key => error.message?.includes(key)) as TimeOffErrorCode | undefined;
    return { success: false, error: code ? TIME_OFF_ERRORS[code] : 'Could not save these dates. Please try again.' };
  }

  const result = data as { requests_created?: number } | null;

  await logAuditEvent({
    user_email: validation.email ?? undefined,
    operation_type: 'update',
    resource_type: 'employee_onboarding',
    resource_id: validation.employee_id,
    operation_status: 'success',
    new_values: {
      section: 'time_off',
      answer,
      blocks_saved: result?.requests_created ?? 0,
    },
  });

  return { success: true, requestsCreated: result?.requests_created ?? 0 };
}

/**
 * Record that the new starter has read the right to work notice.
 *
 * This is NOT a right to work check and must never be treated as one. The check is done by a
 * manager who sees the original documents in person, or online with the applicant's share code.
 * This only records that we told them what to bring, and when.
 */
export async function acknowledgeRightToWorkNotice(
  token: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id) {
    return { success: false, error: 'Your invite link has expired. Ask your manager for a new one.' };
  }
  if (validation.inviteType !== 'onboarding') {
    return { success: false, error: 'This link is for portal access only.' };
  }

  const boundError = await requireTokenBoundSession(validation.employee_id);
  if (boundError) return { success: false, error: boundError };

  const adminClient = createAdminClient();
  const { error } = await adminClient.rpc('record_onboarding_acknowledgement', {
    p_token: token,
    p_question: 'right_to_work_notice',
  });

  if (error) {
    console.error('[acknowledgeRightToWorkNotice] RPC error:', error);
    return { success: false, error: 'Could not save that. Please try again.' };
  }

  await logAuditEvent({
    user_email: validation.email ?? undefined,
    operation_type: 'update',
    resource_type: 'employee_onboarding',
    resource_id: validation.employee_id,
    operation_status: 'success',
    new_values: { section: 'right_to_work_notice', answer: 'acknowledged' },
  });

  return { success: true };
}

/**
 * Is this preferred name free?
 *
 * Called as the starter leaves the field so they are told immediately, rather than finding out
 * when they press Save, or worse at the very end when completion flips their status to Active
 * and the partial unique index finally applies.
 */
export async function checkPreferredNameAvailability(
  token: string,
  preferredName: string,
): Promise<{ available: boolean; message?: string }> {
  const trimmed = normalisePreferredName(preferredName);
  if (!trimmed) return { available: true };

  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id) {
    // Not the moment to nag about an expired link; saving will say so properly.
    return { available: true };
  }

  const adminClient = createAdminClient();
  const { data: clash } = await adminClient
    .from('employees')
    .select('employee_id')
    .in('status', ['Active', 'Started Separation'])
    .ilike('preferred_name', trimmed)
    .neq('employee_id', validation.employee_id)
    .maybeSingle();

  if (clash) {
    return {
      available: false,
      message: `Someone here already goes by "${trimmed}". Please pick something else, for example add your first initial.`,
    };
  }

  return { available: true };
}

export async function getOnboardingSnapshot(token: string): Promise<
  { success: true; data: OnboardingSnapshot } | { success: false; error: string }
> {
  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id) {
    return { success: false, error: validation.error || 'Invalid or expired invite link.' };
  }
  if (validation.inviteType !== 'onboarding') {
    return { success: false, error: 'This link is for portal access only.' };
  }

  const adminClient = createAdminClient();
  const employeeId = validation.employee_id;

  const [employeeResult, contactsResult, financialResult, healthResult, timeOffResult, timeOffBlocksResult] = await Promise.all([
    adminClient
      .from('employees')
      .select('first_name, last_name, preferred_name, date_of_birth, address, post_code, phone_number, mobile_number')
      .eq('employee_id', employeeId)
      .maybeSingle(),
    adminClient
      .from('employee_emergency_contacts')
      .select('name, relationship, phone_number, mobile_number, address, priority')
      .eq('employee_id', employeeId),
    adminClient
      .from('employee_financial_details')
      .select('ni_number, bank_name, payee_name, branch_address, bank_sort_code, bank_account_number')
      .eq('employee_id', employeeId)
      .maybeSingle(),
    adminClient
      .from('employee_health_records')
      .select('doctor_name, doctor_address, has_allergies, allergies, had_absence_over_2_weeks_last_3_years, had_outpatient_treatment_over_3_months_last_3_years, absence_or_treatment_details, illness_history, recent_treatment, has_diabetes, has_epilepsy, has_skin_condition, has_depressive_illness, has_bowel_problems, has_ear_problems, is_registered_disabled, disability_reg_number, disability_reg_expiry_date, disability_details')
      .eq('employee_id', employeeId)
      .maybeSingle(),
    adminClient
      .from('employee_onboarding_responses')
      .select('question, answer, submission_version')
      .eq('employee_id', employeeId)
      .in('question', ['booked_time_off', 'right_to_work_notice']),
    adminClient
      .from('leave_requests')
      .select('start_date, end_date, leave_type, note')
      .eq('employee_id', employeeId)
      .eq('leave_origin', 'agreed_at_hire')
      .eq('request_channel', 'onboarding')
      .order('start_date', { ascending: true }),
  ]);

  if (employeeResult.error) {
    return { success: false, error: 'Failed to load employee details.' };
  }
  if (contactsResult.error) {
    return { success: false, error: 'Failed to load emergency contacts.' };
  }
  if (financialResult.error) {
    return { success: false, error: 'Failed to load financial details.' };
  }
  if (healthResult.error) {
    return { success: false, error: 'Failed to load health information.' };
  }

  const employee = employeeResult.data;
  const contacts = contactsResult.data ?? [];
  const primaryContact = contacts.find((contact: { priority: string | null }) => (contact.priority ?? 'Primary').toLowerCase() === 'primary');
  const secondaryContact = contacts.find((contact: { priority: string | null }) => (contact.priority ?? '').toLowerCase() === 'secondary');
  const emptyContact = {
    name: '',
    relationship: '',
    phone_number: '',
    mobile_number: '',
    address: '',
  };
  const toContact = (contact: typeof primaryContact | typeof secondaryContact) => contact ? {
    name: contact.name ?? '',
    relationship: contact.relationship ?? '',
    phone_number: contact.phone_number ?? '',
    mobile_number: contact.mobile_number ?? '',
    address: contact.address ?? '',
  } : emptyContact;

  const financial = financialResult.data;
  const health = healthResult.data;
  const responses = (timeOffResult.data ?? []) as Array<{ question: string; answer: string; submission_version: number }>;
  const timeOffResponse = responses.find(row => row.question === 'booked_time_off') ?? null;
  const rtwNoticeResponse = responses.find(row => row.question === 'right_to_work_notice') ?? null;
  const timeOffBlocks = timeOffBlocksResult.data as Array<{
    start_date: string; end_date: string; leave_type: string | null; note: string | null;
  }> | null;

  return {
    success: true,
    data: {
      personal: {
        first_name: employee?.first_name ?? '',
        last_name: employee?.last_name ?? '',
        preferred_name: employee?.preferred_name ?? '',
        date_of_birth: employee?.date_of_birth ?? '',
        address: employee?.address ?? '',
        post_code: employee?.post_code ?? '',
        phone_number: employee?.phone_number ?? '',
        mobile_number: employee?.mobile_number ?? '',
      },
      emergency_contacts: {
        primary: toContact(primaryContact),
        secondary: toContact(secondaryContact),
      },
      financial: {
        // Masked, not replayed: whoever holds the invite link has not
        // re-authenticated, so they only see enough to recognise their own
        // details. Saving the mask back leaves the stored value untouched.
        ni_number: maskTail(financial?.ni_number, 3),
        bank_name: financial?.bank_name ?? '',
        payee_name: financial?.payee_name ?? '',
        branch_address: financial?.branch_address ?? '',
        bank_sort_code: financial?.bank_sort_code ?? '',
        bank_account_number: maskTail(financial?.bank_account_number, 4),
      },
      health: {
        doctor_name: health?.doctor_name ?? '',
        doctor_address: health?.doctor_address ?? '',
        has_allergies: health?.has_allergies ?? false,
        allergies: health?.allergies ?? '',
        had_absence_over_2_weeks_last_3_years: health?.had_absence_over_2_weeks_last_3_years ?? false,
        had_outpatient_treatment_over_3_months_last_3_years: health?.had_outpatient_treatment_over_3_months_last_3_years ?? false,
        absence_or_treatment_details: health?.absence_or_treatment_details ?? '',
        illness_history: health?.illness_history ?? '',
        recent_treatment: health?.recent_treatment ?? '',
        has_diabetes: health?.has_diabetes ?? false,
        has_epilepsy: health?.has_epilepsy ?? false,
        has_skin_condition: health?.has_skin_condition ?? false,
        has_depressive_illness: health?.has_depressive_illness ?? false,
        has_bowel_problems: health?.has_bowel_problems ?? false,
        has_ear_problems: health?.has_ear_problems ?? false,
        is_registered_disabled: health?.is_registered_disabled ?? false,
        disability_reg_number: health?.disability_reg_number ?? '',
        disability_reg_expiry_date: health?.disability_reg_expiry_date ?? '',
        disability_details: health?.disability_details ?? '',
      },
      time_off: {
        // Read from the stored answer, never inferred from whether leave rows exist.
        // "I have nothing booked" is a real answer that writes no leave.
        answer: (timeOffResponse?.answer as TimeOffAnswer | undefined) ?? null,
        submissionVersion: timeOffResponse?.submission_version ?? 0,
        blocks: (timeOffBlocks ?? []).map(block => ({
          startDate: block.start_date,
          endDate: block.end_date,
          leaveType: block.leave_type ?? 'holiday',
          note: block.note ?? '',
        })),
      },
      right_to_work_notice: { acknowledged: rtwNoticeResponse?.answer === 'acknowledged' },
      completedSections: {
        personal: Boolean(employee?.first_name && employee?.last_name),
        emergency_contacts: Boolean(primaryContact?.name),
        financial: Boolean(financial),
        health: Boolean(health),
        time_off: Boolean(timeOffResponse?.answer),
        right_to_work_notice: rtwNoticeResponse?.answer === 'acknowledged',
      },
    },
  };
}

export async function submitOnboardingProfile(token: string): Promise<{ success: boolean; error?: string }> {
  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id || !validation.email) {
    return { success: false, error: 'Invalid or expired invite link.' };
  }
  if (validation.inviteType !== 'onboarding') {
    return { success: false, error: 'This link is for portal access only.' };
  }

  const adminClient = createAdminClient();

  const { data: completionData, error: completionError } = await adminClient.rpc('complete_employee_onboarding', {
    p_token: token,
  });

  if (completionError) {
    console.error('[submitOnboardingProfile] Failed to complete onboarding:', completionError);

    // The preferred name index only applies to Active and Started Separation, so a clash can
    // only ever surface here, at the moment completion flips the status. Raw constraint text on
    // the final screen is a dead end: it names a database index and there is no field on that
    // screen to change. Say what to do instead.
    const message = completionError.message ?? '';
    if (message.includes('employees_preferred_name_active_unique') || (completionError as { code?: string }).code === '23505') {
      return {
        success: false,
        error: 'Someone here already goes by the preferred name you chose. Please go back to Personal Details and pick a different one, for example add your first initial.',
      };
    }

    return { success: false, error: message || 'Failed to complete profile. Please try again.' };
  }

  const completion = completionData as {
    employee_id: string;
    email: string;
    first_name: string;
    last_name: string;
    auth_user_id: string | null;
    onboarding_completed_at: string;
  } | null;

  if (!completion?.employee_id || !completion.email) {
    return { success: false, error: 'Profile completed but completion data was not returned.' };
  }

  const fullName = [completion.first_name, completion.last_name].filter(Boolean).join(' ');

  if (completion.auth_user_id && fullName) {
    const { error: profileUpdateError } = await adminClient
      .from('profiles')
      .update({
        full_name: fullName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', completion.auth_user_id);

    if (profileUpdateError) {
      console.error('[submitOnboardingProfile] Failed to update profile name:', profileUpdateError);
    }
  }

  // Send completion email to manager (best-effort)
  try {
    await sendOnboardingCompleteEmail(fullName, validation.email);
  } catch (emailError) {
    console.error('[submitOnboardingProfile] Failed to send completion email:', emailError);
  }

  // Audit log
  try {
    await logAuditEvent({
        operation_type: 'onboarding_complete',
        resource_type: 'employee',
        resource_id: completion.employee_id,
        operation_status: 'success',
        new_values: { status: 'Active', onboarding_completed_at: completion.onboarding_completed_at },
      });
  } catch (auditError) {
    console.error('[submitOnboardingProfile] Audit log failed:', auditError);
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Status transition actions
// ---------------------------------------------------------------------------

type BeginSeparationOptions = {
  employmentEndDate?: string;
  note?: string;
};

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type BeginSeparationEmployee = {
  email_address: string;
  first_name: string | null;
  last_name: string | null;
  employment_end_date: string | null;
  status: string;
};

type SeparationShiftRow = {
  shift_date: string;
  start_time: string;
  end_time: string;
  department: string | null;
};

async function getRemainingSeparationShifts(
  adminClient: ReturnType<typeof createAdminClient>,
  employeeId: string,
  employmentEndDate: string | undefined,
  todayIso: string,
): Promise<{ shifts: SeparationShiftSummary[]; error?: string }> {
  if (!employmentEndDate || employmentEndDate <= todayIso) {
    return { shifts: [] };
  }

  const { data, error } = await adminClient
    .from('rota_shifts')
    .select('shift_date, start_time, end_time, department')
    .eq('employee_id', employeeId)
    .gte('shift_date', todayIso)
    .lte('shift_date', employmentEndDate)
    .neq('status', 'cancelled')
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) {
    console.error('[beginSeparation] Failed to load remaining shifts:', error);
    return { shifts: [], error: 'Failed to load remaining scheduled shifts.' };
  }

  return {
    shifts: ((data ?? []) as SeparationShiftRow[]).map((shift) => ({
      shiftDate: shift.shift_date,
      startTime: shift.start_time,
      endTime: shift.end_time,
      department: shift.department,
    })),
  };
}

// H13 fix: added count check — returns error when 0 rows updated (employee not in Active status)
export async function beginSeparation(
  employeeId: string,
  options: BeginSeparationOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const canEdit = await checkUserPermission('employees', 'edit');
  if (!canEdit) {
    return { success: false, error: 'You do not have permission to perform this action.' };
  }

  const employmentEndDate = options.employmentEndDate?.trim() || undefined;
  if (employmentEndDate && !isoDateSchema.safeParse(employmentEndDate).success) {
    return { success: false, error: 'Last working day must be a valid date.' };
  }

  const note = options.note?.trim();
  if (note && note.length > 500) {
    return { success: false, error: 'Separation note must be 500 characters or fewer.' };
  }

  const adminClient = createAdminClient();
  const todayIso = getTodayIsoDate();

  const { data: employee, error: employeeError } = await adminClient
    .from('employees')
    .select('email_address, first_name, last_name, employment_end_date, status')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (employeeError) {
    console.error('[beginSeparation] Failed to load employee:', employeeError);
    return { success: false, error: 'Failed to load employee.' };
  }

  if (!employee || (employee as BeginSeparationEmployee).status !== 'Active') {
    return { success: false, error: 'Employee status could not be updated. They may not be in Active status.' };
  }

  const employeeForEmail = employee as BeginSeparationEmployee;
  const shiftsResult = await getRemainingSeparationShifts(
    adminClient,
    employeeId,
    employmentEndDate,
    todayIso,
  );
  if (shiftsResult.error) {
    return { success: false, error: shiftsResult.error };
  }

  const updatePayload: Record<string, string> = {
    status: 'Started Separation',
    updated_at: new Date().toISOString(),
  };
  if (employmentEndDate) {
    updatePayload.employment_end_date = employmentEndDate;
  }

  const { data: updated, error } = await adminClient
    .from('employees')
    .update(updatePayload)
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
    const employeeName = [employeeForEmail.first_name, employeeForEmail.last_name].filter(Boolean).join(' ') || null;
    await sendSeparationStartedEmail({
      email: employeeForEmail.email_address,
      employeeName,
      employmentEndDate,
      todayIso,
      remainingShifts: shiftsResult.shifts,
    });
  } catch (emailError) {
    console.error('[beginSeparation] Failed to send separation email:', emailError);

    const { error: rollbackError } = await adminClient
      .from('employees')
      .update({
        status: 'Active',
        employment_end_date: employeeForEmail.employment_end_date,
        updated_at: new Date().toISOString(),
      })
      .eq('employee_id', employeeId)
      .eq('status', 'Started Separation');

    if (rollbackError) {
      console.error('[beginSeparation] Failed to roll back separation status after email failure:', rollbackError);
      return {
        success: false,
        error: 'Employee status was updated, but the separation email could not be sent. Please send the employee confirmation manually.',
      };
    }

    return {
      success: false,
      error: 'Separation email could not be sent, so the employee was left in Active status.',
    };
  }

  const user = await getCurrentUser();

  if (employmentEndDate || note) {
    const noteText = [
      'Separation started.',
      employmentEndDate ? `Last working day: ${employmentEndDate}.` : null,
      note ? `Note: ${note}` : null,
    ].filter(Boolean).join(' ');

    const { error: noteError } = await adminClient
      .from('employee_notes')
      .insert({
        employee_id: employeeId,
        note_text: noteText,
        created_by_user_id: user?.user_id ?? null,
      });

    if (noteError) {
      console.error('[beginSeparation] Failed to add separation note:', noteError);
    }
  }

  try {
    await logAuditEvent({
      user_id: user?.user_id ?? undefined,
      user_email: user?.user_email ?? undefined,
      operation_type: 'status_change',
      resource_type: 'employee',
      resource_id: employeeId,
      operation_status: 'success',
      new_values: { status: 'Started Separation', employment_end_date: employmentEndDate ?? null },
    });
  } catch (auditError) {
    console.error('[beginSeparation] Audit log failed:', auditError);
  }

  revalidatePath('/employees');
  revalidatePath(`/employees/${employeeId}`);
  return { success: true };
}

export async function revokeEmployeeAccess(employeeId: string): Promise<{ success: boolean; error?: string }> {
  const canEdit = await checkUserPermission('employees', 'edit');
  if (!canEdit) {
    return { success: false, error: 'You do not have permission to perform this action.' };
  }

  const user = await getCurrentUser();
  const result = await finalizeEmployeeSeparation(employeeId, {
    actorUser: user,
    source: 'manual',
    blockShiftsOnOrAfterToday: false,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true };
}
