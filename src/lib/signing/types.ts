/**
 * Shared types for document signing. The lists here mirror the CHECK constraints in
 * supabase/migrations/20261012120000_document_signing_foundation.sql; the guard test
 * tests/guards/signing.test.ts fails if the two drift apart.
 */

export const SIGNING_KINDS = [
  'employment_agreement',
  'terms_variation',
  'policy_acknowledgement',
  'deduction_consent',
  'working_time_opt_out',
  'guardian_consent',
  'job_offer',
  'private_booking_contract',
  'private_booking_waiver',
  'quote_acceptance',
  'client_agreement',
  'supplier_confirmation',
] as const
export type SigningKind = (typeof SIGNING_KINDS)[number]

export const SIGNING_MODES = ['sign', 'acknowledge'] as const
export type SigningMode = (typeof SIGNING_MODES)[number]

export const SIGNING_BRANDS = ['staff', 'guest'] as const
export type SigningBrand = (typeof SIGNING_BRANDS)[number]

export const SIGNING_SUBJECT_TYPES = [
  'employee',
  'private_booking',
  'quote',
  'recruitment_application',
  'invoice_vendor',
  'vendor',
] as const
export type SigningSubjectType = (typeof SIGNING_SUBJECT_TYPES)[number]

export const SIGNING_DOCUMENT_STATUSES = [
  'sent',
  'part_signed',
  'completed',
  'declined',
  'voided',
  'expired',
  'superseded',
] as const
export type SigningDocumentStatus = (typeof SIGNING_DOCUMENT_STATUSES)[number]

/** A document in one of these states can still be signed. */
export const SIGNING_OPEN_STATUSES: readonly SigningDocumentStatus[] = ['sent', 'part_signed']

export const SIGNING_PARTY_ROLES = [
  'worker',
  'guardian',
  'candidate',
  'customer',
  'client',
  'supplier',
  'company',
] as const
export type SigningPartyRole = (typeof SIGNING_PARTY_ROLES)[number]

export const SIGNING_PARTY_STATUSES = ['pending', 'signed', 'declined'] as const
export type SigningPartyStatus = (typeof SIGNING_PARTY_STATUSES)[number]

export const SIGNING_METHODS = ['link', 'portal', 'in_person', 'sender'] as const
export type SigningMethod = (typeof SIGNING_METHODS)[number]

export const SIGNING_IDENTITY_CHECKS = ['none', 'date_of_birth'] as const
export type SigningIdentityCheck = (typeof SIGNING_IDENTITY_CHECKS)[number]

export const SIGNING_EVENTS = [
  'created',
  'sent',
  'opened',
  'document_viewed',
  'identity_check_passed',
  'identity_check_failed',
  'signed',
  'declined',
  'completed',
  'finalised',
  'reminded',
  'resent',
  'voided',
  'superseded',
  'expired',
  'downloaded',
] as const
export type SigningEventName = (typeof SIGNING_EVENTS)[number]

/** The kinds whose wording lives in signing_templates rather than in a code generator. */
export const SIGNING_TEMPLATE_KINDS = [
  'terms_variation',
  'policy_acknowledgement',
  'deduction_consent',
  'working_time_opt_out',
  'guardian_consent',
  'job_offer',
  'client_agreement',
  'supplier_confirmation',
] as const satisfies readonly SigningKind[]
export type SigningTemplateKind = (typeof SIGNING_TEMPLATE_KINDS)[number]

export const SIGNED_DOCUMENTS_BUCKET = 'signed-documents'

/** A request stays open this long (owner decision, 12 October 2026). */
export const SIGNING_EXPIRY_DAYS = 30
/** Days after sending on which an unsigned party is reminded (owner decision, 12 October 2026). */
export const SIGNING_REMINDER_DAYS = [3, 7] as const

export interface SigningDocumentRow {
  id: string
  kind: SigningKind
  mode: SigningMode
  brand: SigningBrand
  title: string
  summary: string | null
  subject_type: SigningSubjectType
  subject_id: string
  series_key: string
  version: number
  template_id: string | null
  template_version: number | null
  context: Record<string, unknown>
  status: SigningDocumentStatus
  source_pdf_path: string
  source_sha256: string
  final_pdf_path: string | null
  final_sha256: string | null
  supersedes_id: string | null
  expires_at: string
  sent_at: string
  completed_at: string | null
  completion_applied_at: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SigningPartyRow {
  id: string
  document_id: string
  role: SigningPartyRole
  name: string
  email: string | null
  phone: string | null
  employee_id: string | null
  customer_id: string | null
  hashed_token: string | null
  token_expires_at: string | null
  identity_check: SigningIdentityCheck
  identity_check_failures: number
  identity_checked_at: string | null
  status: SigningPartyStatus
  first_opened_at: string | null
  document_viewed_at: string | null
  last_reminded_at: string | null
  reminder_count: number
  method: SigningMethod | null
  typed_name: string | null
  agreed_text: string | null
  signed_at: string | null
  signed_ip: string | null
  signed_user_agent: string | null
  signed_city: string | null
  signed_region: string | null
  signed_country: string | null
  auth_user_id: string | null
  witnessed_by: string | null
  declined_at: string | null
  decline_reason: string | null
  created_at: string
  updated_at: string
}

export interface SigningEventRow {
  id: string
  document_id: string
  party_id: string | null
  event: SigningEventName
  occurred_at: string
  actor_user_id: string | null
  ip: string | null
  user_agent: string | null
  city: string | null
  region: string | null
  country: string | null
  meta: Record<string, unknown>
}

export interface SigningTemplateRow {
  id: string
  kind: SigningTemplateKind
  slug: string
  title: string
  body: string
  version: number
  is_active: boolean
  activated_at: string | null
  activated_by: string | null
  created_at: string
  updated_at: string
  updated_by: string | null
}

/** What we know about the request a signer made, captured without asking them for anything. */
export interface SigningEvidence {
  ip: string | null
  userAgent: string | null
  city: string | null
  region: string | null
  country: string | null
}
