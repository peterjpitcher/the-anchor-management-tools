import { createAdminClient } from '@/lib/supabase/admin'
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
      // A timestamp, as the hand-ticked path in EmployeeService writes it.
      employee_agreement_accepted_date: new Date().toISOString(),
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
  const content = `Written offer accepted${signer?.typed_name ? ` by ${signer.typed_name}` : ''} (signed online). The signed copy is on the application.`

  // The insert is this hook's only write, so a retry after a failure cannot double it.
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

/** Mark a booking's waiver signed, with an audit row, unless it already is. */
async function markWaiverSigned(admin: AdminClient, document: SigningDocumentRow): Promise<void> {
  const { data: changed, error } = await admin
    .from('private_bookings')
    .update({ waiver_status: 'signed', updated_at: new Date().toISOString() })
    .eq('id', document.subject_id)
    .neq('waiver_status', 'signed')
    .select('id')
  if (error) throw new Error(`Could not mark the waiver signed: ${error.message}`)
  if (!changed || changed.length === 0) return

  const { error: auditError } = await admin.from('private_booking_audit').insert({
    booking_id: document.subject_id,
    action: 'field_updated',
    field_name: 'waiver_status',
    new_value: 'signed',
    performed_by: null,
    metadata: { via: 'e_signature', signing_document_id: document.id },
  })
  if (auditError) throw new Error(`Could not record the signed waiver: ${auditError.message}`)
}

/**
 * A signed contract is an accepted contract. Paying the deposit also accepts it and may have
 * done so first, in which case that earlier acceptance is left as it stands. A contract sent
 * with the self-catering agreement on its last page signs that too.
 */
const acceptBookingContract: SigningCompletionHook = async (document) => {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data: accepted, error } = await admin
    .from('private_bookings')
    .update({ contract_accepted_at: now, contract_acceptance_method: 'e_signature', updated_at: now })
    .eq('id', document.subject_id)
    .is('contract_accepted_at', null)
    .select('id')
  if (error) throw new Error(`Could not mark the contract accepted: ${error.message}`)

  if (accepted && accepted.length > 0) {
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
    if (auditError) throw new Error(`Could not record the accepted contract: ${auditError.message}`)
  }

  if (document.context.includes_waiver === true) {
    await markWaiverSigned(admin, document)
  }
}

const signBookingWaiver: SigningCompletionHook = async (document) => {
  await markWaiverSigned(createAdminClient(), document)
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
  quote_acceptance: recordOnly,
  client_agreement: recordOnly,
  supplier_confirmation: recordOnly,
}

export async function runCompletionHook(document: SigningDocumentRow, parties: SigningPartyRow[]): Promise<void> {
  await SIGNING_COMPLETION_HOOKS[document.kind](document, parties)
}
