import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

/**
 * Whether an invoice belongs to a private booking that has been cancelled (BK-065, customer
 * bookings review of 24 October 2026). Such an invoice is never paid online: a guest whose booking
 * was cancelled could still pay its invoice through the portal. Cancelling the booking voids an
 * unpaid invoice; one with money already received stays open for a credit note, and this keeps it
 * closed to new payments.
 *
 * 'unknown' when the check could not be read, which callers treat as not payable.
 */
export async function invoiceBookingCancelled(invoiceId: string): Promise<boolean | 'unknown'> {
  try {
    const db = createAdminClient()
    const [{ data: owners, error: ownersError }, { data: links, error: linksError }] = await Promise.all([
      db.from('private_bookings').select('id, status').eq('invoice_id', invoiceId),
      db.from('private_booking_invoices').select('booking_id').eq('invoice_id', invoiceId),
    ])
    if (ownersError || linksError) throw new Error((ownersError ?? linksError)?.message)

    const statuses = ((owners ?? []) as Array<{ status: string | null }>).map((row) => row.status)
    const linkedIds = ((links ?? []) as Array<{ booking_id: string }>).map((row) => row.booking_id)
    if (linkedIds.length > 0) {
      const { data: linked, error: linkedError } = await db.from('private_bookings').select('status').in('id', linkedIds)
      if (linkedError) throw new Error(linkedError.message)
      statuses.push(...((linked ?? []) as Array<{ status: string | null }>).map((row) => row.status))
    }
    return statuses.includes('cancelled')
  } catch (error) {
    logger.error('Could not check whether an invoice\'s private booking was cancelled', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { invoiceId },
    })
    return 'unknown'
  }
}

export const CANCELLED_BOOKING_INVOICE_UNPAYABLE =
  'The booking this invoice is for has been cancelled, so it cannot be paid online. Please contact us.'
