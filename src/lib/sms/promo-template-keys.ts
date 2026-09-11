/**
 * Template keys of the event promotion engine, in one dependency-free module.
 *
 * Load-bearing: the cron's hourly promo guard, the two-a-month text cap, the SUSPEND_EVENT_SMS
 * prefix, the routing matrix, the deferred-send promo context backfill and the event marketing
 * report all read them. Change them together. Both last-push keys keep the `event_` prefix so
 * SUSPEND_EVENT_SMS still stops them.
 */

export const EVENT_LAST_PUSH_TEMPLATE_KEY = 'event_last_push'
export const EVENT_LAST_PUSH_PAID_TEMPLATE_KEY = 'event_last_push_paid'

/** Every key the promotion engine sends or has sent, legacy stages included. */
export const EVENT_PROMO_TEMPLATE_KEYS = [
  'event_cross_promo_7d',
  'event_cross_promo_7d_paid',
  'event_general_promo_7d',
  'event_general_promo_7d_paid',
  'event_cross_promo_14d',
  'event_cross_promo_14d_paid',
  'event_general_promo_14d',
  'event_general_promo_14d_paid',
  'event_reminder_promo_24h',
  'event_reminder_promo_24h_paid',
  'event_reminder_promo_3d',
  'event_reminder_promo_3d_paid',
  EVENT_LAST_PUSH_TEMPLATE_KEY,
  EVENT_LAST_PUSH_PAID_TEMPLATE_KEY,
] as const

/**
 * Promotional texts that are not event promotions. Staff bulk texts and the win-back campaign
 * both send through `sendBulkSms` under this key. The email-capture ask and review requests are
 * not promotions (owner decision, 11 September 2026) and are deliberately absent.
 */
const OTHER_PROMOTIONAL_SMS_TEMPLATE_KEYS = ['bulk_sms_campaign'] as const

/** The keys that count towards a guest's two promotional texts a month. */
export const PROMOTIONAL_SMS_TEMPLATE_KEYS = [
  ...EVENT_PROMO_TEMPLATE_KEYS,
  ...OTHER_PROMOTIONAL_SMS_TEMPLATE_KEYS,
] as const

const EVENT_PROMO_TEMPLATE_KEY_SET: ReadonlySet<string> = new Set(EVENT_PROMO_TEMPLATE_KEYS)

/** True for any event promotion key: the legacy stages (by prefix) and the last push. */
export function isEventPromoTemplateKey(templateKey: string | null | undefined): boolean {
  if (!templateKey) return false
  return (
    EVENT_PROMO_TEMPLATE_KEY_SET.has(templateKey) ||
    templateKey.startsWith('event_cross_promo_') ||
    templateKey.startsWith('event_general_promo_') ||
    templateKey.startsWith('event_reminder_promo_')
  )
}
