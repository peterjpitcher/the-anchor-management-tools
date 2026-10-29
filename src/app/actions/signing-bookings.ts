'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { bookingRequiresWaiverAnnex } from '@/lib/contract-template'
import { getTodayIsoDate, isValidIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import { getErrorMessage } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { markWaiverSent } from '@/lib/private-bookings/contract-lifecycle'
import {
  contractOutOfDate,
  contractTermsOf,
  type ContractOutOfDate,
  type ContractTerms,
  type ContractTermsItem,
} from '@/lib/private-bookings/contract-terms'
import { waiverIsOutstanding } from '@/lib/private-bookings/waiver-status'
import {
  STAFF_RECORDED_ACCEPTANCE_METHODS,
  STAFF_RECORDED_ACCEPTANCE_VOID_REASON,
  describeContractAcceptance,
  type StaffRecordedAcceptanceMethod,
} from '@/lib/signing/contract-acceptance'
import { WAIVER_TITLE, bookingSignerParty, prepareBookingWaiver } from '@/lib/signing/documents/booking-contract'
import {
  SigningError,
  createSigningRequest,
  listSigningDocumentsForSubject,
  voidSigningDocument,
  type PartyDelivery,
  type SigningDocumentSummary,
} from '@/lib/signing/service'
import { canSendSigningKind, canViewSigningKind, getSigningStaffUser } from '@/lib/signing/staff'
import { SIGNING_OPEN_STATUSES } from '@/lib/signing/types'
import { createAdminClient } from '@/lib/supabase/admin'

type ActionResult<T = undefined> = { success?: boolean; error?: string; data?: T }

const UuidSchema = z.string().uuid()

function failure(error: unknown): { error: string } {
  if (error instanceof SigningError) return { error: error.message }
  console.error('Booking signing action failed:', error)
  return { error: getErrorMessage(error) || 'Something went wrong. Please try again.' }
}

export interface BookingSigningState {
  documents: SigningDocumentSummary[]
  /** True when the booking has outside food, so the food agreement applies. */
  waiverRequired: boolean
  /** True while the food agreement is owed and not yet signed. */
  waiverOutstanding: boolean
  waiverStatus: string | null
  hasEmail: boolean
  canSend: boolean
  /** True once a contract has been produced for the booking (generated, or emailed). */
  contractIssued: boolean
  /** When the contract was accepted, or null while it is not. */
  contractAcceptedAt: string | null
  /** How: e_signature, deposit_payment, signed_paper or written_confirmation. */
  contractAcceptanceMethod: string | null
  /** May this person record, now, that the contract was signed on paper or confirmed in writing? */
  canRecordAcceptance: boolean
  /** Set when the booking has changed since its contract was sent or accepted (BK-154). */
  contractOutOfDate: ContractOutOfDate | null
}

interface BookingContractFacts {
  status?: string | null
  contract_version?: number | null
  contract_sent_at?: string | null
  contract_accepted_at?: string | null
  contract_acceptance_method?: string | null
  contract_terms?: unknown
}

/** The booking's contract terms as it stands now (contract-terms.ts). */
async function readContractTermsNow(admin: ReturnType<typeof createAdminClient>, bookingId: string): Promise<ContractTerms | null> {
  const { data, error } = await admin
    .from('private_bookings')
    .select('id, event_date, date_tbd, start_time, end_time, end_time_next_day, guest_count, discount_type, discount_amount, items:private_booking_items(space_id, quantity, unit_price, line_total, vat_rate, discount_type, discount_value)')
    .eq('id', bookingId)
    .maybeSingle()
  if (error) throw new Error(`Could not read the booking: ${error.message}`)
  if (!data) return null
  return contractTermsOf(data, (data.items ?? []) as ContractTermsItem[])
}

/**
 * Has a contract ever been produced for this booking? Generating one mints a version (from 1),
 * and emailing one stamps when it went. Either means there is a contract the customer could have
 * signed on paper or confirmed in writing; neither means there is nothing to have accepted.
 */
function contractWasIssued(booking: BookingContractFacts): boolean {
  return Number(booking.contract_version ?? 0) > 0 || Boolean(booking.contract_sent_at)
}

function alreadyAcceptedMessage(booking: BookingContractFacts): string {
  const how = describeContractAcceptance(booking.contract_acceptance_method, booking.contract_accepted_at)
  return `This contract is already accepted: ${how.charAt(0).toLowerCase()}${how.slice(1)}.`
}

/** What the booking page's signing panel needs: the documents, and whether a waiver is owed. */
export async function getBookingSigningState(bookingId: string): Promise<ActionResult<BookingSigningState>> {
  try {
    if (!UuidSchema.safeParse(bookingId).success) return { error: 'Unknown booking.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await canViewSigningKind('private_booking_contract', user.id))) return { error: 'Insufficient permissions' }

    const admin = createAdminClient()
    const { data: booking, error } = await admin
      .from('private_bookings')
      .select('id, contact_email, outside_food, waiver_status, status, contract_version, contract_sent_at, contract_accepted_at, contract_acceptance_method, contract_terms, event_date, date_tbd, start_time, end_time, end_time_next_day, guest_count, discount_type, discount_amount, items:private_booking_items(item_type, space_id, quantity, unit_price, line_total, vat_rate, discount_type, discount_value, package:catering_packages(id, name, requires_waiver))')
      .eq('id', bookingId)
      .maybeSingle()
    if (error) throw new Error(`Could not read the booking: ${error.message}`)
    if (!booking) return { error: 'Booking not found.' }

    const contract = booking as BookingContractFacts
    const accepted = Boolean(contract.contract_accepted_at)
    const canRecordAcceptance =
      contractWasIssued(contract) &&
      !accepted &&
      contract.status !== 'cancelled' &&
      (await canSendSigningKind('private_booking_contract', user.id))

    return {
      success: true,
      data: {
        documents: await listSigningDocumentsForSubject('private_booking', bookingId),
        // Only the fields the check reads are selected, which is less than the full item type.
        waiverRequired: bookingRequiresWaiverAnnex(booking as unknown as Parameters<typeof bookingRequiresWaiverAnnex>[0]),
        waiverOutstanding: waiverIsOutstanding(booking as { outside_food?: boolean | null; waiver_status?: string | null }),
        waiverStatus: (booking.waiver_status as string | null) ?? null,
        hasEmail: Boolean(booking.contact_email),
        canSend: await canSendSigningKind('private_booking_waiver', user.id),
        contractIssued: contractWasIssued(contract),
        contractAcceptedAt: contract.contract_accepted_at ?? null,
        contractAcceptanceMethod: contract.contract_acceptance_method ?? null,
        canRecordAcceptance,
        contractOutOfDate: contractOutOfDate(booking, (booking.items ?? []) as ContractTermsItem[]),
      },
    }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Send the self-catering and outside food agreement on its own: for a booking whose contract was
 * already accepted another way (by paying the deposit), or that gained outside food after its
 * contract went out. Email Contract sends it alongside the contract, as its own document.
 */
export async function sendBookingWaiver(bookingId: string): Promise<ActionResult<{ documentId: string; deliveries: PartyDelivery[] }>> {
  try {
    if (!UuidSchema.safeParse(bookingId).success) return { error: 'Unknown booking.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await canSendSigningKind('private_booking_waiver', user.id))) return { error: 'Insufficient permissions' }

    const { prepared, booking } = await prepareBookingWaiver(bookingId)
    if (booking.waiver_status === 'signed') return { error: 'The food agreement for this booking is already signed.' }
    const party = bookingSignerParty(booking)
    if (!party.name) return { error: 'Add the customer\'s name to the booking first.' }

    const result = await createSigningRequest({
      kind: 'private_booking_waiver',
      subjectId: bookingId,
      title: WAIVER_TITLE,
      summary: 'This covers food you bring or arrange yourself for your event. It is signed separately from the contract.',
      pdf: prepared.pdf,
      render: prepared.render,
      parties: [party],
      createdBy: user.id,
      createdByName: user.name,
    })

    // The booking says the agreement was sent only if the link was emailed. A customer with no
    // email address signs in person, and a failed email is reported to whoever pressed send.
    if (result.deliveries.some((delivery) => delivery.email_status === 'sent')) {
      await markWaiverSent(createAdminClient(), { bookingId, via: 'food_agreement_sent', performedBy: user.id })
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'send',
      resource_type: 'signing_document',
      resource_id: result.documentId,
      operation_status: 'success',
      additional_info: { kind: 'private_booking_waiver', booking_id: bookingId, version: result.version },
    })
    revalidatePath(`/private-bookings/${bookingId}`)
    return { success: true, data: { documentId: result.documentId, deliveries: result.deliveries } }
  } catch (error) {
    return failure(error)
  }
}

const RecordAcceptanceSchema = z.object({
  bookingId: z.string().uuid('Unknown booking.'),
  method: z.enum(STAFF_RECORDED_ACCEPTANCE_METHODS, {
    message: 'Choose how the contract was accepted: signed on paper, or confirmed in writing.',
  }),
  acceptedOn: z.string().refine(isValidIsoDate, 'Enter the date the contract was accepted.'),
  note: z
    .string()
    .trim()
    .min(10, 'Say where the signed copy or the written confirmation is kept (at least 10 characters).')
    .max(500, 'Keep the note to 500 characters or fewer.'),
})

export interface RecordContractAcceptanceInput {
  bookingId: string
  method: StaffRecordedAcceptanceMethod
  /** The London date the customer signed or confirmed, YYYY-MM-DD. */
  acceptedOn: string
  /** Where the signed paper or the written confirmation is kept. */
  note: string
}

export interface RecordContractAcceptanceResult {
  acceptedAt: string
  /** How many open requests to sign the contract online were withdrawn. */
  withdrawn: number
  /** Set when the acceptance was recorded but an open signing request could not be withdrawn. */
  warning?: string
}

/**
 * Record that a customer accepted the booking contract by signing a paper copy or by confirming
 * in writing. This is the one exception to "nothing is marked signed by hand" (owner decision,
 * 13 October 2026): the contract's own wording allows both, and until now neither could be
 * recorded. The note says where the evidence is kept, and goes on the booking's audit trail.
 */
export async function recordContractAcceptedAnotherWay(
  input: RecordContractAcceptanceInput
): Promise<ActionResult<RecordContractAcceptanceResult>> {
  try {
    const parsed = RecordAcceptanceSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    const { bookingId, method, acceptedOn, note } = parsed.data

    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await canSendSigningKind('private_booking_contract', user.id))) return { error: 'Insufficient permissions' }

    if (acceptedOn > getTodayIsoDate()) return { error: 'The date the contract was accepted cannot be in the future.' }
    // Midday on the London clock: the day is what staff know, and midday reads as that day in
    // London and in UTC alike, on a clock-change day as on any other.
    const acceptedAt = whenLondonClockReaches(acceptedOn, '12:00')?.toISOString()
    if (!acceptedAt) return { error: 'Enter the date the contract was accepted.' }

    const admin = createAdminClient()
    const readBooking = async (): Promise<BookingContractFacts | null> => {
      const { data, error } = await admin
        .from('private_bookings')
        .select('id, status, contract_version, contract_sent_at, contract_accepted_at, contract_acceptance_method, contract_terms')
        .eq('id', bookingId)
        .maybeSingle()
      if (error) throw new Error(`Could not read the booking: ${error.message}`)
      return (data as BookingContractFacts | null) ?? null
    }
    /** Why this booking cannot take the acceptance, or null when it can. */
    const refusal = (booking: BookingContractFacts | null): string | null => {
      if (!booking) return 'Booking not found.'
      if (booking.status === 'cancelled') return 'This booking is cancelled, so its contract cannot be recorded as accepted.'
      if (!contractWasIssued(booking)) {
        return 'No contract has been produced for this booking yet. Generate or email the contract first.'
      }
      if (booking.contract_accepted_at) return alreadyAcceptedMessage(booking)
      return null
    }

    const booking = await readBooking()
    const refused = refusal(booking)
    if (refused) return { error: refused }
    const contractVersion = Number(booking?.contract_version ?? 0) || null
    // A contract issued before the terms were kept has nothing to compare a later change with.
    // The customer has now accepted it as the booking stands, so that becomes the record (BK-154).
    const termsNow = booking?.contract_terms ? null : await readContractTermsNow(admin, bookingId)

    // Only a contract that is still unaccepted, on a booking that is still going ahead, in the
    // same statement: a signature or a deposit can land between the read above and this write.
    const { data: changed, error: updateError } = await admin
      .from('private_bookings')
      .update({
        contract_accepted_at: acceptedAt,
        contract_acceptance_method: method,
        ...(termsNow ? { contract_terms: termsNow } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .is('contract_accepted_at', null)
      // Written this way because a plain "not cancelled" test also drops a booking with no status.
      .or('status.is.null,status.neq.cancelled')
      // The returned rows must carry status: PostgREST applies an .or() filter to them as well.
      .select('id, status')
    if (updateError) throw new Error(`Could not record the acceptance: ${updateError.message}`)
    if (!changed || changed.length === 0) {
      // Something else got there first. Read again and say what.
      return {
        error: refusal(await readBooking()) ?? 'The acceptance could not be recorded because the booking changed. Please try again.',
      }
    }

    const { error: auditError } = await admin.from('private_booking_audit').insert({
      booking_id: bookingId,
      action: 'contract_accepted',
      performed_by: user.id,
      metadata: { via: method, accepted_on: acceptedOn, note, contract_version: contractVersion },
    })
    if (auditError) {
      // The acceptance and its audit row belong together, and there is no transaction to put them
      // in. Without the row there is no record of who said so or where the evidence is, so the
      // acceptance is put back, matching on exactly what was written above.
      const { error: undoError } = await admin
        .from('private_bookings')
        .update({ contract_accepted_at: null, contract_acceptance_method: null, updated_at: new Date().toISOString() })
        .eq('id', bookingId)
        .eq('contract_acceptance_method', method)
        .eq('contract_accepted_at', acceptedAt)
      logger.error('Recording a contract acceptance failed at the audit row', {
        error: new Error(auditError.message),
        metadata: { bookingId, method, undone: !undoError, undoError: undoError?.message ?? null },
      })
      return {
        error: undoError
          ? 'The acceptance was saved but its record could not be written, and it could not be undone. Please tell a manager before doing anything else with this booking.'
          : 'The acceptance could not be recorded, so nothing was changed. Please try again.',
      }
    }

    // From here the acceptance stands, whatever else fails.
    try {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email ?? undefined,
        operation_type: 'update',
        resource_type: 'private_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          action: 'contract_accepted',
          via: method,
          accepted_on: acceptedOn,
          note,
          contract_version: contractVersion,
        },
      })
    } catch (error) {
      logger.error('Could not write the audit log for a recorded contract acceptance', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { bookingId, method },
      })
    }

    // The customer no longer needs the link to sign the contract online. The food agreement is
    // a separate document with its own signature, and is left alone.
    let withdrawn = 0
    let warning: string | undefined
    try {
      const { data: open, error: openError } = await admin
        .from('signing_documents')
        .select('id')
        .eq('subject_type', 'private_booking')
        .eq('subject_id', bookingId)
        .eq('kind', 'private_booking_contract')
        .in('status', [...SIGNING_OPEN_STATUSES])
      if (openError) throw new Error(`Could not read the open signing requests: ${openError.message}`)
      for (const request of (open ?? []) as Array<{ id: string }>) {
        await voidSigningDocument({
          documentId: request.id,
          userId: user.id,
          reason: STAFF_RECORDED_ACCEPTANCE_VOID_REASON[method],
        })
        withdrawn += 1
      }
    } catch (error) {
      logger.error('Could not withdraw the open contract signing request after a recorded acceptance', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { bookingId, method },
      })
      warning =
        'The acceptance was recorded, but the request to sign the contract online could not be withdrawn. Withdraw it from the Signatures panel.'
    }

    revalidatePath(`/private-bookings/${bookingId}`)
    return { success: true, data: { acceptedAt, withdrawn, ...(warning ? { warning } : {}) } }
  } catch (error) {
    return failure(error)
  }
}
