import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { SYSTEM_USER_ID } from '@/lib/system-user'
import { SIGNING_OPEN_STATUSES } from '@/lib/signing/types'
import {
  contractOutOfDate,
  describeContractTermsChanges,
  type ContractOutOfDate,
  type ContractTermsItem,
} from '@/lib/private-bookings/contract-terms'

/**
 * After a private booking or one of its items changes: if the contract the customer was sent no
 * longer matches the booking (its date, times, guest numbers, rooms or price), withdraw any
 * request to sign it that is still open, so nobody signs terms that are no longer the booking's
 * (owner decision D25, review BK-154). The booking page then says the contract is out of date
 * and asks for the next version; sending it is a deliberate act and is left to staff.
 *
 * The food agreement sent with that contract names the same event, so an open request for it is
 * withdrawn too; the next contract sends it again. Signed documents are never touched: a signed
 * copy and its evidence trail stand as they are.
 *
 * Never throws: the change it follows has already been saved. A failure is logged at error
 * level and returned as null, and the page still shows the contract as out of date because it
 * works that out from the booking itself.
 */
export async function withdrawOutOfDateContractRequests(
  bookingId: string,
  performedBy?: string | null,
): Promise<{ outOfDate: ContractOutOfDate; withdrawn: string[] } | null> {
  try {
    const admin = createAdminClient()
    const { data: booking, error } = await admin
      .from('private_bookings')
      .select('id, status, contract_version, contract_sent_at, contract_accepted_at, contract_terms, event_date, date_tbd, start_time, end_time, end_time_next_day, guest_count, discount_type, discount_amount, items:private_booking_items(space_id, quantity, unit_price, line_total, vat_rate, discount_type, discount_value)')
      .eq('id', bookingId)
      .maybeSingle()
    if (error) throw new Error(`Could not read the booking: ${error.message}`)
    if (!booking) return null

    const outOfDate = contractOutOfDate(booking, (booking.items ?? []) as ContractTermsItem[])
    if (!outOfDate) return null

    const { data: open, error: openError } = await admin
      .from('signing_documents')
      .select('id, kind')
      .eq('subject_type', 'private_booking')
      .eq('subject_id', bookingId)
      .in('kind', ['private_booking_contract', 'private_booking_waiver'])
      .in('status', [...SIGNING_OPEN_STATUSES])
    if (openError) throw new Error(`Could not read the open signing requests: ${openError.message}`)
    if (!open || open.length === 0) return { outOfDate, withdrawn: [] }

    const { voidSigningDocument } = await import('@/lib/signing/service')
    const reason = `The booking changed after this was sent (${describeContractTermsChanges(outOfDate.changes)}). A new version is needed.`
    const withdrawn: string[] = []
    for (const document of open) {
      try {
        await voidSigningDocument({ documentId: document.id as string, userId: performedBy ?? SYSTEM_USER_ID, reason })
        withdrawn.push(document.id as string)
      } catch (voidError) {
        // Signed, or withdrawn, in the moment since it was read: nothing more to do for it.
        logger.warn('An out-of-date signing request could not be withdrawn', {
          metadata: { bookingId, documentId: document.id, error: voidError instanceof Error ? voidError.message : String(voidError) },
        })
      }
    }

    if (withdrawn.length > 0) {
      const { error: auditError } = await admin.from('private_booking_audit').insert({
        booking_id: bookingId,
        action: 'contract_out_of_date',
        performed_by: performedBy ?? null,
        metadata: {
          changes: outOfDate.changes,
          contract_version: outOfDate.currentVersion,
          withdrawn_signing_document_ids: withdrawn,
        },
      })
      if (auditError) {
        logger.error('Could not record that an out-of-date contract request was withdrawn', {
          error: new Error(auditError.message),
          metadata: { bookingId, withdrawn },
        })
      }
    }
    return { outOfDate, withdrawn }
  } catch (checkError) {
    logger.error('Checking whether the contract is out of date failed (non-blocking)', {
      error: checkError instanceof Error ? checkError : new Error(String(checkError)),
      metadata: { bookingId },
    })
    return null
  }
}
