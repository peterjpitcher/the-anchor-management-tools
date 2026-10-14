import { formatDateInLondon } from '@/lib/dateUtils'

/**
 * The ways a private booking contract is accepted. The contract itself says it can be accepted
 * "by signing below, paying the deposit, or otherwise confirming the booking in writing".
 *
 * Signing online and paying the deposit are recorded by the system as they happen. The other two
 * are recorded by staff, through recordContractAcceptedAnotherWay and in no other way, with a
 * note of where the paper or the written confirmation is kept (owner decision, 13 October 2026).
 */
export const STAFF_RECORDED_ACCEPTANCE_METHODS = ['signed_paper', 'written_confirmation'] as const

export type StaffRecordedAcceptanceMethod = (typeof STAFF_RECORDED_ACCEPTANCE_METHODS)[number]

export function isStaffRecordedAcceptance(method: unknown): method is StaffRecordedAcceptanceMethod {
  return typeof method === 'string' && (STAFF_RECORDED_ACCEPTANCE_METHODS as readonly string[]).includes(method)
}

/** The name of each choice, as staff see it. */
export const STAFF_RECORDED_ACCEPTANCE_CHOICE_NAMES: Record<StaffRecordedAcceptanceMethod, string> = {
  signed_paper: 'Signed on Paper',
  written_confirmation: 'Confirmed in Writing',
}

/** Why an open request for the contract is withdrawn once staff record the acceptance. */
export const STAFF_RECORDED_ACCEPTANCE_VOID_REASON: Record<StaffRecordedAcceptanceMethod, string> = {
  signed_paper: 'The contract was signed on paper',
  written_confirmation: 'The contract was confirmed in writing',
}

const HOW: Record<string, string> = {
  e_signature: 'Signed online',
  deposit_payment: 'Accepted by paying the deposit',
  signed_paper: 'Signed on paper',
  written_confirmation: 'Confirmed in writing',
}

/**
 * How and when a contract was accepted, in plain words: "Signed on paper on 9 October 2026".
 * A method this does not know (an older row, say) is still reported as accepted, with its date.
 */
export function describeContractAcceptance(method: string | null | undefined, acceptedAt: string | null | undefined): string {
  const how = (method ? HOW[method] : undefined) ?? 'Accepted'
  if (!acceptedAt) return how
  return `${how} on ${formatDateInLondon(acceptedAt, { day: 'numeric', month: 'long', year: 'numeric' })}`
}
