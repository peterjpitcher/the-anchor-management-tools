// Presentation helpers shared by the maintenance list, new and detail screens.
//
// Labels come from @/types/maintenance and are never restated here. This module
// only decides how a value is drawn: which badge tone carries it, and how money
// and dates are written. Every badge still carries its text label, so status is
// never conveyed by colour alone.

import { formatDateInLondon } from '@/lib/dateUtils'
import {
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_RESPONSIBILITY_LABELS,
  MAINTENANCE_STATUS_LABELS,
  type MaintenancePriority,
  type MaintenanceResponsibility,
  type MaintenanceStatus,
} from '@/types/maintenance'

export type MaintenanceBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

export const MAINTENANCE_STATUS_TONES: Record<MaintenanceStatus, MaintenanceBadgeTone> = {
  reported: 'info',
  quoting: 'info',
  awaiting_landlord: 'warning',
  with_third_party: 'warning',
  scheduled: 'primary',
  in_progress: 'primary',
  on_hold: 'warning',
  done: 'success',
  cancelled: 'neutral',
}

export const MAINTENANCE_PRIORITY_TONES: Record<MaintenancePriority, MaintenanceBadgeTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

export const MAINTENANCE_RESPONSIBILITY_TONES: Record<
  MaintenanceResponsibility,
  MaintenanceBadgeTone
> = {
  us: 'primary',
  greene_king: 'info',
  to_confirm: 'warning',
}

const poundsFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Money is recorded and shown in pounds including VAT. No tax is worked out
 * anywhere in the tracker.
 */
export function formatPounds(value: number): string {
  return poundsFormatter.format(value)
}

/**
 * A null cost means nobody has costed the item yet. That is not zero, so it is
 * never drawn as one; the uncosted items are counted separately instead.
 */
export function formatOptionalPounds(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Not costed'
  return poundsFormatter.format(value)
}

/** A yyyy-mm-dd date, written the way a person reads it. */
export function formatMaintenanceDate(isoDate: string | null | undefined): string {
  if (!isoDate) return 'Not set'
  return formatDateInLondon(`${isoDate}T12:00:00Z`, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** A timestamp, for the timeline. */
export function formatMaintenanceTimestamp(value: string): string {
  return formatDateInLondon(value, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function maintenanceStatusLabel(status: MaintenanceStatus): string {
  return MAINTENANCE_STATUS_LABELS[status]
}

export function maintenancePriorityLabel(priority: MaintenancePriority): string {
  return MAINTENANCE_PRIORITY_LABELS[priority]
}

export function maintenanceResponsibilityLabel(value: MaintenanceResponsibility): string {
  return MAINTENANCE_RESPONSIBILITY_LABELS[value]
}

/**
 * The history trigger records raw column names. These are the ones a person sees
 * on screen; anything not listed falls back to the column name with the
 * underscores taken out, so a new column is still readable rather than hidden.
 */
const HISTORY_FIELD_LABELS: Record<string, string> = {
  kind: 'Type',
  title: 'Title',
  description: 'Description',
  area_id: 'Area',
  status: 'Status',
  priority: 'Priority',
  responsibility: 'Responsibility',
  reported_on: 'Reported on',
  target_date: 'Target date',
  completed_on: 'Completed on',
  estimated_cost: 'Estimated cost',
  actual_cost: 'Actual cost',
  contractor_name: 'Contractor',
  contractor_contact: 'Contractor contact',
}

export function maintenanceHistoryFieldLabel(field: string): string {
  return HISTORY_FIELD_LABELS[field] ?? field.replace(/_/g, ' ')
}

/**
 * History values are stored as text. Statuses, priorities and responsibilities
 * are swapped for their labels so the trail reads the same as the badges.
 */
export function maintenanceHistoryValueLabel(field: string, value: string | null): string {
  if (value === null || value === '') return 'empty'

  if (field === 'status' && value in MAINTENANCE_STATUS_LABELS) {
    return MAINTENANCE_STATUS_LABELS[value as MaintenanceStatus]
  }
  if (field === 'priority' && value in MAINTENANCE_PRIORITY_LABELS) {
    return MAINTENANCE_PRIORITY_LABELS[value as MaintenancePriority]
  }
  if (field === 'responsibility' && value in MAINTENANCE_RESPONSIBILITY_LABELS) {
    return MAINTENANCE_RESPONSIBILITY_LABELS[value as MaintenanceResponsibility]
  }

  return value
}

/** 'someone@example.com' or, for a service-role write, 'the system'. */
export function maintenanceActorLabel(email: string | null | undefined): string {
  if (!email || email === 'system') return 'the system'
  return email
}
