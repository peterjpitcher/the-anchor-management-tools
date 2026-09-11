import { isTruthyFlag } from '@/lib/sms/suspension'

/**
 * Emergency email kill switches, the email counterpart of src/lib/sms/suspension.ts.
 *
 * SUSPEND_ALL_EMAIL stops email only. SUSPEND_ALL_COMMS stops every channel, so it is checked
 * here as well as in sendSMS and sendWhatsApp. Both are read at call time, so a queued or
 * deferred send is covered too, and both are off unless set to a truthy value.
 */
export type EmailSuspensionReason = 'all_comms' | 'all_email' | null

/** The environment variable behind each reason, for log lines and cron responses. */
export const EMAIL_SUSPENSION_SWITCHES: Record<Exclude<EmailSuspensionReason, null>, string> = {
  all_comms: 'SUSPEND_ALL_COMMS',
  all_email: 'SUSPEND_ALL_EMAIL',
}

export function resolveEmailSuspensionReason(params: {
  suspendAllComms?: string | null
  suspendAllEmail?: string | null
}): EmailSuspensionReason {
  if (isTruthyFlag(params.suspendAllComms)) {
    return 'all_comms'
  }

  return isTruthyFlag(params.suspendAllEmail) ? 'all_email' : null
}

/** The live switch state, read from the environment at the moment of the call. */
export function currentEmailSuspensionReason(): EmailSuspensionReason {
  return resolveEmailSuspensionReason({
    suspendAllComms: process.env.SUSPEND_ALL_COMMS,
    suspendAllEmail: process.env.SUSPEND_ALL_EMAIL,
  })
}
