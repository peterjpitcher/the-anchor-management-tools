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

export const SIGNING_COMPLETION_HOOKS: Record<SigningKind, SigningCompletionHook> = {
  employment_agreement: recordOnly,
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
