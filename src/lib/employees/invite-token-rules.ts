/**
 * Whether an unexpired, unused invite link still belongs to the person it was sent to.
 *
 * validateInviteToken (src/app/actions/employeeInvite.ts) refuses a link on these rules, and the
 * chase cron (src/app/api/cron/employee-invite-chase) uses the same rules before it emails a
 * reminder. The cron used to chase every open link, so a starter a manager had made Active by hand,
 * or whose email had been corrected, still got reminders to a link that would refuse them.
 *
 * Pure, so both callers apply exactly the same rule.
 */
export type InviteKind = 'onboarding' | 'portal_access';

export type InviteTokenProblem =
  /** The employee's email address has changed since the link was sent. */
  | 'email_changed'
  /** An onboarding link for someone who is no longer Onboarding (activated, or left). */
  | 'onboarding_finished'
  /** A portal link for someone who is not a current employee. */
  | 'not_active'
  /** A portal link for someone who already has a login. */
  | 'has_login';

function normaliseInviteEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

export function inviteTokenProblem(input: {
  inviteType: InviteKind;
  tokenEmail: string | null | undefined;
  employee: {
    email_address: string | null | undefined;
    status: string | null | undefined;
    auth_user_id: string | null | undefined;
  };
}): InviteTokenProblem | null {
  const { inviteType, tokenEmail, employee } = input;

  if (normaliseInviteEmail(employee.email_address) !== normaliseInviteEmail(tokenEmail)) {
    return 'email_changed';
  }

  if (inviteType === 'onboarding' && employee.status !== 'Onboarding') {
    return 'onboarding_finished';
  }

  if (inviteType === 'portal_access') {
    if (!['Active', 'Started Separation'].includes(employee.status ?? '')) return 'not_active';
    if (employee.auth_user_id) return 'has_login';
  }

  return null;
}
