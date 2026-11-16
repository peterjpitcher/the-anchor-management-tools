import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { recordNotificationAttempt, updateNotificationDelivery } from '@/lib/notifications/delivery-ledger'

/**
 * A text that was queued (held for quiet hours, usually) is recorded as sent at the moment it
 * is queued, because the queue normally delivers it. When the queued job then fails for good,
 * nobody was told: on 13 November 2026 a guest's booking confirmation was queued overnight to
 * a number that cannot take our texts, his email had failed too, and the ledger still said the
 * message had reached him.
 *
 * This puts the record right: the delivery the text belonged to becomes `failed`, so it shows
 * under Settings, SMS failures, Undelivered guest messages and counts in the comms health check.
 *
 * The job does not carry the delivery's id, so the delivery is found by what does identify it:
 * the same customer and template, a text as the channel that "reached" the guest, written in
 * the moments before the job was queued. A delivery whose email got through is never matched,
 * because its channel is email.
 *
 * Two texts with one template can be queued for one guest in the same minute (confirmations
 * for two bookings). The job's booking ids settle which is which: a delivery that names the
 * same booking is the one, and a delivery that names a different booking is never touched.
 * Some deliveries name no booking; one of those is taken only when nothing names this one.
 * Never throws: the job has already failed.
 */
const BOOKING_KEYS = ['event_booking_id', 'table_booking_id', 'private_booking_id', 'parking_booking_id'] as const

type Candidate = { id: string; metadata: Record<string, unknown> | null }

/** 'same' when it names one of the job's bookings, 'other' when it names a different one. */
function bookingMatch(candidate: Candidate, job: Record<string, unknown>): 'same' | 'other' | 'unnamed' {
  let match: 'same' | 'other' | 'unnamed' = 'unnamed'
  for (const key of BOOKING_KEYS) {
    const wanted = job[key]
    const found = candidate.metadata?.[key]
    if (typeof wanted !== 'string' || !wanted || typeof found !== 'string' || !found) continue
    if (found !== wanted) return 'other'
    match = 'same'
  }
  return match
}

const BEFORE_QUEUE_MS = 2 * 60 * 1000
const AFTER_QUEUE_MS = 10 * 1000

export async function markQueuedTextUndelivered(input: {
  customerId: string | null
  templateKey: string | null
  /** When the job was queued (its created_at). */
  queuedAt: string
  error: string
  /** The job's metadata, for the booking ids that tell two deliveries apart. */
  jobMetadata?: Record<string, unknown> | null
}): Promise<boolean> {
  if (!input.customerId || !input.templateKey) return false
  const queuedMs = Date.parse(input.queuedAt)
  if (!Number.isFinite(queuedMs)) return false

  try {
    const client = createAdminClient()
    const { data, error } = await (client.from('notification_deliveries') as any)
      .select('id, metadata')
      .eq('customer_id', input.customerId)
      .eq('template_key', input.templateKey)
      .eq('selected_channel', 'sms')
      .in('final_status', ['sent', 'fallback_sent'])
      .gte('created_at', new Date(queuedMs - BEFORE_QUEUE_MS).toISOString())
      .lte('created_at', new Date(queuedMs + AFTER_QUEUE_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) {
      logger.error('Could not look up the delivery behind a failed queued text', {
        error: new Error(error.message),
        metadata: { templateKey: input.templateKey, code: error.code ?? null, details: error.details ?? null, hint: error.hint ?? null },
      })
      return false
    }
    const job = input.jobMetadata ?? {}
    const candidates = ((data ?? []) as Candidate[])
      .map((candidate) => ({ candidate, match: bookingMatch(candidate, job) }))
      .filter((entry) => entry.match !== 'other')
    // Newest first already; a delivery that names this booking beats one that names none.
    const delivery = (candidates.find((entry) => entry.match === 'same') ?? candidates[0])?.candidate ?? null
    if (!delivery) return false

    const { count } = await (client.from('notification_attempts') as any)
      .select('id', { count: 'exact', head: true })
      .eq('delivery_id', delivery.id)
    await recordNotificationAttempt({
      client,
      deliveryId: delivery.id,
      attemptOrder: Number(count ?? 0) + 1,
      channel: 'sms',
      success: false,
      error: input.error,
      code: 'queued_text_failed',
    })
    return await updateNotificationDelivery({
      client,
      deliveryId: delivery.id,
      finalStatus: 'failed',
      selectedChannel: null,
      metadata: { ...(delivery.metadata ?? {}), undelivered_reason: 'queued_text_failed' },
    })
  } catch (error) {
    logger.error('Could not mark the delivery behind a failed queued text as undelivered', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { templateKey: input.templateKey },
    })
    return false
  }
}
