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
  type OnboardingCompleteEmailInput,
} from '@/lib/email/employee-invite-emails';
import { normalisePreferredName } from '@/lib/employees/display-name';
import { normalizePersonName } from '@/lib/names';
import {
  resolveOnboardingSessionError,
  SIGN_IN_REQUIRED_MESSAGE,
  type OnboardingAccessCode,
  type OnboardingAccessProblem,
} from '@/lib/employees/onboarding-session';
import {
  ACCOUNT_NUMBER_VISIBLE_TAIL,
  MASK_CHARACTER,
  MASKED_VALUE_PATTERN,
  NI_NUMBER_VISIBLE_TAIL,
  ONBOARDING_INCOMPLETE_MESSAGES,
  isEmergencyContactsComplete,
  isFinancialComplete,
  isPersonalComplete,
  maskTail,
  type OnboardingSectionKey,
} from '@/lib/employees/onboarding-rules';
import {
  ACCOUNT_NUMBER_MESSAGE,
  ACCOUNT_NUMBER_PATTERN,
  NI_NUMBER_MESSAGE,
  NI_NUMBER_PATTERN,
  SORT_CODE_MESSAGE,
  SORT_CODE_PATTERN,
  ageOnDate,
  dateOfBirthError,
  isUnder18,
  normaliseAccountNumber,
  normaliseNiNumber,
  normaliseSortCode,
} from '@/lib/employees/field-rules';
import { inviteTokenProblem, type InviteTokenProblem } from '@/lib/employees/invite-token-rules';
import { passwordError } from '@/lib/employees/password-rule';
import { AuthService } from '@/services/auth';
import { formatPhoneForStorage } from '@/lib/utils';
import { getTodayIsoDate, isValidIsoDate } from '@/lib/dateUtils';
import { getAppUrl } from '@/lib/env';

// DEF-015 verified: the employee_invite_tokens table column is defined as
// `expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'`
// in migration 20260227000001_employee_invite_onboarding.sql.
// The create_employee_invite RPC relies on this default. Welcome and portal
// invite emails both promise "7 days": this matches the DB constraint.

function buildOnboardingUrl(token: string): string {
  return `${getAppUrl()}/onboarding/${token}`;
}

export type InviteType = 'onboarding' | 'portal_access';
type EmployeeStatus = 'Onboarding' | 'Active' | 'Started Separation' | 'Former';

/**
 * A refused onboarding action. `code` says the browser needs a session for this starter (or has
 * someone else's), so the wizard can offer to sign in. `fieldErrors` ties each message to the
 * field it is about, keyed by the field's path ("date_of_birth", "primary.phone_number").
 */
export type OnboardingActionFailure = {
  success: false;
  error: string;
  code?: OnboardingAccessCode;
  fieldErrors?: Record<string, string>;
};

/** What the financial step shows after a save: the masked NI and account number, as on reload. */
export type SavedFinancialDisplay = {
  ni_number: string;
  bank_sort_code: string;
  bank_account_number: string;
};

const SAVE_FAILED_MESSAGE = 'We could not save your details just now. Please try again in a moment.';

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
 * Server side wrapper around resolveOnboardingSessionError. See that function for the rule: once
 * the starter has an account, the link only works alongside a session for that account.
 *
 * Reads auth_user_id fresh rather than trusting validateInviteToken's hasAuthUser, so an account
 * made in another tab a moment ago counts. The cookie session is only read when there is an
 * account to compare it with. `knownSessionUserId` is for a caller that has just signed in and
 * already knows who it is (the new cookie is not readable in the same request).
 */
async function requireTokenBoundSession(
  employeeId: string,
  knownSessionUserId?: string | null,
): Promise<OnboardingAccessProblem | { code?: undefined; message: string } | null> {
  const adminClient = createAdminClient();
  const { data: employee, error } = await adminClient
    .from('employees')
    .select('auth_user_id')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (error) {
    // Fail closed: without the row we cannot tell whether a session is needed.
    console.error('[employeeInvite] Could not read the employee to check the session:', error);
    return { message: 'We could not check who is signed in. Please reload the page and try again.' };
  }

  const employeeAuthUserId = (employee as { auth_user_id: string | null } | null)?.auth_user_id ?? null;
  if (!employeeAuthUserId) {
    return resolveOnboardingSessionError({ employeeAuthUserId: null, sessionUserId: null });
  }

  if (knownSessionUserId !== undefined) {
    return resolveOnboardingSessionError({ employeeAuthUserId, sessionUserId: knownSessionUserId });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return resolveOnboardingSessionError({
    employeeAuthUserId,
    sessionUserId: user?.id ?? null,
  });
}

function accessFailure(problem: { code?: OnboardingAccessCode; message: string }): OnboardingActionFailure {
  return problem.code
    ? { success: false, error: problem.message, code: problem.code }
    : { success: false, error: problem.message };
}

/** Zod issues keyed by field path, first message per field. */
function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.errors) {
    const key = issue.path.join('.');
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

// ---------------------------------------------------------------------------
// Manager-side actions
// ---------------------------------------------------------------------------

/**
 * Records an invite attempt, whether or not the email went. A failed send is recorded as a
 * failure with its reason, so the audit log never says an invite was sent when it was not.
 */
async function auditInviteAttempt(input: {
  employeeId: string;
  status: 'success' | 'failure';
  values?: Record<string, unknown>;
  error?: string;
}): Promise<void> {
  try {
    const user = await getCurrentUser();
    await logAuditEvent({
      user_id: user?.user_id ?? undefined,
      user_email: user?.user_email ?? undefined,
      operation_type: 'invite',
      resource_type: 'employee',
      resource_id: input.employeeId,
      operation_status: input.status,
      ...(input.error ? { error_message: input.error } : {}),
      ...(input.values ? { new_values: input.values } : {}),
    });
  } catch (auditError) {
    console.error('[employeeInvite] Audit log failed:', auditError);
  }
}

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

  // Only the browser checked the start date, so an impossible date went straight to the
  // database. The invite form requires one; the recruitment hire hand-off sends none (staff add
  // it on the record later), so a missing date is allowed here and a given one must be real.
  if (employmentStartDate && !isValidIsoDate(employmentStartDate)) {
    return { type: 'error', message: 'Enter a real employment start date.' };
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

    // The email is what makes the invite real: the new starter cannot do anything without the
    // link. So a failed send undoes the half-made record rather than leaving a blank employee
    // nobody can explain, and staff are told the invite did not go.
    try {
      await sendWelcomeEmail(email, buildOnboardingUrl(result.token));
    } catch (emailError) {
      console.error('[inviteEmployee] Failed to send welcome email:', emailError);
      const reason = getErrorMessage(emailError);
      const { error: cleanupError } = await adminClient
        .from('employees')
        .delete()
        .eq('employee_id', result.employee_id)
        .eq('status', 'Onboarding')
        .is('auth_user_id', null);
      if (cleanupError) {
        console.error('[inviteEmployee] Failed to clean up invite-created employee:', cleanupError);
      }
      await auditInviteAttempt({
        employeeId: result.employee_id,
        status: 'failure',
        error: reason,
        values: { email, job_title: jobTitle, employment_start_date: employmentStartDate, cleaned_up: !cleanupError },
      });
      revalidatePath('/employees');
      return {
        type: 'error',
        message: cleanupError
          ? `The invite email could not be sent (${reason}), and the part-made employee record could not be removed. Check the employee list before trying again.`
          : `The invite email could not be sent (${reason}). Nothing reached them and no employee record was made, so check the email address and try again.`,
      };
    }

    await auditInviteAttempt({
      employeeId: result.employee_id,
      status: 'success',
      values: { email, job_title: jobTitle, employment_start_date: employmentStartDate, status: 'Onboarding' },
    });

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

  // DEF-009: If email fails, clean up the orphaned token before returning error. Older portal
  // links are left alone until the new one has actually gone (below), so a failed send never
  // leaves the employee with no working link.
  try {
    await sendPortalInviteEmail(employee.email_address, buildOnboardingUrl(tokenData.token));
  } catch (emailError) {
    console.error('[sendPortalInvite] Failed to send email:', emailError);
    const reason = getErrorMessage(emailError);
    await deleteTokenByValue(adminClient, tokenData.token);
    await auditInviteAttempt({ employeeId, status: 'failure', error: reason, values: { portal_invite_sent: false } });
    return {
      type: 'error',
      message: `The portal invite email could not be sent (${reason}). Nothing reached them, and any link they already had still works. Check the email address and try again.`,
    };
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

  await auditInviteAttempt({ employeeId, status: 'success', values: { portal_invite_sent: true } });

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

  // Older onboarding links are expired only after the new email has gone (below). A resend whose
  // email failed must not take away the link the employee may already be holding.
  try {
    await sendWelcomeEmail(employee.email_address, buildOnboardingUrl(tokenData.token));
  } catch (emailError) {
    console.error('[resendInvite] Failed to send email:', emailError);
    const reason = getErrorMessage(emailError);
    await deleteTokenByValue(adminClient, tokenData.token);
    await auditInviteAttempt({ employeeId, status: 'failure', error: reason, values: { invite_resent: false } });
    return {
      type: 'error',
      message: `The invite email could not be sent (${reason}). Nothing reached them, and any link they already had still works. Check the email address and try again.`,
    };
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

  await auditInviteAttempt({ employeeId, status: 'success', values: { invite_resent: true } });

  return { type: 'success', message: `Invite resent to ${employee.email_address}.` };
}

// ---------------------------------------------------------------------------
// Employee-side actions (token-authenticated, no permission check)
// ---------------------------------------------------------------------------

const INVITE_TOKEN_PROBLEM_MESSAGES: Record<InviteTokenProblem, string> = {
  email_changed: 'Invite link no longer matches the employee email address.',
  onboarding_finished: 'This onboarding invite is no longer valid.',
  not_active: 'Portal invites can only be used by active employees.',
  has_login: 'This employee already has a portal login.',
};

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
  const employeeName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || null;

  // The same rules the chase cron applies before it sends a reminder (invite-token-rules.ts).
  const problem = inviteTokenProblem({ inviteType, tokenEmail: data.email, employee: emp });
  if (problem) {
    return validationFailure(INVITE_TOKEN_PROBLEM_MESSAGES[problem], {
      employee_id: data.employee_id,
      email: emp.email_address,
      hasAuthUser,
      inviteType,
      employeeStatus,
      employeeName,
    });
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

/**
 * The messages our own invite and onboarding database functions raise. They are written for the
 * starter, so they may be shown as they are. Anything else a database call returns (a constraint
 * name, a connection error) is logged and replaced with a plain message.
 */
const PLAIN_INVITE_RPC_MESSAGES = new Set([
  'Invalid invite link.',
  'This link is not for employee onboarding.',
  'Invite link has already been used.',
  'Invite link has expired.',
  'Employee not found.',
  'Invite link no longer matches the employee email address.',
  'Account already created. Please sign in.',
  'This onboarding invite is no longer valid.',
  'Portal invites can only be used by active employees.',
  'Create your account before completing onboarding.',
  'Personal details must be completed before submitting.',
  'Primary emergency contact must be completed before submitting.',
  'Financial details must be saved before submitting.',
  'Health information must be saved before submitting.',
  'Tell us about any time off you have already booked before submitting.',
  'Please confirm you have read what to bring for your right to work check.',
]);

function plainRpcMessage(message: string | null | undefined, fallback: string): string {
  const trimmed = (message ?? '').trim();
  return PLAIN_INVITE_RPC_MESSAGES.has(trimmed) ? trimmed : fallback;
}

/**
 * Supabase's admin createUser says an address is taken with the code `email_exists` (message "A
 * user with this email address has already been registered"). The old check looked for "already
 * registered", which that message does not contain, so a starter in that position only ever saw
 * "Failed to create account". The message is kept as a fallback for older servers.
 */
function isEmailTakenError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('already been registered') || message.includes('already registered');
}

const EMAIL_TAKEN_MESSAGE =
  'There is already a login for this email address, so we cannot create a new one. Please ask your manager to sort this out: they can check the login or send your invite to a different email address.';

export async function createEmployeeAccount(
  token: string,
  password: string,
): Promise<
  | { success: true; signedIn?: boolean }
  | { success: false; error: string; fieldErrors?: Record<string, string>; code?: 'sign_in_required' }
> {
  const passwordProblem = passwordError(password);
  if (passwordProblem) {
    return { success: false, error: passwordProblem, fieldErrors: { password: passwordProblem } };
  }

  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id || !validation.email) {
    return { success: false, error: validation.error || 'Invalid or expired invite link.' };
  }

  // A second tab, or a lost response after the account was made. The page moves on to its
  // sign-in form on this code; with no code the starter was stuck on the password form.
  if (validation.hasAuthUser) {
    return { success: false, error: SIGN_IN_REQUIRED_MESSAGE, code: 'sign_in_required' };
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
    if (isEmailTakenError(authError as { code?: string; message?: string })) {
      return { success: false, error: EMAIL_TAKEN_MESSAGE };
    }
    return { success: false, error: 'We could not create your account just now. Please try again in a moment.' };
  }

  const authUserId = authData.user?.id;
  if (!authUserId) {
    // Edge case: auth user was created but no ID returned. Cleanup is not possible without the
    // ID, so a retry will meet "email exists": point them at their manager now.
    console.error('[createEmployeeAccount] CRITICAL: createUser returned no user id for an onboarding invite.');
    return { success: false, error: 'Something went wrong creating your account. Please ask your manager for help before you try again.' };
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
      try {
        await logAuditEvent({
          user_email: validation.email ?? undefined,
          operation_type: 'create_account',
          resource_type: 'employee',
          resource_id: validation.employee_id,
          operation_status: 'failure',
          error_message: 'Login created but not linked to the employee, and could not be removed. Remove it by hand before the starter tries again.',
          additional_info: { orphaned_auth_user_id: authUserId },
        });
      } catch (auditError) {
        console.error('[createEmployeeAccount] Audit log failed:', auditError);
      }
      // The orphaned login now holds their email address, so trying again would only meet
      // "email exists". Tell them who can fix it rather than to retry.
      return { success: false, error: 'Something went wrong creating your account. Please ask your manager for help before you try again.' };
    }
    return {
      success: false,
      error: plainRpcMessage(linkError.message, 'We could not create your account just now. Please try again in a moment.'),
    };
  }

  // Portal access ends here: linking completes that link, so it cannot be reused anyway.
  if (validation.inviteType !== 'onboarding') {
    return { success: true };
  }

  // Sign this browser in as the new account. From here the onboarding link only works alongside
  // that session (onboarding-session.ts), so a forwarded link stops working once a password is
  // set. A failed sign-in does not undo the account: the starter is asked to sign in and carries on.
  try {
    const supabase = await createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: validation.email,
      password,
    });
    if (signInError) {
      console.error('[createEmployeeAccount] Account made but the browser could not be signed in:', signInError);
      return { success: true, signedIn: false };
    }
  } catch (signInError) {
    console.error('[createEmployeeAccount] Account made but the browser could not be signed in:', signInError);
    return { success: true, signedIn: false };
  }

  return { success: true, signedIn: true };
}

/**
 * Sign in on the onboarding page, for a starter who already set a password and has come back
 * without a session (another device, a cleared browser). The email is the one the invite was sent
 * to, so the link alone is still not enough: they need the password too.
 *
 * Goes through AuthService.signIn, the same path as the login page: its rate limit, its generic
 * failure message and its audit rows. The login page itself cannot bring them back here, because
 * the sign-in action sends anyone without a role (every new starter) to the staff portal.
 */
/**
 * The address the starter's login was made with. Staff can correct the email on the employee
 * record after the starter set a password, and nothing changes the login's own address, so signing
 * in with the record's current address would fail for good. Null when it cannot be read.
 */
async function readLinkedLoginEmail(employeeId: string): Promise<string | null> {
  const adminClient = createAdminClient();
  const { data: employee, error } = await adminClient
    .from('employees')
    .select('auth_user_id')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (error) {
    console.error('[signInToOnboarding] Could not read the employee for sign in:', {
      code: error.code,
      message: error.message,
    });
    return null;
  }

  const authUserId = (employee as { auth_user_id: string | null } | null)?.auth_user_id ?? null;
  if (!authUserId) return null;

  const { data, error: userError } = await adminClient.auth.admin.getUserById(authUserId);
  if (userError || !data?.user?.email) {
    console.error('[signInToOnboarding] Could not read the login for sign in:', {
      code: userError?.code,
      message: userError?.message,
    });
    return null;
  }
  return data.user.email;
}

export async function signInToOnboarding(
  token: string,
  password: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id || !validation.email) {
    return { success: false, error: 'This invite link is no longer valid. Please ask your manager for a new one.' };
  }
  if (validation.inviteType !== 'onboarding') {
    return { success: false, error: 'This link is for portal access only.' };
  }
  if (!validation.hasAuthUser) {
    return { success: false, error: 'You have not set a password yet. Reload the page to create one.' };
  }
  if (!password) {
    return { success: false, error: 'Enter your password.' };
  }

  const loginEmail = await readLinkedLoginEmail(validation.employee_id);
  if (!loginEmail) {
    return { success: false, error: 'We could not sign you in just now. Please try again in a moment.' };
  }

  let signedInUserId: string | undefined;
  try {
    const result = await AuthService.signIn(loginEmail, password);
    signedInUserId = result.userId;
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (message.includes('Too many requests')) {
      return { success: false, error: 'Too many attempts. Please wait a minute and try again.' };
    }
    if (message.includes('Invalid email or password')) {
      return { success: false, error: 'That password is not right. Please try again, or reset it.' };
    }
    console.error('[signInToOnboarding] Sign in failed:', error);
    return { success: false, error: 'We could not sign you in just now. Please try again in a moment.' };
  }

  // The email belongs to this employee's login, so the account should be theirs. Check rather than
  // assume, and never leave someone else's session behind on a mismatch.
  const boundError = await requireTokenBoundSession(validation.employee_id, signedInUserId ?? null);
  if (boundError) {
    try {
      const supabase = await createClient();
      await supabase.auth.signOut({ scope: 'local' });
    } catch (signOutError) {
      console.error('[signInToOnboarding] Could not sign out a mismatched session:', signOutError);
    }
    return { success: false, error: boundError.message };
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
// value the employee never saw: it must not be written over the real one. The
// mask itself lives in onboarding-rules.ts, so the wizard can keep it after a save.

/**
 * Optional financial field that applies the same rules as the manager edit form
 * (FinancialDetailsSchema in src/services/employees.ts). Onboarding used to accept
 * anything here, and the malformed records that produced were then rejected by the
 * edit form, so a manager could not correct them.
 *
 * Resolves to `undefined` when the submitted value is still masked, which the save
 * path reads as "leave the stored column alone".
 */
const HALF_EDITED_MASK_MESSAGE = 'Clear the field and type the full value, or leave it exactly as shown.';

/** The masked fields, and how much of each the snapshot shows. The sort code is shown in full. */
const MASKED_FINANCIAL_TAILS: Record<keyof SavedFinancialDisplay, number | null> = {
  ni_number: NI_NUMBER_VISIBLE_TAIL,
  bank_sort_code: null,
  bank_account_number: ACCOUNT_NUMBER_VISIBLE_TAIL,
};

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
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: HALF_EDITED_MASK_MESSAGE });
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
  first_name: z.string().trim().min(1, 'First name is required'),
  last_name: z.string().trim().min(1, 'Last name is required'),
  preferred_name: z.string().optional().nullable(),
  // Required, and a real date that makes them 16 to 100 (field-rules.ts, shared with the staff
  // forms). It was optional and unchecked, so a profile could go Active with no age on record.
  date_of_birth: z
    .string({ required_error: 'Date of birth is required', invalid_type_error: 'Date of birth is required' })
    .trim()
    .superRefine((value, ctx) => {
      const problem = dateOfBirthError(value);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }),
  address: z.string().optional().nullable(),
  post_code: z.string().optional().nullable(),
  phone_number: onboardingPhoneSchema,
  mobile_number: onboardingPhoneSchema,
});

const PRIMARY_CONTACT_PHONE_MESSAGE = 'Add a phone or mobile number for your main contact.';

const EmergencyContactsSectionSchema = z.object({
  primary: z.object({
    name: z.string().trim().min(1, 'Primary contact name is required'),
    relationship: z.string().optional().nullable(),
    phone_number: onboardingPhoneSchema,
    mobile_number: onboardingPhoneSchema,
    address: z.string().optional().nullable(),
  }).superRefine((contact, ctx) => {
    // An emergency contact with no number cannot be rung in an emergency.
    if (!contact.phone_number && !contact.mobile_number) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone_number'], message: PRIMARY_CONTACT_PHONE_MESSAGE });
    }
  }),
  secondary: z.object({
    name: z.string().optional().nullable(),
    relationship: z.string().optional().nullable(),
    phone_number: onboardingPhoneSchema,
    mobile_number: onboardingPhoneSchema,
    address: z.string().optional().nullable(),
  }).optional(),
});

// Each field may be saved blank here, so a starter without their bank details to hand can carry
// on. Submitting needs the sort code and account number (isFinancialComplete); the NI number stays
// optional, as they can give it to their manager later.
const FinancialSectionSchema = z.object({
  ni_number: onboardingFinancialField({
    normalise: normaliseNiNumber,
    pattern: NI_NUMBER_PATTERN,
    message: NI_NUMBER_MESSAGE,
  }),
  bank_name: z.string().optional().nullable(),
  payee_name: z.string().optional().nullable(),
  branch_address: z.string().optional().nullable(),
  bank_sort_code: onboardingFinancialField({
    normalise: normaliseSortCode,
    pattern: SORT_CODE_PATTERN,
    message: SORT_CODE_MESSAGE,
  }),
  bank_account_number: onboardingFinancialField({
    normalise: normaliseAccountNumber,
    pattern: ACCOUNT_NUMBER_PATTERN,
    message: ACCOUNT_NUMBER_MESSAGE,
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
 * Audit a persisted onboarding section write. Records field names only:
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
): Promise<{ success: true; saved?: SavedFinancialDisplay } | OnboardingActionFailure> {
  // A section this action does not write used to fall through every branch and report success,
  // so the starter was told something was saved when nothing was.
  if (!SAVEABLE_SECTIONS.has(section)) {
    return { success: false, error: 'That part of the form cannot be saved here.' };
  }

  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id) {
    return { success: false, error: 'Invalid or expired invite link.' };
  }
  if (validation.inviteType !== 'onboarding') {
    return { success: false, error: 'This link is for portal access only.' };
  }

  // Once the account exists the invite link is no longer the only thing proving who this is,
  // so a forwarded link stops working.
  const boundError = await requireTokenBoundSession(validation.employee_id);
  if (boundError) return accessFailure(boundError);

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
          const message = `Someone here already goes by "${preferredName}". Please pick something else, for example add your first initial.`;
          return { success: false, error: message, fieldErrors: { preferred_name: message } };
        }
      }

      const { error } = await adminClient
        .from('employees')
        .update({
          // Tidied the same way as the staff forms (EmployeeService), so the worker agreement, the
          // signing request and the record all carry one spelling of the name.
          first_name: normalizePersonName(parsed.first_name) || parsed.first_name,
          last_name: normalizePersonName(parsed.last_name) || parsed.last_name,
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
          const message = 'Someone here already goes by that name. Please choose a different one, for example add your first initial.';
          return { success: false, error: message, fieldErrors: { preferred_name: message } };
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
      const submitted = (data ?? {}) as Partial<Record<keyof SavedFinancialDisplay, string | null>>;

      // A mask-shaped value is only "unchanged" when it is exactly the mask of what is stored.
      // The shape alone let an edit such as one more digit typed after the mask be dropped while
      // the save reported success.
      const maskedFields = (Object.keys(MASKED_FINANCIAL_TAILS) as Array<keyof SavedFinancialDisplay>)
        .filter((field) => parsed[field] === undefined);
      if (maskedFields.length > 0) {
        const { data: stored, error: storedError } = await adminClient
          .from('employee_financial_details')
          .select('ni_number, bank_sort_code, bank_account_number')
          .eq('employee_id', employeeId)
          .maybeSingle();
        if (storedError) throw storedError;

        const maskErrors: Record<string, string> = {};
        for (const field of maskedFields) {
          const tail = MASKED_FINANCIAL_TAILS[field];
          const storedValue = (stored as Partial<Record<keyof SavedFinancialDisplay, string | null>> | null)?.[field] ?? null;
          const expected = tail && storedValue ? maskTail(storedValue, tail) : null;
          if (!expected || expected !== (submitted[field] ?? '').trim()) {
            maskErrors[field] = HALF_EDITED_MASK_MESSAGE;
          }
        }
        if (Object.keys(maskErrors).length > 0) {
          return {
            success: false,
            error: Object.keys(maskErrors).length > 1 ? 'Please check the fields marked below.' : HALF_EDITED_MASK_MESSAGE,
            fieldErrors: maskErrors,
          };
        }
      }

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

      // Hand back what the step should show if the starter goes Back: the same masked values a
      // reload would show. A field left masked was not changed, so its mask stands.
      const display = (value: string | null | undefined, submittedValue: string | null | undefined, visibleTail?: number) => {
        if (value === undefined) return (submittedValue ?? '').trim();
        if (value === null) return '';
        return visibleTail ? maskTail(value, visibleTail) : value;
      };
      return {
        success: true,
        saved: {
          ni_number: display(parsed.ni_number, submitted.ni_number, NI_NUMBER_VISIBLE_TAIL),
          bank_sort_code: display(parsed.bank_sort_code, submitted.bank_sort_code),
          bank_account_number: display(parsed.bank_account_number, submitted.bank_account_number, ACCOUNT_NUMBER_VISIBLE_TAIL),
        },
      };

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
    if (err instanceof z.ZodError) {
      // Each message goes back against its own field, so the step can show it under the input.
      const fieldErrors = zodFieldErrors(err);
      const count = Object.keys(fieldErrors).length;
      return {
        success: false,
        error: count > 1 ? 'Please check the fields marked below.' : (err.errors[0]?.message || 'Please check the fields marked below.'),
        fieldErrors,
      };
    }
    // Database text (constraint names, connection errors) is for the log, not the starter.
    console.error(`[saveOnboardingSection] Section ${section} error:`, err);
    return { success: false, error: SAVE_FAILED_MESSAGE };
  }
}

/** The sections saveOnboardingSection writes. Time off and right to work have their own actions. */
const SAVEABLE_SECTIONS = new Set<string>(['personal', 'emergency_contacts', 'financial', 'health']);

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
): Promise<{ success: true; requestsCreated: number } | (OnboardingActionFailure & { blockIndex?: number })> {
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
  if (boundError) return accessFailure(boundError);

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
): Promise<{ success: true } | OnboardingActionFailure> {
  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id) {
    return { success: false, error: 'Your invite link has expired. Ask your manager for a new one.' };
  }
  if (validation.inviteType !== 'onboarding') {
    return { success: false, error: 'This link is for portal access only.' };
  }

  const boundError = await requireTokenBoundSession(validation.employee_id);
  if (boundError) return accessFailure(boundError);

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

  // The same session rule as every other onboarding action, so a forwarded link cannot be used
  // to ask who goes by which name. Saving will ask them to sign in.
  const boundError = await requireTokenBoundSession(validation.employee_id);
  if (boundError) return { available: true };

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
  { success: true; data: OnboardingSnapshot } | OnboardingActionFailure
> {
  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id) {
    return { success: false, error: validation.error || 'Invalid or expired invite link.' };
  }
  if (validation.inviteType !== 'onboarding') {
    return { success: false, error: 'This link is for portal access only.' };
  }

  // Saved details (NI, bank, health) are only replayed to a starter who is signed in as
  // themselves once they have an account. The page offers to sign in on `sign_in_required`.
  const boundError = await requireTokenBoundSession(validation.employee_id);
  if (boundError) return accessFailure(boundError);

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
  // These two were never checked, so a failed read came back as "no answer yet": the time off
  // step then showed empty and its next save reused a version the database had already seen.
  if (timeOffResult.error || timeOffBlocksResult.error) {
    return { success: false, error: 'Failed to load your time off answers.' };
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
        ni_number: maskTail(financial?.ni_number, NI_NUMBER_VISIBLE_TAIL),
        bank_name: financial?.bank_name ?? '',
        payee_name: financial?.payee_name ?? '',
        branch_address: financial?.branch_address ?? '',
        bank_sort_code: financial?.bank_sort_code ?? '',
        bank_account_number: maskTail(financial?.bank_account_number, ACCOUNT_NUMBER_VISIBLE_TAIL),
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
      // The same rules submitOnboardingProfile applies (onboarding-rules.ts). A financial row used
      // to count as done even with blank bank details, and a contact with no number as a contact.
      completedSections: {
        personal: isPersonalComplete(employee),
        emergency_contacts: isEmergencyContactsComplete(primaryContact),
        financial: isFinancialComplete(financial),
        health: Boolean(health),
        time_off: Boolean(timeOffResponse?.answer),
        right_to_work_notice: rtwNoticeResponse?.answer === 'acknowledged',
      },
    },
  };
}

/**
 * Checks the three sections whose rules are stricter than complete_employee_onboarding's (date of
 * birth, a number for the main emergency contact, a sort code and account number), so a profile
 * cannot go Active without them. The database function still checks every section that exists.
 */
async function findIncompleteOnboardingSection(
  adminClient: ReturnType<typeof createAdminClient>,
  employeeId: string,
): Promise<{ section: OnboardingSectionKey | null; error?: string }> {
  const [employeeResult, contactsResult, financialResult] = await Promise.all([
    adminClient
      .from('employees')
      .select('first_name, last_name, date_of_birth')
      .eq('employee_id', employeeId)
      .maybeSingle(),
    adminClient
      .from('employee_emergency_contacts')
      .select('name, phone_number, mobile_number, priority')
      .eq('employee_id', employeeId),
    adminClient
      .from('employee_financial_details')
      .select('bank_sort_code, bank_account_number')
      .eq('employee_id', employeeId)
      .maybeSingle(),
  ]);

  if (employeeResult.error || contactsResult.error || financialResult.error) {
    console.error('[submitOnboardingProfile] Could not read the profile to check it is complete:', {
      employee: employeeResult.error,
      contacts: contactsResult.error,
      financial: financialResult.error,
    });
    return { section: null, error: 'We could not check your details just now. Please try again in a moment.' };
  }

  const contacts = (contactsResult.data ?? []) as Array<{
    name: string | null; phone_number: string | null; mobile_number: string | null; priority: string | null;
  }>;
  const primaryContact = contacts.find((contact) => (contact.priority ?? 'Primary').toLowerCase() === 'primary') ?? null;

  if (!isPersonalComplete(employeeResult.data)) return { section: 'personal' };
  if (!isEmergencyContactsComplete(primaryContact)) return { section: 'emergency_contacts' };
  if (!isFinancialComplete(financialResult.data)) return { section: 'financial' };
  return { section: null };
}

/**
 * What the manager's completion email says beyond the name: booked time off, whether a right to
 * work check is on record, and an under-18 flag. A read that fails is reported as unknown in the
 * email rather than stopping it.
 */
async function loadCompletionEmailDetails(
  adminClient: ReturnType<typeof createAdminClient>,
  employeeId: string,
): Promise<Pick<OnboardingCompleteEmailInput, 'timeOffAnswer' | 'timeOffBlocks' | 'rightToWorkCheckedOn' | 'rightToWorkUnknown' | 'ageIfUnder18' | 'ageUnknown'>> {
  const [employeeResult, responseResult, blocksResult, rightToWorkResult] = await Promise.all([
    adminClient
      .from('employees')
      .select('date_of_birth')
      .eq('employee_id', employeeId)
      .maybeSingle(),
    adminClient
      .from('employee_onboarding_responses')
      .select('question, answer')
      .eq('employee_id', employeeId)
      .eq('question', 'booked_time_off')
      .maybeSingle(),
    adminClient
      .from('leave_requests')
      .select('start_date, end_date, leave_type, note')
      .eq('employee_id', employeeId)
      .eq('leave_origin', 'agreed_at_hire')
      .eq('request_channel', 'onboarding')
      .order('start_date', { ascending: true }),
    adminClient
      .from('employee_right_to_work')
      .select('verification_date')
      .eq('employee_id', employeeId)
      .order('verification_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // A failed read is logged and said to be unknown in the email, never reported as a fact: under 18
  // is a licensing and working-time flag, and "still to check" would hide a check already recorded.
  const failedReads = [
    ['date of birth', employeeResult.error],
    ['time off answer', responseResult.error],
    ['time off dates', blocksResult.error],
    ['right to work', rightToWorkResult.error],
  ] as const;
  for (const [what, error] of failedReads) {
    if (error) {
      console.error(`[onboarding] Failed to read the ${what} for the completion email:`, {
        code: error.code,
        message: error.message,
      });
    }
  }
  const dateOfBirth = (employeeResult.data as { date_of_birth: string | null } | null)?.date_of_birth ?? null;
  const todayIso = getTodayIsoDate();
  const answer = responseResult.error
    ? null
    : ((responseResult.data as { answer: string | null } | null)?.answer ?? null);
  const blocks = blocksResult.error
    ? []
    : ((blocksResult.data ?? []) as Array<{ start_date: string; end_date: string; leave_type: string | null; note: string | null }>);

  return {
    timeOffAnswer: answer === 'none' || answer === 'has_dates' ? answer : null,
    timeOffBlocks: blocks.map((block) => ({
      startDate: block.start_date,
      endDate: block.end_date,
      leaveType: block.leave_type,
      note: block.note,
    })),
    rightToWorkCheckedOn: rightToWorkResult.error
      ? null
      : ((rightToWorkResult.data as { verification_date: string | null } | null)?.verification_date ?? null),
    rightToWorkUnknown: Boolean(rightToWorkResult.error),
    ageIfUnder18: dateOfBirth && isUnder18(dateOfBirth, todayIso) ? ageOnDate(dateOfBirth, todayIso) : null,
    ageUnknown: Boolean(employeeResult.error) || !dateOfBirth,
  };
}

export async function submitOnboardingProfile(
  token: string,
): Promise<{ success: true } | (OnboardingActionFailure & { section?: OnboardingSectionKey })> {
  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.employee_id || !validation.email) {
    return { success: false, error: 'Invalid or expired invite link.' };
  }
  if (validation.inviteType !== 'onboarding') {
    return { success: false, error: 'This link is for portal access only.' };
  }

  const boundError = await requireTokenBoundSession(validation.employee_id);
  if (boundError) return accessFailure(boundError);

  const adminClient = createAdminClient();

  const readiness = await findIncompleteOnboardingSection(adminClient, validation.employee_id);
  if (readiness.error) {
    return { success: false, error: readiness.error };
  }
  if (readiness.section) {
    return { success: false, error: ONBOARDING_INCOMPLETE_MESSAGES[readiness.section], section: readiness.section };
  }

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

    // Our function's own messages are written for the starter; anything else is database text.
    return {
      success: false,
      error: plainRpcMessage(message, 'We could not complete your profile just now. Please try again in a moment.'),
    };
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

  // Tell the manager. The starter's completion stands whatever happens here, but a failed email
  // used to reach only the server log, so nobody knew a new starter was waiting. A failure now
  // leaves a note on the employee's record and a failed audit row.
  try {
    const details = await loadCompletionEmailDetails(adminClient, completion.employee_id);
    await sendOnboardingCompleteEmail({
      employeeName: fullName || validation.email,
      employeeEmail: validation.email,
      profileUrl: `${getAppUrl()}/employees/${completion.employee_id}`,
      ...details,
    });
  } catch (emailError) {
    console.error('[submitOnboardingProfile] Failed to send completion email:', emailError);
    await recordCompletionEmailFailure(adminClient, completion.employee_id, validation.email, getErrorMessage(emailError));
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

async function recordCompletionEmailFailure(
  adminClient: ReturnType<typeof createAdminClient>,
  employeeId: string,
  employeeEmail: string,
  reason: string,
): Promise<void> {
  const { error: noteError } = await adminClient.from('employee_notes').insert({
    employee_id: employeeId,
    note_text:
      `Onboarding completed, but the email telling the manager did not send (${reason}). ` +
      'Check their booked time off and arrange their right to work check before their first shift.',
    created_by_user_id: null,
  });
  if (noteError) {
    console.error('[submitOnboardingProfile] Failed to add the completion email failure note:', {
      code: noteError.code,
      message: noteError.message,
      details: noteError.details,
      hint: noteError.hint,
    });
  }

  try {
    await logAuditEvent({
      user_email: employeeEmail,
      operation_type: 'onboarding_complete_email',
      resource_type: 'employee',
      resource_id: employeeId,
      operation_status: 'failure',
      error_message: reason,
      additional_info: { note_added: !noteError },
    });
  } catch (auditError) {
    console.error('[submitOnboardingProfile] Audit log failed:', auditError);
  }
}

export async function revokeEmployeeAccess(employeeId: string): Promise<{ success: boolean; error?: string; warning?: string }> {
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

  // They are Former either way; a login that could not be deleted is said, not hidden (FF-47).
  return { success: true, ...(result.warning ? { warning: result.warning } : {}) };
}
