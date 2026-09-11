import { logger } from '@/lib/logger'

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
