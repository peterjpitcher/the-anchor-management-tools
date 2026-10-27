import { logger } from '@/lib/logger'
import { queuedPrivateBookingTextStaleReason } from '@/lib/private-bookings/queue-staleness'

type QueueCleanupClient = {
  from: (table: 'private_booking_sms_queue') => any
}

export type QueueCleanupResult = { ok: true } | { ok: false; error: string }

/**
 * Cancel every text still waiting in the private booking queue (pending or approved) for a
 * booking that has just been cancelled or has expired, so nobody can approve and send it later.
 *
 * `private_booking_sms_queue` has no `updated_at` column. The old inline versions of this write
 * set one, PostgREST rejected the whole update, and because the returned error was never read
 * the rows stayed pending: approved reminders for cancelled bookings were still sitting in the
 * queue months later. Only `status` is written here, and a failure is logged with every field of
 * the database error rather than dropped.
 *
 * Never throws on a database error; returns it so the caller can carry on with the rest of the
 * cancellation, which has already happened.
 */
export async function cancelPendingQueuedSms(
  client: QueueCleanupClient,
  bookingId: string,
  context: string
): Promise<QueueCleanupResult> {
  const { error } = await client
    .from('private_booking_sms_queue')
    .update({ status: 'cancelled' })
    .eq('booking_id', bookingId)
    .in('status', ['pending', 'approved'])

  if (error) {
    logger.error('Failed to cancel queued texts for a cancelled private booking', {
      error: new Error(typeof error.message === 'string' ? error.message : 'queue cancel failed'),
      metadata: {
        bookingId,
        context,
        code: error.code ?? null,
        message: error.message ?? null,
        details: error.details ?? null,
        hint: error.hint ?? null,
      },
    })
    return { ok: false, error: typeof error.message === 'string' ? error.message : 'queue cancel failed' }
  }

  return { ok: true }
}

export type StaleQueueSweepResult = { expired: number; error?: string }

/**
 * Cancel every waiting private booking text whose date has passed (BK-064), so it can never be
 * approved and sent late. Run once a day by the expire-holds job. Only a row nobody is sending
 * (no dispatch claim in error_message) is touched, and each cancelled row records why in its
 * metadata. Never throws: a failure is logged and returned.
 */
export async function expireStaleQueuedPrivateBookingTexts(
  client: { from: (table: string) => any },
  todayIso: string
): Promise<StaleQueueSweepResult> {
  try {
    const { data: rows, error } = await client
      .from('private_booking_sms_queue')
      .select('id, booking_id, trigger_type, metadata')
      .in('status', ['pending', 'approved'])
      .is('error_message', null)
    if (error) throw new Error(error.message)
    const queued = (rows ?? []) as Array<{ id: string; booking_id: string; trigger_type: string | null; metadata: Record<string, unknown> | null }>
    if (queued.length === 0) return { expired: 0 }

    const bookingIds = [...new Set(queued.map((row) => row.booking_id))]
    const { data: bookings, error: bookingsError } = await client
      .from('private_bookings')
      .select('id, status, event_date')
      .in('id', bookingIds)
    if (bookingsError) throw new Error(bookingsError.message)
    const bookingById = new Map(((bookings ?? []) as Array<{ id: string; status: string | null; event_date: string | null }>).map((row) => [row.id, row]))

    let expired = 0
    for (const row of queued) {
      const reason = queuedPrivateBookingTextStaleReason(row, bookingById.get(row.booking_id) ?? null, todayIso)
      if (!reason) continue
      const { data: cancelled, error: cancelError } = await client
        .from('private_booking_sms_queue')
        .update({ status: 'cancelled', metadata: { ...(row.metadata ?? {}), expired_reason: reason, expired_on: todayIso } })
        .eq('id', row.id)
        .in('status', ['pending', 'approved'])
        .is('error_message', null)
        .select('id')
        .maybeSingle()
      if (cancelError) {
        logger.error('Failed to expire an out-of-date private booking text', {
          error: new Error(cancelError.message),
          metadata: { queueId: row.id, bookingId: row.booking_id, reason },
        })
        continue
      }
      if (cancelled) expired += 1
    }
    return { expired }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Expiring out-of-date private booking texts failed', { error: new Error(message) })
    return { expired: 0, error: message }
  }
}
