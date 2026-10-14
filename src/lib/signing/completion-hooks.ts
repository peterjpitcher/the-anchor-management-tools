import { formatDateInLondon } from '@/lib/dateUtils'
import { createAdminClient } from '@/lib/supabase/admin'
import { quoteContentFingerprint, type QuoteContentForFingerprint } from './documents/quote-fingerprint'
import type { SigningDocumentRow, SigningKind, SigningPartyRow } from './types'

/**
 * What happens to the record a document belongs to once everyone has signed: the booking is
 * marked accepted, the quote is marked accepted, the onboarding checklist is ticked, and so on.
 *
 * Every kind has an entry, even where there is nothing to update, so that adding a kind without
 * deciding what its completion means is a type error and a failing guard test, not a silent gap.
 *
 * A hook must be safe to run twice. finaliseSigningDocument runs it once in normal use, but a
 * hook that throws is retried, and the first attempt may have got part of the way.
 */
export type SigningCompletionHook = (document: SigningDocumentRow, parties: SigningPartyRow[]) => Promise<void>

/** The signed copy on the record is the whole outcome; no other record changes. */
const recordOnly: SigningCompletionHook = async () => {}

/**
 * The worker agreement is on the new-starter checklist. Tick "agreement accepted" with the date
 * it was signed, so the checklist does not wait for somebody to tick it by hand.
 */
const tickAgreementAccepted: SigningCompletionHook = async (document) => {
  const admin = createAdminClient()
  const { error } = await admin.from('employee_onboarding_checklist').upsert(
    {
      employee_id: document.subject_id,
      employee_agreement_accepted: true,
      // A timestamp, as the hand-ticked path in EmployeeService writes it. It is when the
      // agreement was signed, not when this ran: a retry days later must not move the date.
      employee_agreement_accepted_date: document.completed_at ?? new Date().toISOString(),
    },
    { onConflict: 'employee_id' }
  )
  if (error) throw new Error(`Could not tick the onboarding checklist: ${error.message}`)
}

/**
 * An accepted offer is noted on the candidate's trail. It does not move the application on:
 * hiring is still a decision staff take, with Create Employee Invite.
 */
const noteOfferAccepted: SigningCompletionHook = async (document, parties) => {
  const admin = createAdminClient()
  const candidateId = typeof document.context.candidate_id === 'string' ? document.context.candidate_id : null
  if (!candidateId) return
  const signer = parties.find((party) => party.role === 'candidate')
  const content = `Written offer accepted${signer?.typed_name ? ` by ${signer.typed_name}` : ''} (signed online, reference ${document.id.slice(0, 8)}). The signed copy is on the application.`

  // Safe to run twice: the note names the document, and is only written if it is not there yet.
  const { data: existing, error: readError } = await admin
    .from('recruitment_candidate_notes')
    .select('id')
    .eq('application_id', document.subject_id)
    .eq('content', content)
    .limit(1)
  if (readError) throw new Error(`Could not read the candidate's notes: ${readError.message}`)
  if (existing && existing.length > 0) return

  const { error } = await admin.from('recruitment_candidate_notes').insert({
    candidate_id: candidateId,
    application_id: document.subject_id,
    content,
    kind: 'note',
    created_by: null,
    created_by_email: 'Document signing',
  })
  if (error) throw new Error(`Could not note the accepted offer: ${error.message}`)
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Mark a booking's waiver signed, with an audit row, unless it already is.
 *
 * A cancelled booking is left alone: a signature can arrive in the moment a booking is being
 * cancelled, or this can run late, and neither should write to a booking that is over.
 *
 * The change and its audit row belong together, and there is no transaction to put them in. So
 * if the audit row cannot be written the change is put back and this throws: the retry then does
 * both, where otherwise it would find the waiver already signed and never record how.
 */
async function markWaiverSigned(admin: AdminClient, document: SigningDocumentRow): Promise<void> {
  // Read the status, then change exactly that status to signed. If a contract send or a booking
  // save moved it in between, read again: the audit row and the undo below must name the status
  // that was really overwritten, and the signature must not be lost to a missed write.
  let before: string | null = null
  for (let attempt = 0; attempt < 3 && before === null; attempt += 1) {
    const { data: booking, error: readError } = await admin
      .from('private_bookings')
      .select('status, waiver_status')
      .eq('id', document.subject_id)
      .maybeSingle()
    if (readError) throw new Error(`Could not read the booking: ${readError.message}`)
    if (!booking || booking.status === 'cancelled' || booking.waiver_status === 'signed') return
    const read = (booking.waiver_status as string | null) ?? 'not_required'

    const { data: changed, error } = await admin
      .from('private_bookings')
      .update({ waiver_status: 'signed', updated_at: new Date().toISOString() })
      .eq('id', document.subject_id)
      .eq('waiver_status', read)
      // Written this way because a plain "not cancelled" test also drops a booking with no status.
      .or('status.is.null,status.neq.cancelled')
      // The returned rows must carry status: PostgREST applies an .or() filter to them as well.
      .select('id, status')
    if (error) throw new Error(`Could not mark the waiver signed: ${error.message}`)
    if (changed && changed.length > 0) before = read
  }
  if (before === null) {
    // It moved three times in a row. Fail, so the finishing step runs this again.
    throw new Error('Could not mark the waiver signed: its status kept changing')
  }

  const { error: auditError } = await admin.from('private_booking_audit').insert({
    booking_id: document.subject_id,
    action: 'field_updated',
    field_name: 'waiver_status',
    old_value: before,
    new_value: 'signed',
    performed_by: null,
    metadata: { via: 'e_signature', signing_document_id: document.id },
  })
  if (auditError) {
    const { error: undoError } = await admin
      .from('private_bookings')
      .update({ waiver_status: before, updated_at: new Date().toISOString() })
      .eq('id', document.subject_id)
      .eq('waiver_status', 'signed')
    throw new Error(
      `Could not record the signed waiver: ${auditError.message}${undoError ? ` (and the change could not be put back: ${undoError.message})` : ''}`
    )
  }
}

/**
 * A signed contract is an accepted contract. Paying the deposit also accepts it and may have
 * done so first, in which case that earlier acceptance is left as it stands. The self-catering
 * and outside food agreement is a separate document with its own signature, and is marked
 * signed by its own hook below, never by this one.
 */
const acceptBookingContract: SigningCompletionHook = async (document) => {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  // Accepted when it was signed, not when this ran: a retry days later must not move the time.
  const acceptedAt = document.completed_at ?? now
  // Only the contract version that was signed is accepted. A newer version withdraws the older
  // request when it is sent, so a mismatch should not happen; if it does, the booking is left
  // alone rather than marked as accepting terms the customer never saw.
  // A cancelled booking is left alone too: a signature can arrive in the moment a booking is
  // being cancelled, or this can run late, and a cancelled booking must not gain an acceptance.
  let update = admin
    .from('private_bookings')
    .update({ contract_accepted_at: acceptedAt, contract_acceptance_method: 'e_signature', updated_at: now })
    .eq('id', document.subject_id)
    .is('contract_accepted_at', null)
    // Written this way because a plain "not cancelled" test also drops a booking with no status.
    .or('status.is.null,status.neq.cancelled')
  if (typeof document.context.contract_version === 'number') {
    update = update.eq('contract_version', document.context.contract_version)
  }
  // The returned rows must carry status: PostgREST applies an .or() filter to them as well.
  const { data: accepted, error } = await update.select('id, status')
  if (error) throw new Error(`Could not mark the contract accepted: ${error.message}`)
  if (!accepted || accepted.length === 0) return

  const { error: auditError } = await admin.from('private_booking_audit').insert({
    booking_id: document.subject_id,
    action: 'contract_accepted',
    performed_by: null,
    metadata: {
      via: 'e_signature',
      signing_document_id: document.id,
      contract_version: document.context.contract_version ?? null,
    },
  })
  if (auditError) {
    // The acceptance and its audit row belong together, and there is no transaction to put them
    // in. Put the acceptance back and fail, so the retry does both: otherwise it would find the
    // contract already accepted and never record how.
    const { error: undoError } = await admin
      .from('private_bookings')
      .update({ contract_accepted_at: null, contract_acceptance_method: null, updated_at: new Date().toISOString() })
      .eq('id', document.subject_id)
      .eq('contract_acceptance_method', 'e_signature')
      .eq('contract_accepted_at', acceptedAt)
    throw new Error(
      `Could not record the accepted contract: ${auditError.message}${undoError ? ` (and the acceptance could not be put back: ${undoError.message})` : ''}`
    )
  }
}

const signBookingWaiver: SigningCompletionHook = async (document) => {
  await markWaiverSigned(createAdminClient(), document)
}

/**
 * A signed quote is an accepted quote. Only a draft or sent quote moves: one that has since been
 * rejected, converted or edited by staff is left as staff set it.
 */
const acceptQuote: SigningCompletionHook = async (document) => {
  const admin = createAdminClient()
  // The client accepted the quote they were shown. If its lines, notes, dates or figures have
  // changed since, this is no longer that quote, and it is left for staff to send again.
  if (typeof document.context.quote_fingerprint === 'string') {
    const { data: current, error: readError } = await admin
      .from('quotes')
      .select(
        'quote_number, quote_date, valid_until, reference, notes, vendor_id, quote_discount_percentage, subtotal_amount, discount_amount, vat_amount, total_amount, line_items:quote_line_items(description, quantity, unit_price, discount_percentage, vat_rate, total_amount)'
      )
      .eq('id', document.subject_id)
      .maybeSingle()
    if (readError) throw new Error(`Could not read the quote: ${readError.message}`)
    if (!current) return
    if (quoteContentFingerprint(current as QuoteContentForFingerprint) !== document.context.quote_fingerprint) return
  }
  let update = admin
    .from('quotes')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', document.subject_id)
    .in('status', ['draft', 'sent'])
  // A quote edited after it was sent for acceptance is not the quote the client signed. Its
  // total is the check: if it has moved, the quote is left as it is for staff to resend.
  if (typeof document.context.total_amount === 'number') {
    update = update.eq('total_amount', document.context.total_amount)
  }
  const { error } = await update
  if (error) throw new Error(`Could not mark the quote accepted: ${error.message}`)
}

/** The statuses a deduction can be in while the customer's agreement still means something. */
const OPEN_DEDUCTION_STATUSES = ['proposed', 'discussed']

/**
 * The line a signed deduction agreement leaves on the deduction, dated on the London calendar by
 * when it was signed. It names the document, which is what makes the hook safe to run twice.
 */
export function deductionAgreedNote(document: Pick<SigningDocumentRow, 'id' | 'completed_at'>, now: Date = new Date()): string {
  const signedOn = formatDateInLondon(document.completed_at ?? now, { day: 'numeric', month: 'long', year: 'numeric' })
  return `Agreed by the customer online on ${signedOn} (signing reference ${document.id.slice(0, 8).toUpperCase()})`
}

/**
 * A signed deposit deduction agreement is the customer's side of the conversation, recorded: the
 * deduction moves to Discussed with a line saying they agreed online. It is never approved or
 * applied here, and no money moves: the General Manager still decides (SOP section 25).
 *
 * Only a deduction that is still Proposed or Discussed is touched, and the write names the status
 * it read, so a decision made in the same moment is never overwritten. The change and its audit
 * row belong together, as for a contract: if the audit row cannot be written the change is put
 * back and this throws, so the retry does both.
 */
const noteDeductionAgreed: SigningCompletionHook = async (document) => {
  const deductionId = typeof document.context.deduction_id === 'string' ? document.context.deduction_id : null
  if (!deductionId) return
  const admin = createAdminClient()
  const line = deductionAgreedNote(document)

  let before: { status: string; note: string | null; bookingId: string } | null = null
  let written = ''
  for (let attempt = 0; attempt < 3 && before === null; attempt += 1) {
    const { data: deduction, error: readError } = await admin
      .from('private_booking_deductions')
      .select('booking_id, status, customer_discussion_note')
      .eq('id', deductionId)
      .maybeSingle()
    if (readError) throw new Error(`Could not read the deduction: ${readError.message}`)
    // Gone, or already approved, rejected or applied: the decision stands as staff made it.
    if (!deduction || !OPEN_DEDUCTION_STATUSES.includes(deduction.status as string)) return
    const note = ((deduction.customer_discussion_note as string | null) ?? '').trim() || null
    // Already recorded by an earlier run of this hook.
    if (note?.includes(line)) return

    // Any note staff typed stays, with the agreement on its own line beneath it.
    written = note ? `${note}\n${line}` : line
    let update = admin
      .from('private_booking_deductions')
      .update({ status: 'discussed', customer_discussion_note: written, updated_at: new Date().toISOString() })
      .eq('id', deductionId)
      .eq('status', deduction.status as string)
    // The note as it was read, too, so a note staff save in the same moment is not lost.
    update =
      deduction.customer_discussion_note === null || deduction.customer_discussion_note === undefined
        ? update.is('customer_discussion_note', null)
        : update.eq('customer_discussion_note', deduction.customer_discussion_note as string)
    const { data: changed, error } = await update.select('id')
    if (error) throw new Error(`Could not record the customer's agreement on the deduction: ${error.message}`)
    if (changed && changed.length > 0) {
      before = {
        status: deduction.status as string,
        note: (deduction.customer_discussion_note as string | null) ?? null,
        bookingId: deduction.booking_id as string,
      }
    }
  }
  if (before === null) {
    // It moved three times in a row. Fail, so the finishing step runs this again.
    throw new Error("Could not record the customer's agreement on the deduction: it kept changing")
  }

  const { error: auditError } = await admin.from('private_booking_audit').insert({
    booking_id: before.bookingId,
    action: 'field_updated',
    field_name: 'deduction_status',
    old_value: before.status,
    new_value: 'discussed',
    performed_by: null,
    metadata: { via: 'e_signature', signing_document_id: document.id, deduction_id: deductionId },
  })
  if (auditError) {
    // Put back exactly what this wrote, and only if it is still there.
    const { error: undoError } = await admin
      .from('private_booking_deductions')
      .update({ status: before.status, customer_discussion_note: before.note, updated_at: new Date().toISOString() })
      .eq('id', deductionId)
      .eq('status', 'discussed')
      .eq('customer_discussion_note', written)
    throw new Error(
      `Could not record the customer's agreement on the deduction: ${auditError.message}${undoError ? ` (and the change could not be put back: ${undoError.message})` : ''}`
    )
  }
}

export const SIGNING_COMPLETION_HOOKS: Record<SigningKind, SigningCompletionHook> = {
  employment_agreement: tickAgreementAccepted,
  terms_variation: recordOnly,
  policy_acknowledgement: recordOnly,
  deduction_consent: recordOnly,
  working_time_opt_out: recordOnly,
  guardian_consent: recordOnly,
  job_offer: noteOfferAccepted,
  private_booking_contract: acceptBookingContract,
  private_booking_waiver: signBookingWaiver,
  quote_acceptance: acceptQuote,
  client_agreement: recordOnly,
  supplier_confirmation: recordOnly,
  deposit_deduction_agreement: noteDeductionAgreed,
}

export async function runCompletionHook(document: SigningDocumentRow, parties: SigningPartyRow[]): Promise<void> {
  await SIGNING_COMPLETION_HOOKS[document.kind](document, parties)
}
