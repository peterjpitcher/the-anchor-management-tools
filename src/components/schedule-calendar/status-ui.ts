/**
 * How a day the venue or its kitchen is shut looks on the month grid: the cell tint and the
 * Badge tone of the word on it. Pure module, safe on server and client.
 *
 * Being shut is a property of the DAY, so the whole cell is tinted, and the word is there as
 * well because colour alone says nothing to a screen reader or in high contrast.
 */

export type CalendarClosure = 'closed' | 'kitchen'

export const CALENDAR_CLOSURE_CELL_CLASSES: Record<CalendarClosure, string> = {
  closed: 'bg-border',
  kitchen: 'bg-warning-soft',
}

export const CALENDAR_CLOSURE_BADGE: Record<CalendarClosure, { tone: 'neutral' | 'warning'; label: string }> = {
  closed: { tone: 'neutral', label: 'Closed' },
  kitchen: { tone: 'warning', label: 'No kitchen' },
}
