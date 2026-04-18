import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

const STALE_WINDOW_DAYS = 14
const STALE_WINDOW_MS = STALE_WINDOW_DAYS * 24 * 60 * 60 * 1000

export type StalePendingOutcome = {
  booking_id: string
  customer_name: string
  event_date: string
  outcome_email_sent_at: string
  days_since_email: number
}

/**
 * Return private bookings whose manager outcome email was sent more than
 * 14 days ago but whose post_event_outcome is still 'pending'. This is the
 * signal that manager@the-anchor.pub is under-watched — review requests
 * are not going out for events that DID go well because nobody is clicking
 * the links.
 *
 * Sorted by oldest-email-first so the weekly digest highlights the
 * longest-outstanding rows.
 */
export async function getStalePendingOutcomes(): Promise<StalePendingOutcome[]> {
  const supabase = createAdminClient()
  const cutoffIso = new Date(Date.now() - STALE_WINDOW_MS).toISOString()

  const { data, error } = await supabase
    .from('private_bookings')
    .select('id, customer_name, event_date, outcome_email_sent_at')
    .eq('post_event_outcome', 'pending')
    .not('outcome_email_sent_at', 'is', null)
    .lt('outcome_email_sent_at', cutoffIso)
    .order('outcome_email_sent_at', { ascending: true })
    .limit(200)

  if (error) {
    logger.error('getStalePendingOutcomes: query failed', {
      error: new Error(error.message || 'stale outcomes query failed')
    })
    return []
  }

  const rows = data ?? []
  const now = Date.now()

  return rows
    .map((row) => {
      const emailSentAt = row.outcome_email_sent_at
      if (!emailSentAt) return null

      const sentMs = Date.parse(emailSentAt)
      if (!Number.isFinite(sentMs)) return null

      return {
        booking_id: row.id,
        customer_name: row.customer_name ?? 'Unknown guest',
        event_date: row.event_date ?? '',
        outcome_email_sent_at: emailSentAt,
        days_since_email: Math.max(
          0,
          Math.floor((now - sentMs) / (24 * 60 * 60 * 1000))
        )
      }
    })
    .filter((row): row is StalePendingOutcome => row !== null)
}
