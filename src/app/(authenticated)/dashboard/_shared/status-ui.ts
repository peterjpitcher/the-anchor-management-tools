/**
 * Dashboard status colours. Each status has one map, used wherever it shows (UI_UX.md, Status).
 * Whole class strings only, so Tailwind can see every class.
 */

export type DashboardBadgeTone = 'success' | 'warning' | 'primary' | 'neutral'

/** How full an upcoming event is, from booked seats against capacity. */
export type EventFillStatus = 'near_full' | 'on_track' | 'open'

export const EVENT_FILL_BADGE: Record<EventFillStatus, { tone: DashboardBadgeTone; text: string }> = {
  near_full: { tone: 'warning', text: 'Near full' },
  on_track: { tone: 'success', text: 'On track' },
  open: { tone: 'neutral', text: 'Open' },
}

/** Over 90% booked is near full, over 50% is on track, anything else is open. */
export function eventFillStatus(booked: number, capacity: number): EventFillStatus {
  const ratio = capacity > 0 ? booked / capacity : 0
  if (ratio > 0.9) return 'near_full'
  if (ratio > 0.5) return 'on_track'
  return 'open'
}

export type ActionItemSeverity = 'high' | 'medium' | 'low'

/** "Action Required" rows: high is red, medium and low are amber. */
export const ACTION_ITEM_SEVERITY_CLASSES: Record<ActionItemSeverity, { row: string; text: string }> = {
  high: { row: 'bg-danger-soft border-danger-border', text: 'text-danger-fg' },
  medium: { row: 'bg-warning-soft border-warning-border', text: 'text-warning-fg' },
  low: { row: 'bg-warning-soft border-warning-border', text: 'text-warning-fg' },
}

export type DashboardStatTone = 'default' | 'success' | 'warning' | 'danger'

/**
 * "Week vs last" and "Last year same week": a rise is green, a fall red, and "--" (nothing to
 * compare) stays plain. The value is the signed percentage the page prints ("+4.2%", "-3.0%").
 */
export function revenueChangeTone(change: string): DashboardStatTone {
  if (change === '--') return 'default'
  return change.startsWith('-') ? 'danger' : 'success'
}

/** A count that needs someone (SMS failures, unread messages): amber once it is above zero. */
export function attentionCountTone(count: number): DashboardStatTone {
  return count > 0 ? 'warning' : 'default'
}
