import type { ReplyBlockReason, SmsConsentState } from '@/lib/messages/replyEligibility'

/**
 * The Messages status maps. Pure module, safe to import from server and client components.
 * Message delivery status (sent, delivered, failed) is not here: it is shared with events,
 * private bookings and marketing and gets one cross-section map of its own.
 */

/**
 * Why the inbox composer cannot reply. An opt-out is a hard stop the customer asked for, so it
 * reads as danger; the rest (no permission, no number, consent unknown) are warnings.
 */
export const REPLY_BLOCK_TONE: Record<ReplyBlockReason, 'danger' | 'warning'> = {
  opted_out: 'danger',
  no_permission: 'warning',
  consent_unknown: 'warning',
  no_mobile_number: 'warning',
}

/**
 * A customer's SMS consent in the contact panel. Amber, not green, for "not recorded": we never
 * asked is not consent, and the server rejects a send in this state, so the panel must not imply
 * the customer is contactable.
 */
export const SMS_CONSENT_TONE: Record<SmsConsentState, 'success' | 'danger' | 'warning'> = {
  opted_in: 'success',
  opted_out: 'danger',
  not_recorded: 'warning',
}

/** WhatsApp in the contact panel: opted in, or not (the default for most customers). */
export const WHATSAPP_OPT_IN_TONE: Record<'opted_in' | 'not_opted_in', 'success' | 'neutral'> = {
  opted_in: 'success',
  not_opted_in: 'neutral',
}

/**
 * A message's channel (SMS, WhatsApp, email) and its attachment flag, shown as badges beside the
 * message. Neither is a state to judge, so the channel is neutral and an attachment is info, the
 * same in the inbox thread, on the customer's page and in the holding queue.
 */
export const MESSAGE_CHANNEL_BADGE_TONE = 'neutral' as const
export const MESSAGE_ATTACHMENT_BADGE_TONE = 'info' as const
