/**
 * How an event's status, and the status of a booking for it, look on staff screens: the DS
 * Badge tone and the words. Pure module, safe to import from server and client components.
 *
 * Until 18 September 2026 the events list, the board cards and the event page each kept their
 * own copy of this map. The copies agreed, but nothing kept them agreeing, so one screen could
 * drift to a different colour for the same status. Render every event status chip as
 *   <Badge tone={eventStatusTone(status)} dot>{eventStatusLabel(status)}</Badge>
 * so an event looks the same wherever it appears.
 */

export type EventBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

// A Map rather than an object literal, so a status such as "constructor" can never resolve to
// an inherited Object property.
const EVENT_STATUS_TONES = new Map<string, EventBadgeTone>([
  ['scheduled', 'success'],
  ['cancelled', 'danger'],
  ['postponed', 'warning'],
  ['rescheduled', 'info'],
  ['sold_out', 'primary'],
])

export function eventStatusTone(status: string | null | undefined): EventBadgeTone {
  if (!status) return 'neutral'
  return EVENT_STATUS_TONES.get(status) ?? 'neutral'
}

/** "sold_out" reads as "Sold Out"; a missing status reads as "Unknown". */
export function eventStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// A booking for an event takes the booking colours the owner set on 18 September 2026 (D4):
// a booked place is the brand colour, one still waiting for payment is amber, and a cancelled
// one is quiet rather than red.
const EVENT_BOOKING_STATUS_TONES = new Map<string, EventBadgeTone>([
  ['confirmed', 'primary'],
  ['pending_payment', 'warning'],
  ['cancelled', 'neutral'],
])

export function eventBookingStatusTone(status: string | null | undefined): EventBadgeTone {
  if (!status) return 'neutral'
  return EVENT_BOOKING_STATUS_TONES.get(status) ?? 'neutral'
}

// How urgent an outstanding checklist todo is. Overdue is the only red; anything still to do
// (due today or coming up) is amber.
const EVENT_TODO_URGENCY_TONES = new Map<string, EventBadgeTone>([
  ['overdue', 'danger'],
  ['due_today', 'warning'],
  ['upcoming', 'warning'],
])

export function eventTodoUrgencyTone(status: string | null | undefined): EventBadgeTone {
  if (!status) return 'warning'
  return EVENT_TODO_URGENCY_TONES.get(status) ?? 'warning'
}

/** The left rule beside a todo in the outstanding todos panel, in the same colour as its badge. */
const EVENT_TODO_URGENCY_BORDER_CLASSES: Record<'danger' | 'warning', string> = {
  danger: 'border-danger',
  warning: 'border-warning',
}

export function eventTodoUrgencyBorderClass(status: string | null | undefined): string {
  return eventTodoUrgencyTone(status) === 'danger'
    ? EVENT_TODO_URGENCY_BORDER_CLASSES.danger
    : EVENT_TODO_URGENCY_BORDER_CLASSES.warning
}

/** A checklist task's status as text on the event page checklist. */
const EVENT_CHECKLIST_STATUS_TEXT_CLASSES = new Map<string, string>([
  ['overdue', 'text-danger-fg'],
  ['due_today', 'text-warning-fg'],
])

export function eventChecklistStatusTextClass(status: string | null | undefined): string {
  if (!status) return 'text-text-muted'
  return EVENT_CHECKLIST_STATUS_TEXT_CLASSES.get(status) ?? 'text-text-muted'
}

// Seated or standing, on a communal event's attendee list.
const EVENT_SEATING_TYPE_TONES = new Map<string, EventBadgeTone>([
  ['standing', 'warning'],
  ['seated', 'info'],
])

export function eventSeatingTypeTone(seatingType: string | null | undefined): EventBadgeTone {
  if (!seatingType) return 'info'
  return EVENT_SEATING_TYPE_TONES.get(seatingType) ?? 'info'
}

// A marketing short link is for a digital channel or for print.
const EVENT_LINK_TYPE_TONES = new Map<string, EventBadgeTone>([
  ['digital', 'info'],
  ['print', 'neutral'],
])

export function eventLinkTypeTone(linkType: string | null | undefined): EventBadgeTone {
  if (!linkType) return 'neutral'
  return EVENT_LINK_TYPE_TONES.get(linkType) ?? 'neutral'
}

/** Whether a ticket type is on sale. */
export function eventTicketTypeSaleTone(isActive: boolean): EventBadgeTone {
  return isActive ? 'success' : 'neutral'
}

// The delivery status of an event marketing text is not mapped here: the event page uses
// messageDeliveryStatusTone and messageDeliveryStatusLabel from src/lib/messages/status-ui.ts,
// the one delivery map every screen shares.

// How full an event is, as the fill of the small capacity bar on the events list: sold out
// (or over) is red, 80% or more is amber, anything less is green.
const EVENT_CAPACITY_FILL_CLASSES = {
  full: 'bg-danger',
  nearlyFull: 'bg-warning',
  open: 'bg-success',
} as const

export function eventCapacityFillClass(bookedRatio: number): string {
  if (bookedRatio >= 1) return EVENT_CAPACITY_FILL_CLASSES.full
  if (bookedRatio >= 0.8) return EVENT_CAPACITY_FILL_CLASSES.nearlyFull
  return EVENT_CAPACITY_FILL_CLASSES.open
}

/** A check run before drafting event copy: an error blocks the draft, a warning does not. */
const EVENT_PREFLIGHT_ISSUE_TEXT_CLASSES: Record<'error' | 'warning', string> = {
  error: 'text-danger-fg',
  warning: 'text-warning-fg',
}

export function eventPreflightIssueTextClass(type: 'error' | 'warning'): string {
  return EVENT_PREFLIGHT_ISSUE_TEXT_CLASSES[type]
}

// The SEO health score in the event drawer: 40 or under is poor (red), 70 or under is fair
// (amber), anything higher is good (green). The score is words, so it takes the -fg shade; the
// bar is a fill and the tick and cross marks are glyphs, so they take the base colour.
export type SeoHealthBand = 'poor' | 'fair' | 'good'

const SEO_HEALTH_STYLES: Record<
  SeoHealthBand,
  { label: string; tone: 'danger' | 'warning' | 'success'; score: string; tick: string; cross: string }
> = {
  poor: { label: 'Poor', tone: 'danger', score: 'text-danger-fg', tick: 'text-success', cross: 'text-danger' },
  fair: { label: 'Fair', tone: 'warning', score: 'text-warning-fg', tick: 'text-success', cross: 'text-warning' },
  good: { label: 'Good', tone: 'success', score: 'text-success-fg', tick: 'text-success', cross: 'text-text-subtle' },
}

export function seoHealthBand(score: number): SeoHealthBand {
  if (score <= 40) return 'poor'
  if (score <= 70) return 'fair'
  return 'good'
}

export function seoHealthStyles(score: number): (typeof SEO_HEALTH_STYLES)[SeoHealthBand] {
  return SEO_HEALTH_STYLES[seoHealthBand(score)]
}
