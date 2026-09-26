// Maintenance badge tones: one map per value, used by the list, the item and the
// timeline (UI_UX.md, Status). Every badge still carries its text label, so status
// is never conveyed by colour alone. Labels come from @/types/maintenance.

import type {
  MaintenanceKind,
  MaintenancePriority,
  MaintenanceResponsibility,
  MaintenanceStatus,
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

/** The type (issue or improvement) is a category, not a state, so it stays neutral. */
export const MAINTENANCE_KIND_TONES: Record<MaintenanceKind, MaintenanceBadgeTone> = {
  issue: 'neutral',
  improvement: 'neutral',
}

/** The "Overdue" flag beside a target date that has passed. */
export const MAINTENANCE_OVERDUE_TONE: MaintenanceBadgeTone = 'danger'

/** A photo event in the timeline: a redacted photo is flagged, any other state is neutral. */
export const MAINTENANCE_PHOTO_EVENT_TONES: Record<'redacted' | 'kept', MaintenanceBadgeTone> = {
  redacted: 'warning',
  kept: 'neutral',
}
