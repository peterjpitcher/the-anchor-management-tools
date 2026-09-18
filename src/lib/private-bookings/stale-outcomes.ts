import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { logger } from '@/lib/logger'

const STALE_WINDOW_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const STALE_WINDOW_MS = STALE_WINDOW_DAYS * DAY_MS

export type StalePendingOutcome = {
  booking_id: string
  customer_name: string
  customer_last_name: string | null
  event_date: string
  outcome_email_sent_at: string
  days_since_email: number
}

type StaleOutcomeRow = {
  id: string
  customer_name: string | null
  customer_last_name: string | null
  event_date: string | null
  outcome_email_sent_at: string | null
}

/**
 * Private bookings whose manager outcome email was sent more than 14 days
 * before `now` but whose post_event_outcome is still 'pending'. This is the
 * signal that manager@the-anchor.pub is under-watched: review requests are not
 * going out for events that DID go well because nobody is clicking the links.
 *
 * Client-injected and read only, so the weekly insights report can run it on
 * its own deadline-bound client at its own instant. Throws when the read fails,
 * so a caller can tell "none" from "could not check".
 *
 * Sorted by oldest email first.
 */
export async function readStalePendingOutcomes(
  db: ReturnType<typeof createAdminClient>,
  now: Date,
): Promise<StalePendingOutcome[]> {
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('Stale outcomes need a valid time')
  const cutoffIso = new Date(nowMs - STALE_WINDOW_MS).toISOString()

  const rows = await fetchAllRows<StaleOutcomeRow>(
    (from, to) => db
      .from('private_bookings')
      .select('id, customer_name, customer_last_name, event_date, outcome_email_sent_at')
      .eq('post_event_outcome', 'pending')
      .not('outcome_email_sent_at', 'is', null)
      .lt('outcome_email_sent_at', cutoffIso)
      .order('outcome_email_sent_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    { label: 'stale private booking outcomes' },
  )

  return rows
    .map((row) => {
      const emailSentAt = row.outcome_email_sent_at
      if (!emailSentAt) return null

      const sentMs = Date.parse(emailSentAt)
      if (!Number.isFinite(sentMs)) return null

      return {
        booking_id: row.id,
        customer_name: row.customer_name ?? 'Unknown guest',
        customer_last_name: row.customer_last_name?.trim() || null,
        event_date: row.event_date ?? '',
        outcome_email_sent_at: emailSentAt,
        days_since_email: Math.max(0, Math.floor((nowMs - sentMs) / DAY_MS)),
      }
    })
    .filter((row): row is StalePendingOutcome => row !== null)
}

/**
 * The same list on a fresh admin client at the current time. Fail-safe for the
 * existing callers: on a read error it logs and returns [].
 */
export async function getStalePendingOutcomes(): Promise<StalePendingOutcome[]> {
  const supabase = createAdminClient()
  try {
    return await readStalePendingOutcomes(supabase, new Date())
  } catch (error) {
    logger.error('getStalePendingOutcomes: query failed', {
      error: error instanceof Error ? error : new Error('stale outcomes query failed')
    })
    return []
  }
}
