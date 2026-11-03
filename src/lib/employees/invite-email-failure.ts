import type { EmailSendCode } from '@/lib/email/emailService';

/**
 * Why an employee invite, reminder or completion email did not go, in words people can read.
 *
 * sendEmail hands back the provider's own text (Resend or Graph) when a send fails. That text
 * belongs in the log and the audit row only, never in a toast, an alert or a note on a record. It
 * also says when the provider took the request and then gave no answer (`uncertain`): the email
 * may have arrived, so nothing a delivered email points at (the employee record, the link) may be
 * deleted, nobody may be told "nothing reached them", and nothing may send it again on its own.
 *
 * Kept apart from employee-invite-emails.ts so the actions and the chase cron read the outcome
 * the same way, and so a test that fakes the email helpers still gets the real rule.
 */
export class InviteEmailSendError extends Error {
  readonly code?: EmailSendCode;
  readonly uncertain: boolean;

  constructor(message: string, options: { code?: EmailSendCode; uncertain?: boolean } = {}) {
    super(message);
    this.name = 'InviteEmailSendError';
    this.code = options.code;
    this.uncertain = options.uncertain === true;
  }
}

export type InviteEmailFailure = {
  /** The provider took the request and we did not hear back, so the email may have gone. */
  uncertain: boolean;
  /** Email sending is switched off (SUSPEND_ALL_EMAIL), so the address is not the problem. */
  suspended: boolean;
  /** A plain reason for people, never the provider's own text. Lower case, to follow "because". */
  reason: string;
  /** What staff should do next, as a sentence. */
  advice: string;
  /** sendEmail's code, for the log. */
  code: EmailSendCode | null;
  /** The provider's own text, for the log and the audit row only. */
  detail: string;
};

const UNCERTAIN_SEND_REASON = 'we did not hear back from the email service, so it may have gone';

export function describeInviteEmailFailure(error: unknown): InviteEmailFailure {
  const detail = error instanceof Error ? error.message : String(error);

  if (error instanceof InviteEmailSendError) {
    const code = error.code ?? null;
    // Compared as text so this reads any code sendEmail adds without a change here.
    const codeText: string | null = code;
    if (error.uncertain) {
      return {
        uncertain: true,
        suspended: false,
        reason: UNCERTAIN_SEND_REASON,
        advice: 'Check with them before sending it again.',
        code,
        detail,
      };
    }
    if (codeText === 'email_suspended') {
      return {
        uncertain: false,
        suspended: true,
        reason: 'email sending is switched off at the moment',
        advice: 'Try again once email sending is back on.',
        code,
        detail,
      };
    }
    if (codeText === 'recipient_suppressed') {
      return {
        uncertain: false,
        suspended: false,
        reason: 'emails to that address have bounced or been marked as spam before, so we no longer send to it',
        advice: 'Check the email address with them, and use a different one if it is wrong.',
        code,
        detail,
      };
    }
    // Every refusal on record (180 days to November 2026) was the provider's quota or rate
    // limit, not the address, so the advice does not blame the address first.
    return {
      uncertain: false,
      suspended: false,
      reason: 'the email service did not accept it',
      advice: 'Please try again later. If it keeps failing, check the email address.',
      code,
      detail,
    };
  }

  // Anything else failed before the email was handed to sendEmail (building the link or the
  // details), so it definitely did not go.
  return {
    uncertain: false,
    suspended: false,
    reason: 'something went wrong before it could be sent',
    advice: 'Please try again in a moment.',
    code: null,
    detail,
  };
}

/** The log line for a failed send: the outcome and the provider's text, field by field. */
export function inviteEmailFailureLog(failure: InviteEmailFailure): Record<string, unknown> {
  return { uncertain: failure.uncertain, code: failure.code, message: failure.detail };
}
