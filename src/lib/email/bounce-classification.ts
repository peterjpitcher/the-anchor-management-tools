/**
 * Permanent bounce or temporary one.
 *
 * WHY THIS EXISTS. The Resend webhook used to treat every `email.bounced` event the same:
 * suppress the address for ever, mark the customer `bounced`, stamp `email_deactivated_at`,
 * and nothing anywhere cleared it again. Of the 18 bounces in the 120 days to 12 September
 * 2026, 10 were temporary: 3 said the recipient's inbox was full and 7 were a general bounce
 * whose own message says you might be able to send to the same recipient again. Those ten
 * addresses were probably fine, and all ten were blocked permanently.
 *
 * A full mailbox is a Tuesday problem, not a dead address. Only a permanent bounce means the
 * address does not exist, so only a permanent bounce earns a suppression.
 *
 * THE PROVIDER ALREADY TELLS US. `data.bounce.type` carries the SES-style classification,
 * 'Permanent' / 'Transient' / 'Undetermined', and `subType` refines it ('General',
 * 'MailboxFull', 'NoEmail', 'Suppressed'). The webhook read neither. Undetermined is treated
 * as temporary on purpose: refusing to guess in favour of the guest is the safe direction,
 * because a repeat bounce raises the failure count and a genuinely dead address will send a
 * permanent one soon enough.
 *
 * The message fallback exists because the type field is the provider's to change, and a
 * bounce with no type at all must not silently become a permanent block.
 */

export type BounceSeverity = 'permanent' | 'transient'

type BounceLike = {
  type?: string
  subType?: string
  message?: string
} | null | undefined

/**
 * Sub-types that name a dead address on their own.
 *
 * 'general' is deliberately absent. It appears under both top-level types, and the measured
 * set is exactly why: 7 of the 10 temporary bounces were `Transient/General`. Reading
 * 'general' as permanent is the mistake this module exists to stop.
 */
const PERMANENT_SUB_TYPES = new Set(['noemail', 'suppressed', 'onaccountsuppressionlist'])

/** Sub-types that are temporary whatever the top-level type says. */
const TRANSIENT_SUB_TYPES = new Set([
  'mailboxfull',
  'messagetoolarge',
  'contentrejected',
  'attachmentrejected',
])

/** Phrases in a bounce message that mean "try again later". Lower-cased before matching. */
const TRANSIENT_MESSAGE_PHRASES = [
  'inbox was full',
  'mailbox is full',
  'mailbox full',
  'over quota',
  'quota exceeded',
  // Resend's own wording on a general transient bounce, which is the biggest group in the
  // measured set: "a general bounce ... you might be able to send a message to the same
  // recipient".
  'you might be able to send',
  'try again later',
  'temporarily',
  'temporary failure',
  'greylist',
  'too many messages',
  'rate limited',
]

/** Phrases that mean the address is gone for good. */
const PERMANENT_MESSAGE_PHRASES = [
  'does not exist',
  'no longer exists',
  'unknown user',
  'user unknown',
  'no such user',
  'invalid recipient',
  'recipient address rejected',
  'account has been disabled',
  'mailbox unavailable',
]

function normalise(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/**
 * How hard this bounce blocks the address.
 *
 * Defaults to 'transient' when nothing identifies the bounce, because a permanent block is
 * the irreversible answer and an unclassified bounce has not earned it. The delivery-failure
 * counter still rises either way, so a repeatedly failing address is still visible to staff.
 */
export function classifyBounceSeverity(bounce: BounceLike): BounceSeverity {
  const subType = normalise(bounce?.subType)
  if (TRANSIENT_SUB_TYPES.has(subType)) return 'transient'

  if (PERMANENT_SUB_TYPES.has(subType)) return 'permanent'

  const type = normalise(bounce?.type)
  if (type === 'permanent') return 'permanent'
  if (type === 'transient' || type === 'undetermined') return 'transient'

  // No usable type. Fall back to the wording, which is what a human reads in the dashboard.
  const message = normalise(bounce?.message)
  if (!message) return 'transient'
  if (TRANSIENT_MESSAGE_PHRASES.some((phrase) => message.includes(phrase))) return 'transient'
  if (PERMANENT_MESSAGE_PHRASES.some((phrase) => message.includes(phrase))) return 'permanent'
  return 'transient'
}

/** True when this bounce should put the address on the suppression list. */
export function bounceShouldSuppress(bounce: BounceLike): boolean {
  return classifyBounceSeverity(bounce) === 'permanent'
}
