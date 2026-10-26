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
 *   value a JSON object of booleans, e.g. {"table_preorder_email_first": true}
 *
 * The row does not exist until the owner switches a path on (no migration, no seed), and
 * switching one off again is a rollback that needs no deploy. A flag is on only when its stored
 * value is the boolean true. To isMessagingFlagOn, a missing row, a value that is not a plain
 * object and a non-boolean entry all mean off.
 *
 * The two readers differ only when the row cannot be read or is malformed:
 *
 *  - `isMessagingFlagOn` answers with the last value it read successfully. Before any read has
 *    succeeded it answers on for the flags in ON_WHEN_UNREADABLE and off for the rest (BK-129,
 *    customer bookings review of 24 October 2026). It used to answer off for every flag, so one
 *    timed-out read sent private booking messages back down paths the owner retired on
 *    15 September (a texted-only booker, a queue nobody approves).
 *  - `readMessagingFlagState` answers unknown. Event promotion needs it: there, off runs the
 *    7-day intro and the 24-hour follow-up, the noisier texts the owner switched away from, so a
 *    flag that has been on for weeks must not fall back to them because one read timed out, or
 *    because someone saved the text "true" instead of the boolean.
 *
 * Four table booking flags (table_cancelled_email_first, table_deposit_confirmed_email_first,
 * table_party_size_deposit_email_first, table_confirm_reminder_email_first) were on from
 * 15 September and are gone: those messages always go email first now (BK-129), so a lost read
 * can no longer text a guest who is not a regular.
 */
export const MESSAGING_FLAG_KEYS = [
  // Regulars week-ahead invites (owner, 15 September 2026). While on, the only event promotion
  // text is one invite a week ahead to guests who have been to that kind of night before, with at
  // most one promotional text per guest in any two days. It replaces the 7-day intro, the 24-hour
  // follow-up and the last push, whatever event_promo_last_push says.
  'event_promo_regulars_week_ahead',
  'event_promo_last_push',
  // Only read while event_promo_last_push or event_promo_regulars_week_ahead is on: guests with no
  // usable email address are the only ones texted, because the guest campaigns reach the rest.
  'event_promo_intro_sms_no_email',
  'table_preorder_email_first',
  // The booker's copy of their food choices, emailed once when the pre-order closes (BK-149, 26
  // October 2026). New guest wording, so it stays off until the owner has read it and switches it on.
  'table_preorder_choices_copy',
  // The one reminder before an unpaid table deposit hold runs out (BK-088, owner decision D16, 26
  // October 2026). New guest wording, so it stays off until the owner has read it and switches it on.
  'table_deposit_hold_reminder',
  // The amended-booking notice when staff change a table booking's party size (BK-091, 26 October
  // 2026). New guest wording for this trigger, so it stays off until the owner has read it.
  'table_party_size_change_notice',
  'private_booking_email_first',
  'bounce_sms_fallback',
  'staff_message_email_option',
  // Private booking deposits (owner, 11 September 2026): creating a booking sends no deposit
  // message; staff confirm the amount and one deposit request goes. Until then the booking gets
  // no deposit reminders, no automatic hold expiry and no hold-lapsed message. Needs migration
  // 20260911200000 applied before it is switched on.
  'private_booking_deposit_confirmation',
  // Balance reminders go by email straight away, listing the payments made, when the booking has
  // a usable address; the text still waits for approval when it has none. Reminders queued before
  // the switch are never sent.
  'private_booking_balance_email_auto',
] as const

export type MessagingFlagKey = (typeof MESSAGING_FLAG_KEYS)[number]

/**
 * What isMessagingFlagOn answers for a flag when the row cannot be read and no read has succeeded
 * since this server started: on for a table booking flag production has run ON since
 * 15 September 2026 whose off state is a text the owner retired, off for everything else (a
 * runtime switch such as bounce_sms_fallback, or a new message still waiting for the owner to read
 * its wording), which sends less.
 *
 * The private booking flags are left to the last-value rule only: their off paths are still
 * exercised by the private hire code and its tests, which other release work owns. Deleting those
 * off branches, as BK-129 did for the table ones, is the lasting fix.
 */
const ON_WHEN_UNREADABLE: ReadonlySet<MessagingFlagKey> = new Set<MessagingFlagKey>([
  'table_preorder_email_first',
])

const MESSAGING_FLAGS_SETTING_KEY = 'messaging_flags'

/** How long one read of the row is trusted, so a change takes effect within a minute. */
const MESSAGING_FLAGS_CACHE_TTL_MS = 60_000

type StoredFlags = Record<string, unknown>

let cache: { flags: StoredFlags; malformed: boolean; readAt: number } | null = null

/** For tests, and for anything that has just written the row and must see it at once. */
export function clearMessagingFlagCache(): void {
  cache = null
}

/** A row that exists but does not hold a plain object is malformed; a missing row is not. */
function normaliseFlags(value: unknown): { flags: StoredFlags; malformed: boolean } {
  if (value === null || value === undefined) {
    return { flags: {}, malformed: false }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { flags: {}, malformed: true }
  }
  return { flags: value as StoredFlags, malformed: false }
}

/** Why the row could not be read, field by field rather than as the raw error object. */
export type MessagingFlagsReadFailure = {
  code: string | null
  message: string
  details: string | null
  hint: string | null
}

type FlagsRead =
  | { ok: true; flags: StoredFlags; malformed: boolean }
  | { ok: false; failure: MessagingFlagsReadFailure }

/**
 * The stored flags, from the cache while it is fresh. Only a successful read is cached. A failed
 * read goes back to the caller and the next call tries again, so a brief database fault cannot
 * pin every flag for a minute.
 */
async function readFlags(): Promise<FlagsRead> {
  if (cache && Date.now() - cache.readAt < MESSAGING_FLAGS_CACHE_TTL_MS) {
    return { ok: true, flags: cache.flags, malformed: cache.malformed }
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

    const { flags, malformed } = normaliseFlags(data?.value)
    cache = { flags, malformed, readAt: Date.now() }
    return { ok: true, flags, malformed }
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
    // The cache entry outlives its minute for exactly this: the last value read successfully.
    if (cache) {
      logger.error('Failed to read messaging flags; using the last value read', {
        metadata: { ...read.failure, flag: key, lastReadAt: new Date(cache.readAt).toISOString() },
      })
      return cache.flags[key] === true
    }
    const fallback = ON_WHEN_UNREADABLE.has(key)
    logger.error('Failed to read messaging flags and none has been read yet; using the fallback', {
      metadata: { ...read.failure, flag: key, fallback: fallback ? 'on' : 'off' },
    })
    return fallback
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
 * On is the boolean true and off is a missing row, a missing key, false or null, all from the
 * same 60-second cache as isMessagingFlagOn. Unknown means the row could not be read (never
 * cached, so the next call reads it again), or that it holds something other than a boolean for
 * this key, or something other than an object at all: a value someone meant as a setting but
 * saved wrongly is not taken as off. Logs nothing: what unknown means is the caller's decision,
 * and the caller says so once.
 */
export async function readMessagingFlagState(key: MessagingFlagKey): Promise<MessagingFlagState> {
  const read = await readFlags()
  if (!read.ok) {
    return { state: 'unknown', failure: read.failure }
  }

  if (read.malformed) {
    return { state: 'unknown', failure: malformedFailure('the messaging_flags value is not a JSON object') }
  }

  const value = read.flags[key]
  if (value === true) return { state: 'on' }
  if (value === undefined || value === null || value === false) return { state: 'off' }
  return { state: 'unknown', failure: malformedFailure(`messaging_flags.${key} is not true or false`) }
}

function malformedFailure(message: string): MessagingFlagsReadFailure {
  return { code: 'malformed_messaging_flags', message, details: null, hint: null }
}
