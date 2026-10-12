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

export const SIGNING_COMPLETION_HOOKS: Record<SigningKind, SigningCompletionHook> = {
  employment_agreement: tickAgreementAccepted,
  terms_variation: recordOnly,
  policy_acknowledgement: recordOnly,
  deduction_consent: recordOnly,
  working_time_opt_out: recordOnly,
  guardian_consent: recordOnly,
  job_offer: recordOnly,
  private_booking_contract: recordOnly,
  private_booking_waiver: recordOnly,
  quote_acceptance: recordOnly,
  client_agreement: recordOnly,
  supplier_confirmation: recordOnly,
}

export async function runCompletionHook(document: SigningDocumentRow, parties: SigningPartyRow[]): Promise<void> {
  await SIGNING_COMPLETION_HOOKS[document.kind](document, parties)
}
