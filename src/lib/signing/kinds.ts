import type { ActionType, ModuleName } from '@/types/rbac'
import type {
  SigningBrand,
  SigningKind,
  SigningMode,
  SigningPartyRole,
  SigningSubjectType,
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
}

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
    viewPermission: { module: 'employees', action: 'view_documents' },
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
    companySigns: false,
    source: 'generator',
    sendPermission: { module: 'private_bookings', action: 'generate_contracts' },
    viewPermission: { module: 'private_bookings', action: 'view' },
  },
  private_booking_waiver: {
    kind: 'private_booking_waiver',
    label: 'Self-catering waiver',
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
    sendPermission: { module: 'quotes', action: 'send' },
    viewPermission: { module: 'quotes', action: 'view' },
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
    sendPermission: { module: 'private_bookings', action: 'manage_vendors' },
    viewPermission: { module: 'private_bookings', action: 'view' },
  },
}

export function getSigningKind(kind: SigningKind): SigningKindDefinition {
  return SIGNING_KIND_DEFINITIONS[kind]
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
