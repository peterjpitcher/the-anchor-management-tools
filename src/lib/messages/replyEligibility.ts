/**
 * Whether the inbox composer may send, and if not, exactly why.
 *
 * The inbox shows SMS, WhatsApp, email and feedback in one timeline, but the
 * only reply transport it has is SMS (`MessageService.sendReply`). Three things
 * used to go wrong because that was never stated:
 *
 *  - staff replied from an email or WhatsApp thread believing they had answered
 *    on that channel, when an SMS went out instead;
 *  - `sms_opt_in` is nullable and the UI treated every value except `false` as
 *    consent, while the server fails closed on null. The composer therefore
 *    accepted a message the server would always reject;
 *  - a customer with no mobile number got a working-looking composer.
 *
 * Everything here is pure so the composer and its tests share one rule.
 */

export type ReplyCustomer = {
  mobile_number: string | null
  sms_opt_in: boolean | null
}

export type ReplyBlockReason =
  | 'no_permission'
  | 'opted_out'
  | 'consent_unknown'
  | 'no_mobile_number'

export type ReplyEligibility =
  | { canReply: true; destination: string }
  | { canReply: false; reason: ReplyBlockReason; title: string; detail: string }

const BLOCK_COPY: Record<ReplyBlockReason, { title: string; detail: string }> = {
  no_permission: {
    title: 'You cannot send messages',
    detail: 'Your role can read this inbox but not reply. Ask a manager to send on your behalf.',
  },
  opted_out: {
    title: 'This customer has opted out of SMS',
    detail:
      'Replies cannot be sent from here. Change their preference on their profile if they have asked to be contacted again.',
  },
  consent_unknown: {
    title: 'SMS consent is not recorded',
    detail:
      'We have no opt-in on file for this customer, so a reply would be rejected. Record their preference on their profile first.',
  },
  no_mobile_number: {
    title: 'No mobile number on file',
    detail: 'Add a mobile number to this customer profile before replying by SMS.',
  },
}

export function getReplyEligibility(
  customer: ReplyCustomer | null,
  options: { canSend: boolean },
): ReplyEligibility {
  if (!options.canSend) return { canReply: false, reason: 'no_permission', ...BLOCK_COPY.no_permission }
  if (!customer) return { canReply: false, reason: 'no_mobile_number', ...BLOCK_COPY.no_mobile_number }

  if (customer.sms_opt_in === false) {
    return { canReply: false, reason: 'opted_out', ...BLOCK_COPY.opted_out }
  }

  // Null is "never asked", not "yes". MessageService.sendReply rejects it, so
  // the composer must too rather than inviting a message that cannot go.
  if (customer.sms_opt_in !== true) {
    return { canReply: false, reason: 'consent_unknown', ...BLOCK_COPY.consent_unknown }
  }

  const destination = customer.mobile_number?.trim()
  if (!destination) {
    return { canReply: false, reason: 'no_mobile_number', ...BLOCK_COPY.no_mobile_number }
  }

  return { canReply: true, destination }
}

export type SmsConsentState = 'opted_in' | 'opted_out' | 'not_recorded'

/** Three states, because "not recorded" is not the same as "opted in". */
export function getSmsConsentState(optIn: boolean | null | undefined): SmsConsentState {
  if (optIn === true) return 'opted_in'
  if (optIn === false) return 'opted_out'
  return 'not_recorded'
}

export const SMS_CONSENT_LABEL: Record<SmsConsentState, string> = {
  opted_in: 'Opted in',
  opted_out: 'Opted out',
  not_recorded: 'Not recorded',
}
