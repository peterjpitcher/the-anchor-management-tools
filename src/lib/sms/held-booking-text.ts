import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Whether a booking text held by quiet hours has gone stale by the time the queue sends it.
 *
 * Event booking texts carry the booking id and the status they were written for. A website
 * "seats held, pay here" text written at 21:30 used to go out at 09:00 whether or not the guest
 * had paid in the meantime, or the 15-minute hold had lapsed (BK-084, customer bookings review of
 * 24 October 2026). Returns why the text should be dropped, or null to send it.
 *
 * A text without both fields is sent as before. A failed read throws, so the job is retried
 * rather than sending a text that may be wrong or dropping one that may be right.
 */
export async function findStaleEventBookingSmsReason(
  metadata: unknown,
  now: Date = new Date()
): Promise<string | null> {
  if (typeof metadata !== 'object' || metadata === null) return null
  const record = metadata as Record<string, unknown>
  const bookingId = typeof record.event_booking_id === 'string' ? record.event_booking_id : null
  const expectedStatus =
    typeof record.expected_booking_status === 'string' ? record.expected_booking_status : null
  if (!bookingId || !expectedStatus) return null

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('bookings')
    .select('id, status, hold_expires_at')
    .eq('id', bookingId)
    .maybeSingle()

  if (error) {
    throw new Error(`Could not check the booking before a held text: ${error.message}`)
  }
  if (!data) return 'booking_missing'
  if (data.status !== expectedStatus) return `booking_now_${data.status ?? 'unknown'}`

  if (expectedStatus === 'pending_payment') {
    const holdIso = (data.hold_expires_at as string | null) ?? (typeof record.hold_expires_at === 'string' ? record.hold_expires_at : null)
    const holdMs = holdIso ? Date.parse(holdIso) : Number.NaN
    if (Number.isFinite(holdMs) && holdMs <= now.getTime()) return 'hold_expired'
  }

  return null
}
