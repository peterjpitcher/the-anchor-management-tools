import type { SigningTemplateKind } from './types'

/**
 * The merge fields each template kind is given when it is sent. A template may use any of its
 * kind's fields and no others: the settings page refuses to save a field that is not listed,
 * because a field nobody fills in would stop the document being sent.
 *
 * Adding a field means adding it here and supplying it in that kind's send action.
 */
export const TEMPLATE_MERGE_FIELDS: Record<SigningTemplateKind, readonly string[]> = {
  terms_variation: ['worker_name', 'change_summary', 'effective_date', 'manager_name', 'date_today'],
  policy_acknowledgement: ['worker_name', 'manager_name', 'date_today'],
  deduction_consent: ['worker_name', 'deduction_details', 'manager_name', 'date_today'],
  working_time_opt_out: ['worker_name', 'manager_name', 'date_today'],
  guardian_consent: ['worker_name', 'guardian_name', 'manager_name', 'date_today'],
  job_offer: ['candidate_name', 'job_title', 'start_date', 'pay_details', 'manager_name', 'date_today'],
  client_agreement: ['client_name', 'services_summary', 'fees_summary', 'start_date', 'manager_name', 'date_today'],
  supplier_confirmation: ['supplier_name', 'service_summary', 'event_date', 'fee_summary', 'manager_name', 'date_today'],
  deposit_deduction_agreement: [
    'customer_name',
    'event_label',
    'deduction_amount',
    'deposit_amount',
    'deduction_reason',
    'amount_to_return',
    'manager_name',
    'date_today',
  ],
}

/** The single template each non-policy kind uses. Policies have one template per policy. */
export const SINGLE_TEMPLATE_SLUGS: Record<Exclude<SigningTemplateKind, 'policy_acknowledgement'>, string> = {
  terms_variation: 'terms-variation',
  deduction_consent: 'deduction-consent',
  working_time_opt_out: 'working-time-opt-out',
  guardian_consent: 'guardian-consent',
  job_offer: 'job-offer',
  client_agreement: 'client-agreement',
  supplier_confirmation: 'supplier-confirmation',
  deposit_deduction_agreement: 'deposit-deduction-agreement',
}

/** Merge fields used that this kind is never given, in the order they appear. */
export function unknownMergeFields(kind: SigningTemplateKind, fieldsUsed: readonly string[]): string[] {
  const allowed = new Set(TEMPLATE_MERGE_FIELDS[kind])
  return fieldsUsed.filter((field) => !allowed.has(field))
}
