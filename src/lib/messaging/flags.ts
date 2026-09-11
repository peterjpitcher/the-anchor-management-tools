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
 * value is the boolean true. A missing row, a value that is not a plain object and a non-boolean
 * entry all mean off.
 *
 * The two readers differ only when the row cannot be read:
 *
 *  - `isMessagingFlagOn` answers off. That is safe for every path whose off state is today's
 *    behaviour and sends no more than its on state.
 *  - `readMessagingFlagState` answers unknown. Event promotion needs it: there, off runs the
 *    7-day intro and the 24-hour follow-up, the noisier texts the owner switched away from, so a
 *    flag that has been on for weeks must not fall back to them because one read timed out.
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

/** Why the row could not be read, field by field rather than as the raw error object. */
export type MessagingFlagsReadFailure = {
  code: string | null
  message: string
  details: string | null
  hint: string | null
}

type FlagsRead = { ok: true; flags: StoredFlags } | { ok: false; failure: MessagingFlagsReadFailure }

/**
 * The stored flags, from the cache while it is fresh. Only a successful read is cached. A failed
 * read goes back to the caller and the next call tries again, so a brief database fault cannot
 * pin every flag for a minute.
 */
async function readFlags(): Promise<FlagsRead> {
  if (cache && Date.now() - cache.readAt < MESSAGING_FLAGS_CACHE_TTL_MS) {
    return { ok: true, flags: cache.flags }
  }

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', MESSAGING_FLAGS_SETTING_KEY)
      .maybeSingle()

    if (error) {
      return {
        ok: false,
        failure: {
          code: error.code ?? null,
          message: error.message,
          details: error.details ?? null,
          hint: error.hint ?? null,
        },
      }
    }

    const flags = normaliseFlags(data?.value)
    cache = { flags, readAt: Date.now() }
    return { ok: true, flags }
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: null,
        message: error instanceof Error ? error.message : String(error),
        details: null,
        hint: null,
      },
    }
  }
}

export async function isMessagingFlagOn(key: MessagingFlagKey): Promise<boolean> {
  const read = await readFlags()
  if (!read.ok) {
    logger.error('Failed to read messaging flags; treating every flag as off', { metadata: read.failure })
    return false
  }

  return read.flags[key] === true
}

export type MessagingFlagState =
  | { state: 'on' }
  | { state: 'off' }
  | { state: 'unknown'; failure: MessagingFlagsReadFailure }

/**
 * One flag as on, off or unknown.
 *
 * On and off are exactly what isMessagingFlagOn answers (a missing row, false and a malformed
 * value are all off) and come from the same 60-second cache. Unknown means the row could not be
 * read; it is never cached, so the next call reads the row again. Logs nothing: what unknown
 * means is the caller's decision, and the caller says so once.
 */
export async function readMessagingFlagState(key: MessagingFlagKey): Promise<MessagingFlagState> {
  const read = await readFlags()
  if (!read.ok) {
    return { state: 'unknown', failure: read.failure }
  }

  return read.flags[key] === true ? { state: 'on' } : { state: 'off' }
}
