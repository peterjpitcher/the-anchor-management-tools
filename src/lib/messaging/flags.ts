import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

/**
 * Runtime switches for the email-first messaging work (owner decision, 11 September 2026).
 *
 * One flag per sending path, every one OFF by default, which is today's behaviour. They live in
 * a single system_settings row, following the website UI flags in
 * src/app/api/website/ui-flags/route.ts:
 *
 *   key   'messaging_flags'
 *   value a JSON object of booleans, e.g. {"table_cancelled_email_first": true}
 *
 * The row does not exist until the owner switches a path on (no migration, no seed), and
 * switching one off again is a rollback that needs no deploy. A flag is on only when its stored
 * value is the boolean true. A missing row, a value that is not a plain object, a non-boolean
 * entry and any error reading the row all mean off.
 */
export const MESSAGING_FLAG_KEYS = [
  'event_promo_last_push',
  // Only read while event_promo_last_push is on: guests with no usable email address keep
  // the 7-day intro text, inside the same two-a-month cap.
  'event_promo_intro_sms_no_email',
  'table_cancelled_email_first',
  'table_deposit_confirmed_email_first',
  'table_party_size_deposit_email_first',
  'table_preorder_email_first',
  'table_confirm_reminder_email_first',
  'private_booking_email_first',
  'bounce_sms_fallback',
  'staff_message_email_option',
] as const

export type MessagingFlagKey = (typeof MESSAGING_FLAG_KEYS)[number]

const MESSAGING_FLAGS_SETTING_KEY = 'messaging_flags'

/** How long one read of the row is trusted, so a change takes effect within a minute. */
const MESSAGING_FLAGS_CACHE_TTL_MS = 60_000

type StoredFlags = Record<string, unknown>

let cache: { flags: StoredFlags; readAt: number } | null = null

/** For tests, and for anything that has just written the row and must see it at once. */
export function clearMessagingFlagCache(): void {
  cache = null
}

function normaliseFlags(value: unknown): StoredFlags {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as StoredFlags
}

/**
 * Only a successful read is cached. A failed read answers off for that call and the next call
 * tries again, so a brief database fault cannot pin every flag off for a minute.
 */
async function readFlags(): Promise<StoredFlags | null> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', MESSAGING_FLAGS_SETTING_KEY)
      .maybeSingle()

    if (error) {
      logger.error('Failed to read messaging flags; treating every flag as off', {
        metadata: {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        },
      })
      return null
    }

    return normaliseFlags(data?.value)
  } catch (error) {
    logger.error('Failed to read messaging flags; treating every flag as off', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return null
  }
}

export async function isMessagingFlagOn(key: MessagingFlagKey): Promise<boolean> {
  if (cache && Date.now() - cache.readAt < MESSAGING_FLAGS_CACHE_TTL_MS) {
    return cache.flags[key] === true
  }

  const flags = await readFlags()
  if (!flags) {
    return false
  }

  cache = { flags, readAt: Date.now() }
  return flags[key] === true
}
