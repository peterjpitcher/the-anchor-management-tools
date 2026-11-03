import type { ActionType, ModuleName } from '@/types/rbac'
import {
  TRAINING_CERTIFICATE_EMAIL,
  TRAINING_SIGNOFF_EMAIL,
  trainingCompletionWording,
  trainingSignoffCompanyWording,
  trainingSignoffWording,
  type SigningCompletedEmailWording,
  type SigningWordingInput,
} from './training-wording'
import {
  SIGNING_EXPIRY_DAYS,
  type SigningBrand,
  type SigningKind,
  type SigningMode,
  type SigningPartyRole,
  type SigningSubjectType,
} from './types'

/**
 * The single registry of everything that can be sent for signature.
 *
 * A new document type is a new entry here, a template (or a generator) and its tests. Nothing
 * else in the app should capture a signature, an acceptance or an acknowledgement on its own:
 * see CLAUDE.md, Domain rules. tests/guards/signing.test.ts checks every entry is complete.
 */
export interface SigningKindDefinition {
  kind: SigningKind
  /** What staff see on buttons and lists. */
  label: string
  /** `sign` asks for agreement; `acknowledge` asks them to confirm they have read it. */
  mode: SigningMode
  /** Which business the signer sees: Orange Jelly (staff, clients) or The Anchor (guests). */
  brand: SigningBrand
  subjectType: SigningSubjectType
  /** The parties who sign by link, portal or in person. The company side is separate. */
  signerRoles: readonly SigningPartyRole[]
  /** True when the business signs too. It signs as it sends, in the sender's name. */
  companySigns: boolean
  /** `generator`: built by existing code. `template`: wording from signing_templates. */
  source: 'generator' | 'template'
  /** Staff need this to send, remind and void. */
  sendPermission: { module: ModuleName; action: ActionType }
  /** Staff need this to see the status and download the signed copy. */
  viewPermission: { module: ModuleName; action: ActionType }

  // Per-kind options. Each is optional, and leaving it out keeps the behaviour every kind had
  // before training was added (SIGNING_KIND_DEFAULTS): read them through signingKindOptions().

  /** False: the daily job never sends this kind's 3 and 7 day link reminders. */
  signingReminders?: boolean
  /** False: staff cannot email a fresh link ("Send New Link"), and nor can the daily job. */
  allowSendNewLink?: boolean
  /** How long a request stays open, in days. */
  linkExpiryDays?: number
  /**
   * The words the signer agrees to, built from the stored document, in place of the standard
   * words for the mode. Returning null falls back to the standard words.
   */
  agreementWording?: (input: SigningWordingInput) => string | null
  /** The same for the business's signature, where the kind has one. */
  companyAgreementWording?: (input: SigningWordingInput) => string | null
  /** The email that carries the signed copy, in place of the standard one for the brand and mode. */
  completedEmail?: SigningCompletedEmailWording
  /**
   * Who hears "Signed:" and "Declined:" when the document has no sender because the app made it.
   * `sender` tells only a member of staff who sent it (nobody, for a system document);
   * `sender_or_manager_mailbox` tells the manager mailbox instead when there is no sender.
   */
  notifySenderOnCompletion?: 'sender' | 'sender_or_manager_mailbox'
  /**
   * Signed only in person, on a device a manager hands over: no link is made or emailed, it is
   * not listed in the staff portal's My Documents, and the portal's signing endpoints refuse it.
   */
  inPersonOnly?: boolean
}

/** The per-kind options with every default filled in. */
export interface SigningKindOptions {
  signingReminders: boolean
  allowSendNewLink: boolean
  linkExpiryDays: number
  notifySenderOnCompletion: 'sender' | 'sender_or_manager_mailbox'
  inPersonOnly: boolean
}

/** What every kind did before per-kind options existed. */
export const SIGNING_KIND_DEFAULTS: SigningKindOptions = {
  signingReminders: true,
  allowSendNewLink: true,
  linkExpiryDays: SIGNING_EXPIRY_DAYS,
  notifySenderOnCompletion: 'sender',
  inPersonOnly: false,
}

/**
 * Staff training (tasks/plan-2026-11-02-staff-training-build.md, section 4). Training chases its
 * own items on its own cadence, so signing never chases these as well, and nobody is emailed a
 * link: the learner confirms in the staff portal, or in person with a manager.
 */
const TRAINING_PERMISSIONS = {
  sendPermission: { module: 'training', action: 'manage' },
  viewPermission: { module: 'training', action: 'view' },
} as const

export const SIGNING_KIND_DEFINITIONS: Record<SigningKind, SigningKindDefinition> = {
  employment_agreement: {
    kind: 'employment_agreement',
    label: 'Worker agreement',
    mode: 'sign',
    brand: 'staff',
    subjectType: 'employee',
    signerRoles: ['worker'],
    companySigns: true,
    source: 'generator',
    sendPermission: { module: 'employees', action: 'edit' },
    viewPermission: { module: 'employees', action: 'view_documents' },
  },
  terms_variation: {
    kind: 'terms_variation',
    label: 'Change to terms',
    mode: 'sign',
    brand: 'staff',
    subjectType: 'employee',
    signerRoles: ['worker'],
    companySigns: true,
    source: 'template',
    sendPermission: { module: 'employees', action: 'edit' },
    viewPermission: { module: 'employees', action: 'view_documents' },
  },
  policy_acknowledgement: {
    kind: 'policy_acknowledgement',
    label: 'Policy acknowledgement',
    mode: 'acknowledge',
    brand: 'staff',
    subjectType: 'employee',
    signerRoles: ['worker'],
    companySigns: false,
    source: 'template',
    sendPermission: { module: 'employees', action: 'edit' },
    // A policy is the same wording for everyone, so who has confirmed it is open to anyone who
    // can see the staff list. The Policies tab sits in the employees tab row on that basis.
    viewPermission: { module: 'employees', action: 'view' },
  },
  deduction_consent: {
    kind: 'deduction_consent',
    label: 'Wage deduction consent',
    mode: 'sign',
    brand: 'staff',
    subjectType: 'employee',
    signerRoles: ['worker'],
    companySigns: false,
    source: 'template',
    sendPermission: { module: 'employees', action: 'edit' },
    viewPermission: { module: 'employees', action: 'view_documents' },
  },
  working_time_opt_out: {
    kind: 'working_time_opt_out',
    label: '48-hour week opt-out',
    mode: 'sign',
    brand: 'staff',
    subjectType: 'employee',
    signerRoles: ['worker'],
    companySigns: false,
    source: 'template',
    sendPermission: { module: 'employees', action: 'edit' },
    viewPermission: { module: 'employees', action: 'view_documents' },
  },
  guardian_consent: {
    kind: 'guardian_consent',
    label: 'Parent or guardian consent',
    mode: 'sign',
    brand: 'staff',
    subjectType: 'employee',
    signerRoles: ['guardian'],
    companySigns: false,
    source: 'template',
    sendPermission: { module: 'employees', action: 'edit' },
    viewPermission: { module: 'employees', action: 'view_documents' },
  },
  job_offer: {
    kind: 'job_offer',
    label: 'Job offer',
    mode: 'sign',
    brand: 'guest',
    subjectType: 'recruitment_application',
    signerRoles: ['candidate'],
    companySigns: false,
    source: 'template',
    sendPermission: { module: 'recruitment', action: 'edit' },
    viewPermission: { module: 'recruitment', action: 'view' },
  },
  private_booking_contract: {
    kind: 'private_booking_contract',
    label: 'Booking contract',
    mode: 'sign',
    brand: 'guest',
    subjectType: 'private_booking',
    signerRoles: ['customer'],
    // The contract has a "For The Anchor" signature block. Whoever sends it signs there as
    // they send, so a signed copy never shows one side signed and the other blank.
    companySigns: true,
    source: 'generator',
    sendPermission: { module: 'private_bookings', action: 'generate_contracts' },
    viewPermission: { module: 'private_bookings', action: 'view' },
  },
  private_booking_waiver: {
    kind: 'private_booking_waiver',
    label: 'Food agreement',
    mode: 'sign',
    brand: 'guest',
    subjectType: 'private_booking',
    signerRoles: ['customer'],
    companySigns: false,
    source: 'generator',
    sendPermission: { module: 'private_bookings', action: 'generate_contracts' },
    viewPermission: { module: 'private_bookings', action: 'view' },
  },
  quote_acceptance: {
    kind: 'quote_acceptance',
    label: 'Quote acceptance',
    mode: 'sign',
    brand: 'staff',
    subjectType: 'quote',
    signerRoles: ['client'],
    companySigns: false,
    source: 'generator',
    // Quotes are gated by the invoices permissions throughout the app; the quotes module is unused.
    sendPermission: { module: 'invoices', action: 'edit' },
    viewPermission: { module: 'invoices', action: 'view' },
  },
  client_agreement: {
    kind: 'client_agreement',
    label: 'Client agreement',
    mode: 'sign',
    brand: 'staff',
    subjectType: 'invoice_vendor',
    signerRoles: ['client'],
    companySigns: true,
    source: 'template',
    sendPermission: { module: 'oj_projects', action: 'edit' },
    viewPermission: { module: 'oj_projects', action: 'view' },
  },
  supplier_confirmation: {
    kind: 'supplier_confirmation',
    label: 'Supplier confirmation',
    mode: 'sign',
    brand: 'guest',
    subjectType: 'vendor',
    signerRoles: ['supplier'],
    companySigns: false,
    source: 'template',
    sendPermission: { module: 'private_bookings', action: 'manage' },
    viewPermission: { module: 'private_bookings', action: 'view' },
  },
  deposit_deduction_agreement: {
    kind: 'deposit_deduction_agreement',
    label: 'Deposit deduction agreement',
    mode: 'sign',
    brand: 'guest',
    subjectType: 'private_booking',
    signerRoles: ['customer'],
    // The customer agrees to a proposed deduction (SOP section 25). The General Manager still
    // decides it: signing approves nothing and moves no money.
    companySigns: false,
    source: 'template',
    // The same permissions as proposing a deduction and listing them (privateBookingWorkflow.ts).
    sendPermission: { module: 'private_bookings', action: 'manage_deposits' },
    viewPermission: { module: 'private_bookings', action: 'view' },
  },
  training_completion: {
    kind: 'training_completion',
    label: 'Training confirmation',
    // The learner confirms they have read and understood the course, once every section check
    // is passed. The document is their certificate and training record.
    mode: 'acknowledge',
    // Orange Jelly issues it; The Anchor is named as the workplace (docs/design/brief-orange-jelly.md).
    brand: 'staff',
    subjectType: 'employee',
    signerRoles: ['worker'],
    // Self-paced: no manager signs at that moment, so the record must not say one did.
    companySigns: false,
    source: 'generator',
    ...TRAINING_PERMISSIONS,
    signingReminders: false,
    allowSendNewLink: false,
    linkExpiryDays: SIGNING_EXPIRY_DAYS,
    agreementWording: trainingCompletionWording,
    completedEmail: TRAINING_CERTIFICATE_EMAIL,
    // The app makes it when the last section is passed. The owner keeps every "Signed:" notice.
    notifySenderOnCompletion: 'sender_or_manager_mailbox',
  },
  training_signoff: {
    kind: 'training_signoff',
    label: 'Practical sign-off',
    mode: 'sign',
    brand: 'staff',
    subjectType: 'employee',
    signerRoles: ['worker'],
    // The manager who watched signs as the business when they record it.
    companySigns: true,
    source: 'generator',
    ...TRAINING_PERMISSIONS,
    signingReminders: false,
    allowSendNewLink: false,
    linkExpiryDays: SIGNING_EXPIRY_DAYS,
    agreementWording: trainingSignoffWording,
    companyAgreementWording: trainingSignoffCompanyWording,
    completedEmail: TRAINING_SIGNOFF_EMAIL,
    notifySenderOnCompletion: 'sender_or_manager_mailbox',
    // The learner signs on a device in front of the manager, so the record shows them present.
    inPersonOnly: true,
  },
}

export function getSigningKind(kind: SigningKind): SigningKindDefinition {
  return SIGNING_KIND_DEFINITIONS[kind]
}

/**
 * The definition for a kind read from the database, or null for a value this code does not know.
 * For the places that must not fail on an unexpected row: options and wording then fall back to
 * the defaults.
 */
export function findSigningKind(kind: string | null | undefined): SigningKindDefinition | null {
  if (!kind || !Object.prototype.hasOwnProperty.call(SIGNING_KIND_DEFINITIONS, kind)) return null
  return SIGNING_KIND_DEFINITIONS[kind as SigningKind]
}

/** A kind's options, with the defaults for any it leaves out. */
export function signingKindOptions(kind: SigningKind | string | null | undefined): SigningKindOptions {
  const definition = findSigningKind(kind)
  return {
    signingReminders: definition?.signingReminders ?? SIGNING_KIND_DEFAULTS.signingReminders,
    allowSendNewLink: definition?.allowSendNewLink ?? SIGNING_KIND_DEFAULTS.allowSendNewLink,
    linkExpiryDays: definition?.linkExpiryDays ?? SIGNING_KIND_DEFAULTS.linkExpiryDays,
    notifySenderOnCompletion: definition?.notifySenderOnCompletion ?? SIGNING_KIND_DEFAULTS.notifySenderOnCompletion,
    inPersonOnly: definition?.inPersonOnly ?? SIGNING_KIND_DEFAULTS.inPersonOnly,
  }
}

/** True for a kind signed only in person (see `inPersonOnly`). */
export function isInPersonOnlyKind(kind: string | null | undefined): boolean {
  return signingKindOptions(kind).inPersonOnly
}

const ROLE_LABELS: Record<SigningPartyRole, string> = {
  worker: 'Worker',
  guardian: 'Parent or guardian',
  candidate: 'Candidate',
  customer: 'Customer',
  client: 'Client',
  supplier: 'Supplier',
  company: 'For the business',
}

export function signingRoleLabel(role: SigningPartyRole): string {
  return ROLE_LABELS[role]
}
