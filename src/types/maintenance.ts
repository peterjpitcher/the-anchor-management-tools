// Maintenance and improvements tracker.
//
// The *Row types mirror the database columns exactly (snake_case). The domain
// types are the camelCase shapes the app works with. Both are pinned to
// supabase/migrations/20260905210000_maintenance_tracker.sql; if a column changes
// there, change it here in the same commit.
//
// Access is super-admin only at every layer. There is deliberately no RBAC module
// for maintenance: user_has_permission returns true for super-admins on any module,
// so it can only express a floor, never a restriction.

// ---------------------------------------------------------------------------
// Enumerations, matching the CHECK constraints
// ---------------------------------------------------------------------------

export const MAINTENANCE_KINDS = ['issue', 'improvement'] as const
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number]

export const MAINTENANCE_STATUSES = [
  'reported',
  'quoting',
  'awaiting_landlord',
  'with_third_party',
  'scheduled',
  'in_progress',
  'on_hold',
  'done',
  'cancelled',
] as const
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number]

export const MAINTENANCE_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number]

export const MAINTENANCE_RESPONSIBILITIES = ['us', 'greene_king', 'to_confirm'] as const
export type MaintenanceResponsibility = (typeof MAINTENANCE_RESPONSIBILITIES)[number]

export const MAINTENANCE_PHOTO_STATES = ['pending', 'ready', 'failed'] as const
export type MaintenancePhotoState = (typeof MAINTENANCE_PHOTO_STATES)[number]

/**
 * Closed means done or cancelled. Everything else is open. This single pair of
 * definitions drives the list totals, the nav badge and the Friday email; do not
 * restate it anywhere else.
 */
export const MAINTENANCE_CLOSED_STATUSES = ['done', 'cancelled'] as const
export type MaintenanceClosedStatus = (typeof MAINTENANCE_CLOSED_STATUSES)[number]

export const MAINTENANCE_OPEN_STATUSES = [
  'reported',
  'quoting',
  'awaiting_landlord',
  'with_third_party',
  'scheduled',
  'in_progress',
  'on_hold',
] as const
export type MaintenanceOpenStatus = (typeof MAINTENANCE_OPEN_STATUSES)[number]

// ---------------------------------------------------------------------------
// Display labels
// ---------------------------------------------------------------------------

export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = {
  issue: 'Issue',
  improvement: 'Improvement',
}

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  reported: 'Reported',
  quoting: 'Getting quotes',
  // The stored value is tenancy neutral on purpose, only the label names the landlord.
  awaiting_landlord: 'With Greene King',
  // Anyone who is neither us nor the landlord: the council, Highways, an insurer,
  // a neighbouring owner. Kept generic so it does not need renaming per case.
  with_third_party: 'With a third party',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  on_hold: 'On hold',
  done: 'Done',
  cancelled: 'Cancelled',
}

export const MAINTENANCE_PRIORITY_LABELS: Record<MaintenancePriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const MAINTENANCE_RESPONSIBILITY_LABELS: Record<MaintenanceResponsibility, string> = {
  us: 'Us',
  greene_king: 'Greene King',
  to_confirm: 'To confirm',
}

// ---------------------------------------------------------------------------
// Database rows
// ---------------------------------------------------------------------------

export interface MaintenanceAreaRow {
  id: string
  name: string
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface MaintenanceItemRow {
  id: string
  reference: string
  kind: MaintenanceKind
  title: string
  description: string | null
  area_id: string
  status: MaintenanceStatus
  priority: MaintenancePriority
  responsibility: MaintenanceResponsibility
  /** ISO date (yyyy-mm-dd) in Europe/London. */
  reported_on: string
  target_date: string | null
  completed_on: string | null
  /** numeric(10,2), pounds including VAT. Null means uncosted, which is not zero. */
  estimated_cost: number | null
  actual_cost: number | null
  contractor_name: string | null
  contractor_contact: string | null
  created_by: string | null
  created_by_email: string | null
  created_at: string
  updated_at: string
}

export interface MaintenanceNoteRow {
  id: string
  item_id: string
  content: string
  created_by: string | null
  created_by_email: string | null
  created_at: string
}

export interface MaintenancePhotoRow {
  id: string
  item_id: string
  storage_path: string
  file_name: string | null
  mime_type: string | null
  file_size_bytes: number | null
  width: number | null
  height: number | null
  caption: string | null
  taken_on: string | null
  state: MaintenancePhotoState
  uploaded_by: string | null
  uploaded_by_email: string | null
  uploaded_at: string
  redacted_at: string | null
  redacted_by: string | null
  redacted_by_email: string | null
  redaction_reason: string | null
}

export interface MaintenanceItemHistoryRow {
  id: string
  item_id: string
  changed_at: string
  /** Null for writes made by the service role; changed_by_email then reads 'system'. */
  changed_by: string | null
  changed_by_email: string | null
  field: string
  old_value: string | null
  new_value: string | null
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface MaintenanceArea {
  id: string
  name: string
  sortOrder: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface MaintenanceItem {
  id: string
  reference: string
  kind: MaintenanceKind
  title: string
  description: string | null
  areaId: string
  areaName: string | null
  status: MaintenanceStatus
  priority: MaintenancePriority
  responsibility: MaintenanceResponsibility
  reportedOn: string
  targetDate: string | null
  completedOn: string | null
  estimatedCost: number | null
  actualCost: number | null
  contractorName: string | null
  contractorContact: string | null
  createdBy: string | null
  createdByEmail: string | null
  createdAt: string
  updatedAt: string
}

export interface MaintenanceNote {
  id: string
  itemId: string
  content: string
  createdBy: string | null
  createdByEmail: string | null
  createdAt: string
}

export interface MaintenancePhoto {
  id: string
  itemId: string
  storagePath: string
  fileName: string | null
  mimeType: string | null
  fileSizeBytes: number | null
  width: number | null
  height: number | null
  caption: string | null
  takenOn: string | null
  state: MaintenancePhotoState
  uploadedBy: string | null
  uploadedByEmail: string | null
  uploadedAt: string
  redactedAt: string | null
  redactedBy: string | null
  redactedByEmail: string | null
  redactionReason: string | null
}

export interface MaintenanceItemHistoryEntry {
  id: string
  itemId: string
  changedAt: string
  changedBy: string | null
  changedByEmail: string | null
  field: string
  oldValue: string | null
  newValue: string | null
}

/** Totals for a list, following whatever filters are active. */
export interface MaintenanceCostSummary {
  /** Sum of estimated_cost on open items where responsibility is 'us'. */
  ourOpenEstimate: number
  /** Open 'us' items with no estimate. Null is not zero and is never summed as zero. */
  ourUncostedCount: number
  greeneKingOpenEstimate: number
  greeneKingUncostedCount: number
  toConfirmOpenEstimate: number
  toConfirmUncostedCount: number
  openCount: number
  overdueCount: number
}

// ---------------------------------------------------------------------------
// Row to domain mapping. There is no fromDb helper in this repo, so mapping is
// done explicitly and kept beside the row types it depends on.
// ---------------------------------------------------------------------------

export function mapMaintenanceArea(row: MaintenanceAreaRow): MaintenanceArea {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapMaintenanceItem(
  row: MaintenanceItemRow,
  areaName?: string | null
): MaintenanceItem {
  return {
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    title: row.title,
    description: row.description,
    areaId: row.area_id,
    areaName: areaName ?? null,
    status: row.status,
    priority: row.priority,
    responsibility: row.responsibility,
    reportedOn: row.reported_on,
    targetDate: row.target_date,
    completedOn: row.completed_on,
    estimatedCost: row.estimated_cost,
    actualCost: row.actual_cost,
    contractorName: row.contractor_name,
    contractorContact: row.contractor_contact,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapMaintenanceNote(row: MaintenanceNoteRow): MaintenanceNote {
  return {
    id: row.id,
    itemId: row.item_id,
    content: row.content,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
  }
}

export function mapMaintenancePhoto(row: MaintenancePhotoRow): MaintenancePhoto {
  return {
    id: row.id,
    itemId: row.item_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    width: row.width,
    height: row.height,
    caption: row.caption,
    takenOn: row.taken_on,
    state: row.state,
    uploadedBy: row.uploaded_by,
    uploadedByEmail: row.uploaded_by_email,
    uploadedAt: row.uploaded_at,
    redactedAt: row.redacted_at,
    redactedBy: row.redacted_by,
    redactedByEmail: row.redacted_by_email,
    redactionReason: row.redaction_reason,
  }
}

export function mapMaintenanceItemHistoryEntry(
  row: MaintenanceItemHistoryRow
): MaintenanceItemHistoryEntry {
  return {
    id: row.id,
    itemId: row.item_id,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
    changedByEmail: row.changed_by_email,
    field: row.field,
    oldValue: row.old_value,
    newValue: row.new_value,
  }
}

// ---------------------------------------------------------------------------
// Guards and shared predicates
// ---------------------------------------------------------------------------

export function isMaintenanceKind(value: unknown): value is MaintenanceKind {
  return typeof value === 'string' && (MAINTENANCE_KINDS as readonly string[]).includes(value)
}

export function isMaintenanceStatus(value: unknown): value is MaintenanceStatus {
  return typeof value === 'string' && (MAINTENANCE_STATUSES as readonly string[]).includes(value)
}

export function isMaintenancePriority(value: unknown): value is MaintenancePriority {
  return typeof value === 'string' && (MAINTENANCE_PRIORITIES as readonly string[]).includes(value)
}

export function isMaintenanceResponsibility(value: unknown): value is MaintenanceResponsibility {
  return (
    typeof value === 'string' &&
    (MAINTENANCE_RESPONSIBILITIES as readonly string[]).includes(value)
  )
}

export function isMaintenancePhotoState(value: unknown): value is MaintenancePhotoState {
  return typeof value === 'string' && (MAINTENANCE_PHOTO_STATES as readonly string[]).includes(value)
}

/** Open means any status other than done and cancelled. */
export function isOpenMaintenanceStatus(status: MaintenanceStatus): boolean {
  return !(MAINTENANCE_CLOSED_STATUSES as readonly string[]).includes(status)
}

/**
 * Overdue means an open item whose target date has already passed. Due today is
 * not overdue. Pass today's London date from dateUtils (getTodayIsoDate()); this
 * stays pure so the list, the badge and the email all use the same predicate.
 */
export function isMaintenanceItemOverdue(
  item: Pick<MaintenanceItem, 'status' | 'targetDate'>,
  todayIsoDate: string
): boolean {
  if (!item.targetDate) return false
  if (!isOpenMaintenanceStatus(item.status)) return false
  return item.targetDate < todayIsoDate
}

/** Only ready photos are ever read or displayed. */
export function isDisplayableMaintenancePhoto(
  photo: Pick<MaintenancePhoto, 'state' | 'redactedAt'>
): boolean {
  return photo.state === 'ready' && photo.redactedAt === null
}
