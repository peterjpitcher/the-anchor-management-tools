import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBookingScheduledSms } from '@/services/private-bookings/scheduled-sms'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'
import { loadPrivateBookingEmails } from '@/lib/private-bookings/email-timeline'
import {
  CommunicationsTab,
  type CommunicationsEmailRow,
  type CommunicationsHistoryRow,
} from './CommunicationsTab'

/**
 * Server wrapper for the Communications tab.
 *
 * - Reads `private_booking_sms_queue` history (most recent 50) via the
 *   cookie-based client so RLS is respected for interactive users.
 * - Computes the scheduled preview via the shared helper, which uses the
 *   admin client internally (idempotency + booking lookup).
 * - Derives `isDateTbd` from `internal_notes` so the empty state can give
 *   the right guidance.
 */
export async function CommunicationsTabServer({
  bookingId,
}: {
  bookingId: string
}) {
  const supabase = await createClient()

  // The column is twilio_message_sid. Selecting twilio_sid made PostgREST reject
  // the whole request with 42703, and because the error was discarded the tab
  // rendered an empty history for every booking instead of failing loudly.
  const { data: historyData, error: historyError } = await supabase
    .from('private_booking_sms_queue')
    .select(
      'id, created_at, trigger_type, template_key, status, message_body, twilio_sid:twilio_message_sid, scheduled_for, metadata',
    )
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (historyError) {
    console.error('[CommunicationsTab] Failed to load SMS history', historyError)
  }

  const history: CommunicationsHistoryRow[] = (historyData ?? []).map((row) => ({
    id: String(row.id),
    created_at: String(row.created_at),
    trigger_type: row.trigger_type ? String(row.trigger_type) : null,
    template_key: row.template_key ? String(row.template_key) : null,
    status: String(row.status ?? 'unknown'),
    message_body: row.message_body ? String(row.message_body) : null,
    twilio_sid: row.twilio_sid ? String(row.twilio_sid) : null,
    scheduled_for: row.scheduled_for ? String(row.scheduled_for) : null,
    // An approved text that Send Now delivered as an email instead (email first).
    delivered_by:
      row.metadata && typeof row.metadata === 'object' && (row.metadata as Record<string, unknown>).delivered_by === 'email'
        ? 'email'
        : null,
  }))

  // Emails about this booking: service-role only, and this page has already checked that the
  // viewer may see the booking.
  const emailResult = await loadPrivateBookingEmails(bookingId)
  const emails: CommunicationsEmailRow[] = emailResult.rows.map((row) => ({
    id: row.id,
    created_at: row.sent_at ?? row.created_at,
    comm_type: row.comm_type,
    subject: row.subject,
    status: row.status,
    to_address: row.to_address,
    error: row.error,
  }))

  const scheduled = await getBookingScheduledSms(bookingId)

  // Re-read booking to determine TBD flag for the empty-state copy. Use the
  // admin client so this works even when the caller has limited RLS
  // visibility for the internal_notes column.
  const db = createAdminClient()
  const { data: bookingRow } = await db
    .from('private_bookings')
    .select('internal_notes')
    .eq('id', bookingId)
    .maybeSingle()

  const isDateTbd = bookingRow ? isBookingDateTbd(bookingRow) : false

  return (
    <CommunicationsTab
      history={history}
      scheduled={scheduled}
      isDateTbd={isDateTbd}
      emails={emails}
      emailsError={emailResult.error}
    />
  )
}
