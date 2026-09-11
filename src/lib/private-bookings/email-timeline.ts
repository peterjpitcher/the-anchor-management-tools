import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { PrivateBookingAuditWithUser } from '@/types/private-bookings'

/** The email_messages columns shown for a private booking. */
export const PRIVATE_BOOKING_EMAIL_COLUMNS =
  'id, created_at, sent_at, comm_type, subject, status, to_address, error, direction'

export type PrivateBookingEmailRow = {
  id: string
  created_at: string
  sent_at: string | null
  comm_type: string | null
  subject: string | null
  status: string
  to_address: string | null
  error: string | null
  direction: string | null
}

/**
 * Emails sent about one private booking, newest first. `email_messages` is readable by the service
 * role only, so this uses the admin client; callers show it only to staff who can already see the
 * booking (the booking detail and Communications pages check private_bookings.view first).
 */
export async function loadPrivateBookingEmails(bookingId: string, limit = 50): Promise<{ rows: PrivateBookingEmailRow[]; error: string | null }> {
  try {
    const { data, error } = await (createAdminClient().from('email_messages') as any)
      .select(PRIVATE_BOOKING_EMAIL_COLUMNS)
      .eq('private_booking_id', bookingId)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) {
      logger.warn('Private booking emails could not be loaded', {
        metadata: { bookingId, code: error.code ?? null, message: error.message ?? null },
      })
      return { rows: [], error: typeof error.message === 'string' ? error.message : 'Failed to load emails' }
    }
    return { rows: (data ?? []) as PrivateBookingEmailRow[], error: null }
  } catch (error) {
    logger.warn('Private booking emails lookup failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return { rows: [], error: 'Failed to load emails' }
  }
}

const UNDELIVERED_STATUSES = new Set(['bounced', 'complained', 'failed', 'suppressed'])

/**
 * The booking's emails as timeline entries, so they sit beside the texts. An email that already
 * has an audit row from the messenger (which records its email_messages id) is not repeated.
 */
export async function loadPrivateBookingEmailTimeline(
  bookingId: string,
  audits: PrivateBookingAuditWithUser[]
): Promise<PrivateBookingAuditWithUser[]> {
  const { rows } = await loadPrivateBookingEmails(bookingId)
  const alreadyOnTimeline = new Set(
    audits
      .map((entry) => (entry.metadata as Record<string, unknown> | undefined)?.email_message_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  )

  return rows
    .filter((row) => !alreadyOnTimeline.has(row.id))
    .map((row) => {
      const undelivered = UNDELIVERED_STATUSES.has(row.status)
      const subject = row.subject?.trim() || '(no subject)'
      const statusText = undelivered ? `not delivered (${row.status}${row.error ? `: ${row.error}` : ''})` : row.status
      return {
        id: `email:${row.id}`,
        booking_id: bookingId,
        action: undelivered ? 'email_not_delivered' : 'email_sent',
        field_name: 'email',
        new_value: row.comm_type ?? undefined,
        metadata: {
          description: `Email "${subject}" to ${row.to_address ?? 'the guest'}, ${statusText}.`,
          email_message_id: row.id,
          source: 'email_messages',
        },
        performed_at: row.sent_at ?? row.created_at,
      }
    })
}
