/**
 * What happened when we tried to tell a table booking guest something, in a shape that is safe
 * to send to the browser. No server imports: the staff screens read it from route responses.
 *
 * Only the email-first paths (the messaging flags of 11 September 2026) produce one. A route
 * whose path is still text-only returns none, and the screens then behave exactly as before.
 */

export type GuestNotificationStatus =
  /** The guest was reached, by email or by text. */
  | 'sent'
  /** Something was tried and nothing got through. */
  | 'failed'
  /** The guest has no email address or mobile number we are allowed to use. */
  | 'no_channel'
  /** An earlier attempt already delivered this message, so nothing was sent again. */
  | 'already_sent'

export type GuestNotificationChannel = 'email' | 'sms' | 'whatsapp'

export type GuestNotificationOutcome = {
  status: GuestNotificationStatus
  /** The channel that reached the guest, when one did. */
  channel: GuestNotificationChannel | null
  /** True when the email failed and a text went instead. */
  fallbackUsed: boolean
  /** A short reason when nothing got through. Never shown to guests. */
  error: string | null
}

const STATUSES: ReadonlySet<string> = new Set(['sent', 'failed', 'no_channel', 'already_sent'])

/** Reads an outcome out of an untyped route payload, or null when there is none. */
export function readGuestNotificationOutcome(value: unknown): GuestNotificationOutcome | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.status !== 'string' || !STATUSES.has(record.status)) return null

  const channel = record.channel === 'email' || record.channel === 'sms' || record.channel === 'whatsapp'
    ? record.channel
    : null

  return {
    status: record.status as GuestNotificationStatus,
    channel,
    fallbackUsed: record.fallbackUsed === true,
    error: typeof record.error === 'string' ? record.error : null,
  }
}

/** "by email" or "by text", for a message that reached the guest. */
export function describeGuestNotificationChannel(outcome: GuestNotificationOutcome | null): string | null {
  if (!outcome || outcome.status !== 'sent') return null
  if (outcome.channel === 'email') return 'by email'
  if (outcome.channel === 'sms') return 'by text'
  if (outcome.channel === 'whatsapp') return 'by WhatsApp'
  return null
}

/**
 * The sentence staff need when the guest was NOT told, or null when there is nothing to act on.
 * `subject` names the message, e.g. "about the cancellation".
 */
export function describeGuestNotificationProblem(
  outcome: GuestNotificationOutcome | null,
  subject: string
): string | null {
  if (!outcome) return null
  if (outcome.status === 'failed') {
    return `We could not reach the guest ${subject} by email or text. Please contact them.`
  }
  if (outcome.status === 'no_channel') {
    return `The guest has no email address or mobile number we can use, so they have not been told ${subject}. Please contact them.`
  }
  return null
}
