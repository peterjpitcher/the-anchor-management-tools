import { getTodayIsoDate } from '@/lib/dateUtils'
import { effectiveWaiverStatus } from '@/lib/private-bookings/waiver-status'
import { createAdminClient } from '@/lib/supabase/admin'
import { isStaffRecordedAcceptance } from './contract-acceptance'
import type { SigningDocumentRow } from './types'

/**
 * Is the record a document belongs to still one that needs signing?
 *
 * A request for signature outlives the moment it was sent, and the record it belongs to moves
 * on: the booking is cancelled, staff mark the quote accepted by phone, the worker leaves, the
 * waiver is signed on paper and uploaded. None of those actions knows about signing, and there
 * are too many of them (and more will be added) to teach each one. So the check lives here, in
 * one place, and is made at the moments that matter: before a reminder goes out, when the
 * signer opens the link, and before a signature is recorded. A closed record means the request
 * is withdrawn, with the reason, instead of chasing someone to sign a contract for an event
 * that is not happening.
 *
 * Returns the reason as a short sentence for the record, or null while the request stands.
 */
export async function findSubjectClosure(
  document: Pick<SigningDocumentRow, 'kind' | 'subject_type' | 'subject_id' | 'context'>
): Promise<string | null> {
  const admin = createAdminClient()

  const bookingClosure = async (bookingId: string, forWaiver: boolean, forContract = false): Promise<string | null> => {
    const { data, error } = await admin
      .from('private_bookings')
      .select('status, waiver_status, outside_food, contract_acceptance_method')
      .eq('id', bookingId)
      .maybeSingle()
    if (error) throw new Error(`Could not read the booking: ${error.message}`)
    if (!data) return 'The booking no longer exists'
    if (data.status === 'cancelled') return 'The booking was cancelled'
    // Staff recorded a paper signature or a written confirmation, so there is nothing left to
    // sign. Paying the deposit also accepts the contract, but does not close the request: a
    // customer who has paid may still sign.
    if (forContract && isStaffRecordedAcceptance(data.contract_acceptance_method)) {
      return 'The contract was accepted another way'
    }
    if (forWaiver && data.waiver_status === 'signed') return 'The waiver was recorded as signed by staff'
    // Staff unticked "Outside food" after the agreement went out: there is nothing left to sign.
    if (forWaiver && effectiveWaiverStatus(data) === 'not_required') return 'The booking no longer has outside food'
    return null
  }

  switch (document.subject_type) {
    case 'private_booking':
      return bookingClosure(
        document.subject_id,
        document.kind === 'private_booking_waiver',
        document.kind === 'private_booking_contract'
      )

    case 'vendor': {
      // A supplier confirmation is for one booking, and is moot once that booking is.
      const bookingId = document.context.private_booking_id
      return typeof bookingId === 'string' ? bookingClosure(bookingId, false) : null
    }

    case 'quote': {
      const { data, error } = await admin
        .from('quotes')
        // The live quotes table has no deleted_at column (checked 13 October 2026); a deleted
        // quote is simply gone.
        .select('status, valid_until')
        .eq('id', document.subject_id)
        .maybeSingle()
      if (error) throw new Error(`Could not read the quote: ${error.message}`)
      if (!data) return 'The quote no longer exists'
      if (data.status === 'accepted') return 'Staff marked the quote as accepted'
      if (data.status === 'rejected') return 'The quote was marked as rejected'
      if (data.status === 'expired') return 'The quote has expired'
      if (typeof data.valid_until === 'string' && data.valid_until.slice(0, 10) < getTodayIsoDate()) {
        return 'The quote has passed its valid-until date'
      }
      return null
    }

    case 'employee': {
      const { data, error } = await admin
        .from('employees')
        .select('status')
        .eq('employee_id', document.subject_id)
        .maybeSingle()
      if (error) throw new Error(`Could not read the employee: ${error.message}`)
      if (!data) return 'The employee record no longer exists'
      if (data.status === 'Former') return 'They no longer work here'
      return null
    }

    case 'recruitment_application': {
      const { data, error } = await admin
        .from('recruitment_applications')
        .select('status')
        .eq('id', document.subject_id)
        .maybeSingle()
      if (error) throw new Error(`Could not read the application: ${error.message}`)
      if (!data) return 'The application no longer exists'
      if (data.status === 'hired') return 'The candidate has been hired'
      if (data.status !== 'offered') return 'The application is no longer at the offer stage'
      return null
    }

    case 'invoice_vendor':
      return null
  }
}
