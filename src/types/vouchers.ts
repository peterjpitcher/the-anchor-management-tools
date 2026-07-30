// Voucher system domain types (spec: tasks/voucher-system-spec-2026-07-30.md, sections 2.1-2.7 and 4)
// DB rows are snake_case, domain types are camelCase, mapped manually (no fromDb helper in this repo).

export type VoucherStatus =
  | 'generated'
  | 'issued'
  | 'redeemed'
  | 'expired'
  | 'cancelled'
  | 'replaced'

export type VoucherEventAction =
  | 'generated'
  | 'issued'
  | 'redeemed'
  | 'undo_redeem'
  | 'expired'
  | 'cancelled'
  | 'replaced'
  | 'reprinted'
  | 'customer_assigned'
  | 'customer_removed'
  | 'reminder_sent'
  | 'edited'
  | 'override_redeemed'
  | 'note'

export type VoucherEventSource = 'management' | 'foh' | 'cron' | 'system'

export type ReminderKind = 'day30' | 'day90' | 'pre_expiry'

export type ReminderStatus = 'pending' | 'sent' | 'skipped' | 'failed' | 'cancelled'

export type BatchPdfStatus = 'pending' | 'rendering' | 'ready' | 'failed'

// Machine error codes returned by voucher RPCs and the FOH API family
// (spec section 4, F32, plus the RPC codes from migration 20260802000002)
export type VoucherErrorCode =
  | 'ALREADY_REDEEMED'
  | 'EXPIRED'
  | 'NOT_ISSUED'
  | 'CANCELLED'
  | 'REPLACED'
  | 'NOT_FOUND'
  | 'UNDO_WINDOW_CLOSED'
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'RENDER_FAILED'
  | 'ALREADY_ISSUED'
  | 'NOT_REDEEMED'
  | 'NOT_EXPIRED'
  | 'BATCH_NOT_READY'
  | 'REPLACEMENT_NOT_AVAILABLE'
  | 'NOT_PENDING'

// Age buckets, mutually exclusive, in completed London days (spec 2.6, F39)
export type VoucherAgeBucket = '0-30' | '31-90' | '91-180' | '181+'

// Ordered clause pair stored in terms_versions.clauses (spec 2.2)
export interface TermsClause {
  heading: string
  body: string
}

// ---------------------------------------------------------------------------
// Row types (snake_case, exactly as stored in Supabase)
// ---------------------------------------------------------------------------

export interface VoucherTypeRow {
  id: string
  display_title: string
  cover_title: string
  value_pence: number | null
  requires_booking: boolean
  alcohol: boolean
  entitlement_html: string
  hero: Record<string, unknown> | null
  copy: Record<string, unknown> | null
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface TermsVersionRow {
  version: string
  effective_from: string
  clauses: TermsClause[]
  published_by: string | null
  created_at: string
}

export interface VoucherBatchRow {
  id: string
  created_at: string
  created_by: string | null
  created_by_name: string
  note: string | null
  terms_version: string
  type_definitions: Record<string, unknown>
  total_count: number
  pdf_status: BatchPdfStatus
  pdf_path: string | null
  pdf_bytes: number | null
  pdf_pages: number | null
  render_attempts: number
  render_error: string | null
  updated_at: string
}

export interface VoucherRow {
  id: string
  voucher_number: string
  type_id: string
  batch_id: string
  status: VoucherStatus
  value_pence: number | null
  terms_version: string
  issued_at: string | null
  issued_by: string | null
  issued_by_name: string | null
  issued_by_user_id: string | null
  event_id: string | null
  won_at_label: string | null
  expiry_date: string | null
  customer_id: string | null
  redeemed_at: string | null
  redeemed_by: string | null
  redeemed_by_name: string | null
  redeemed_by_user_id: string | null
  transaction_ref: string | null
  booking_ref: string | null
  cancelled_at: string | null
  cancelled_reason: string | null
  replaced_by_id: string | null
  replaces_id: string | null
  created_at: string
  updated_at: string
}

export interface VoucherEventRow {
  id: string
  voucher_id: string
  action: VoucherEventAction
  actor_user_id: string | null
  actor_employee_id: string | null
  actor_name: string
  source: VoucherEventSource
  at: string
  detail: Record<string, unknown> | null
}

export interface VoucherReminderRow {
  id: string
  voucher_id: string
  customer_id: string | null
  reminder_kind: ReminderKind
  status: ReminderStatus
  scheduled_for: string
  sent_at: string | null
  message_sid: string | null
  attempts: number
  last_error: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Domain types (camelCase)
// ---------------------------------------------------------------------------

export interface VoucherType {
  id: string
  displayTitle: string
  coverTitle: string
  valuePence: number | null
  requiresBooking: boolean
  alcohol: boolean
  entitlementHtml: string
  hero: Record<string, unknown> | null
  copy: Record<string, unknown> | null
  sortOrder: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface TermsVersion {
  version: string
  effectiveFrom: string
  clauses: TermsClause[]
  publishedBy: string | null
  createdAt: string
}

export interface VoucherBatch {
  id: string
  createdAt: string
  createdBy: string | null
  createdByName: string
  note: string | null
  termsVersion: string
  typeDefinitions: Record<string, unknown>
  totalCount: number
  pdfStatus: BatchPdfStatus
  pdfPath: string | null
  pdfBytes: number | null
  pdfPages: number | null
  renderAttempts: number
  renderError: string | null
  updatedAt: string
}

export interface Voucher {
  id: string
  voucherNumber: string
  typeId: string
  batchId: string
  status: VoucherStatus
  valuePence: number | null
  termsVersion: string
  issuedAt: string | null
  issuedBy: string | null
  issuedByName: string | null
  issuedByUserId: string | null
  eventId: string | null
  wonAtLabel: string | null
  expiryDate: string | null
  customerId: string | null
  redeemedAt: string | null
  redeemedBy: string | null
  redeemedByName: string | null
  redeemedByUserId: string | null
  transactionRef: string | null
  bookingRef: string | null
  cancelledAt: string | null
  cancelledReason: string | null
  replacedById: string | null
  replacesId: string | null
  createdAt: string
  updatedAt: string
}

export interface VoucherEvent {
  id: string
  voucherId: string
  action: VoucherEventAction
  actorUserId: string | null
  actorEmployeeId: string | null
  actorName: string
  source: VoucherEventSource
  at: string
  detail: Record<string, unknown> | null
}

export interface VoucherReminder {
  id: string
  voucherId: string
  customerId: string | null
  reminderKind: ReminderKind
  status: ReminderStatus
  scheduledFor: string
  sentAt: string | null
  messageSid: string | null
  attempts: number
  lastError: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Row to domain mappers (manual field-by-field, repo convention)
// ---------------------------------------------------------------------------

export function mapVoucherTypeRow(row: VoucherTypeRow): VoucherType {
  return {
    id: row.id,
    displayTitle: row.display_title,
    coverTitle: row.cover_title,
    valuePence: row.value_pence,
    requiresBooking: row.requires_booking,
    alcohol: row.alcohol,
    entitlementHtml: row.entitlement_html,
    hero: row.hero,
    copy: row.copy,
    sortOrder: row.sort_order,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapTermsVersionRow(row: TermsVersionRow): TermsVersion {
  return {
    version: row.version,
    effectiveFrom: row.effective_from,
    clauses: row.clauses,
    publishedBy: row.published_by,
    createdAt: row.created_at,
  }
}

export function mapVoucherBatchRow(row: VoucherBatchRow): VoucherBatch {
  return {
    id: row.id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    note: row.note,
    termsVersion: row.terms_version,
    typeDefinitions: row.type_definitions,
    totalCount: row.total_count,
    pdfStatus: row.pdf_status,
    pdfPath: row.pdf_path,
    pdfBytes: row.pdf_bytes,
    pdfPages: row.pdf_pages,
    renderAttempts: row.render_attempts,
    renderError: row.render_error,
    updatedAt: row.updated_at,
  }
}

export function mapVoucherRow(row: VoucherRow): Voucher {
  return {
    id: row.id,
    voucherNumber: row.voucher_number,
    typeId: row.type_id,
    batchId: row.batch_id,
    status: row.status,
    valuePence: row.value_pence,
    termsVersion: row.terms_version,
    issuedAt: row.issued_at,
    issuedBy: row.issued_by,
    issuedByName: row.issued_by_name,
    issuedByUserId: row.issued_by_user_id,
    eventId: row.event_id,
    wonAtLabel: row.won_at_label,
    expiryDate: row.expiry_date,
    customerId: row.customer_id,
    redeemedAt: row.redeemed_at,
    redeemedBy: row.redeemed_by,
    redeemedByName: row.redeemed_by_name,
    redeemedByUserId: row.redeemed_by_user_id,
    transactionRef: row.transaction_ref,
    bookingRef: row.booking_ref,
    cancelledAt: row.cancelled_at,
    cancelledReason: row.cancelled_reason,
    replacedById: row.replaced_by_id,
    replacesId: row.replaces_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapVoucherEventRow(row: VoucherEventRow): VoucherEvent {
  return {
    id: row.id,
    voucherId: row.voucher_id,
    action: row.action,
    actorUserId: row.actor_user_id,
    actorEmployeeId: row.actor_employee_id,
    actorName: row.actor_name,
    source: row.source,
    at: row.at,
    detail: row.detail,
  }
}

export function mapVoucherReminderRow(row: VoucherReminderRow): VoucherReminder {
  return {
    id: row.id,
    voucherId: row.voucher_id,
    customerId: row.customer_id,
    reminderKind: row.reminder_kind,
    status: row.status,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    messageSid: row.message_sid,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
