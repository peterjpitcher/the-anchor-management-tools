/**
 * How private booking statuses and payment states look on staff screens: the DS Badge tone and
 * the words. Pure module, safe to import from server and client components.
 *
 * Before 18 September 2026 the list, the booking page, the calendar and the customer page each
 * coloured a booking their own way: a completed booking was sky blue on the list, a raw blue chip
 * on the calendar and green on the customer page, and a cancelled one red. Render every status
 * chip as
 *   <Badge tone={privateBookingStatusTone(status)} dot>{privateBookingStatusLabel(status)}</Badge>
 * and every payment chip with privateBookingPaymentTone(state), so the same booking looks the
 * same everywhere. Colours follow the table booking map (owner decision D4): confirmed is the
 * brand colour, a draft (a provisional hold waiting for its deposit) is amber like a booking
 * pending payment, finished states (completed, cancelled) are quiet, and only money that is late
 * is red.
 */

import type {
  FinalDetailsStatus,
  PostEventStatus,
  RiskStatus,
  SupplierStatus,
  WaiverStatus,
} from '@/types/private-bookings'
import type {
  ComplaintStatus,
  DeductionStatus,
  SupplierStatus as SupplierRowStatus,
} from '@/app/actions/privateBookingWorkflow'

export type PrivateBookingBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

// Maps rather than object literals, so a status such as "constructor" can never resolve to an
// inherited Object property.
const BOOKING_STATUS_TONES = new Map<string, PrivateBookingBadgeTone>([
  // A draft is a hold waiting for its deposit: pending payment in D4 terms.
  ['draft', 'warning'],
  // No live booking is tentative (checked 18 Sep 2026); an old or future one reads as waiting.
  ['tentative', 'warning'],
  ['confirmed', 'primary'],
  // Finished states are quiet (D4), as completed and cancelled table bookings are.
  ['completed', 'neutral'],
  ['cancelled', 'neutral'],
])

const BOOKING_STATUS_LABELS = new Map<string, string>([
  ['draft', 'Draft'],
  ['tentative', 'Tentative'],
  ['confirmed', 'Confirmed'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
])

/**
 * Payment states as the screens show them. `deposit_due` is a deposit still owed ("Deposit
 * Required"), `deposit_to_be_confirmed` is one waiting for a manager to confirm it, and
 * `balance_due` is money still owed on the booking.
 */
export type PrivateBookingPaymentState =
  | 'deposit_due'
  | 'deposit_to_be_confirmed'
  | 'deposit_paid'
  | 'balance_due'
  | 'overdue'
  | 'paid_in_full'
  | 'partially_refunded'
  | 'refunded'
  | 'not_required'

const PAYMENT_STATE_TONES = new Map<PrivateBookingPaymentState, PrivateBookingBadgeTone>([
  ['deposit_due', 'warning'],
  ['deposit_to_be_confirmed', 'warning'],
  ['deposit_paid', 'success'],
  ['balance_due', 'warning'],
  ['overdue', 'danger'],
  ['paid_in_full', 'success'],
  ['partially_refunded', 'warning'],
  ['refunded', 'info'],
  ['not_required', 'neutral'],
])

export function privateBookingStatusTone(status: string | null | undefined): PrivateBookingBadgeTone {
  return BOOKING_STATUS_TONES.get(String(status ?? '')) ?? 'neutral'
}

/** Sentence case with spaces. Tolerates a missing status from loosely typed rows. */
export function privateBookingStatusLabel(status: string | null | undefined): string {
  const known = BOOKING_STATUS_LABELS.get(String(status ?? ''))
  if (known) return known
  const words = String(status ?? '').replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown'
}

export function privateBookingPaymentTone(state: PrivateBookingPaymentState): PrivateBookingBadgeTone {
  return PAYMENT_STATE_TONES.get(state) ?? 'neutral'
}

// Readable text colours for each tone on a white or soft panel (the -fg shades pass 4.5:1).
const TONE_TEXT_CLASSES: Record<PrivateBookingBadgeTone, string> = {
  neutral: 'text-text-muted',
  primary: 'text-primary',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
  info: 'text-info-fg',
}

/** Text colour for a payment state written as words rather than a badge ("Fully paid"). */
export function privateBookingPaymentTextClass(state: PrivateBookingPaymentState): string {
  return TONE_TEXT_CLASSES[privateBookingPaymentTone(state)]
}

// Full class strings, never built from the tone name: Tailwind only generates classes it can
// read in the source. They match DS Badge's tones, so a calendar pill or legend swatch looks
// like the badge for the same status. Neutral is one step darker than the badge because a
// block sits on a white day cell, where the badge's near-white fill would disappear. Every edge
// is a -border token, never an opacity of the base colour.
const TONE_PANEL_CLASSES: Record<PrivateBookingBadgeTone, string> = {
  neutral: 'bg-surface-hover text-text-muted border-border-strong',
  primary: 'bg-primary-soft text-primary-soft-fg border-primary-border',
  success: 'bg-success-soft text-success-fg border-success-border',
  warning: 'bg-warning-soft text-warning-fg border-warning-border',
  danger: 'bg-danger-soft text-danger-fg border-danger-border',
  info: 'bg-info-soft text-info-fg border-info-border',
}

/**
 * Background, border and text classes for a booking shown as a block rather than a badge (the
 * calendar's day cells and its legend). Cancelled bookings are also struck through: they share
 * the neutral tone with completed bookings, and a day cell has no room for the word.
 */
export function privateBookingStatusBlockClasses(status: string | null | undefined): string {
  const classes = TONE_PANEL_CLASSES[privateBookingStatusTone(status)]
  return status === 'cancelled' ? `${classes} line-through` : classes
}

/**
 * Settings rows (venue spaces, catering packages, vendors) that can be switched off. Active is
 * green and inactive is quiet, on every settings tab.
 */
export function settingsActiveTone(active: boolean | null | undefined): PrivateBookingBadgeTone {
  return active ? 'success' : 'neutral'
}

export function settingsActiveLabel(active: boolean | null | undefined): string {
  return active ? 'Active' : 'Inactive'
}

/** The star badge on a preferred vendor. */
export const PREFERRED_VENDOR_TONE: PrivateBookingBadgeTone = 'warning'

/**
 * The private booking SMS queue. A message waiting for approval is amber, an approved one ready
 * to send is green, a cancelled one is quiet, and "Date Changed" (a message cancelled because the
 * booking moved) is amber so the reason stands out on the quiet card.
 */
export type SmsQueueBadgeState = 'pending' | 'approved' | 'cancelled' | 'date_changed'

const SMS_QUEUE_TONES: Record<SmsQueueBadgeState, PrivateBookingBadgeTone> = {
  pending: 'warning',
  approved: 'success',
  cancelled: 'neutral',
  date_changed: 'warning',
}

export function smsQueueTone(state: SmsQueueBadgeState): PrivateBookingBadgeTone {
  return SMS_QUEUE_TONES[state]
}

/**
 * Where a record on the growth report came from: the imported archive (amber, so staff can see
 * it was not entered in the app) or the live app.
 */
export type GrowthRecordSource = 'archive' | 'live'

const GROWTH_RECORD_SOURCE_TONES: Record<GrowthRecordSource, PrivateBookingBadgeTone> = {
  archive: 'warning',
  live: 'primary',
}

export function growthRecordSourceTone(source: GrowthRecordSource): PrivateBookingBadgeTone {
  return GROWTH_RECORD_SOURCE_TONES[source]
}

/** The trigger tag (booking confirmed, deposit reminder, manual) on a sent booking message. */
export const SENT_MESSAGE_TRIGGER_TONE: PrivateBookingBadgeTone = 'info'

/*
 * The SOP workflow panels on the booking page (waiver, risk, suppliers, final details, post-event,
 * deductions and complaints). Something still owed by the customer or a GM is amber, a problem is
 * red, a finished step is green and a step that does not apply is quiet.
 */
export const WAIVER_STATUS_TONE: Record<WaiverStatus, PrivateBookingBadgeTone> = {
  not_required: 'neutral',
  required: 'danger',
  sent: 'warning',
  signed: 'success',
  overdue: 'danger',
}

export const RISK_STATUS_TONE: Record<RiskStatus, PrivateBookingBadgeTone> = {
  low: 'success',
  normal: 'neutral',
  high: 'danger',
  gm_approval_required: 'warning',
  approved: 'success',
  rejected: 'danger',
}

/** The booking's overall supplier status. */
export const SUPPLIER_STATUS_TONE: Record<SupplierStatus, PrivateBookingBadgeTone> = {
  not_applicable: 'neutral',
  requested: 'warning',
  incomplete: 'warning',
  approved: 'success',
  rejected: 'danger',
}

/** One supplier row on the booking. */
export const SUPPLIER_ROW_STATUS_TONE: Record<SupplierRowStatus, PrivateBookingBadgeTone> = {
  requested: 'warning',
  incomplete: 'warning',
  approved: 'success',
  rejected: 'danger',
}

export const FINAL_DETAILS_STATUS_TONE: Record<FinalDetailsStatus, PrivateBookingBadgeTone> = {
  not_requested: 'neutral',
  requested: 'warning',
  complete: 'success',
  incomplete: 'warning',
  overdue: 'danger',
  manager_reviewed: 'success',
}

export const POST_EVENT_STATUS_TONE: Record<PostEventStatus, PrivateBookingBadgeTone> = {
  awaiting_inspection: 'warning',
  inspection_complete: 'info',
  deduction_discussion: 'warning',
  refund_processed: 'info',
  complete: 'success',
}

export const DEDUCTION_STATUS_TONE: Record<DeductionStatus, PrivateBookingBadgeTone> = {
  proposed: 'warning',
  discussed: 'info',
  approved: 'success',
  rejected: 'danger',
  applied: 'info',
}

export const COMPLAINT_STATUS_TONE: Record<ComplaintStatus, PrivateBookingBadgeTone> = {
  open: 'danger',
  acknowledged: 'warning',
  responded: 'info',
  resolved: 'success',
  closed: 'neutral',
}

/** A locked booking record (SOP section 27): edits and deletion are restricted. */
export const RECORD_LOCKED_TONE: PrivateBookingBadgeTone = 'danger'

/**
 * What cancelling a booking would do with its money, shown in the Change Booking Status dialog.
 * A refund due is informational, a partial refund is good news, a GM decision is amber and a case
 * that needs a manual review is red.
 */
export type CancellationOutcome =
  | 'no_money'
  | 'refundable'
  | 'deposit_partial_refund'
  | 'gm_review_required'
  | 'manual_review'

export const CANCELLATION_OUTCOME_TONE: Record<CancellationOutcome, PrivateBookingBadgeTone> = {
  no_money: 'neutral',
  refundable: 'info',
  deposit_partial_refund: 'success',
  gm_review_required: 'warning',
  manual_review: 'danger',
}

/**
 * An automated reminder on the booking's Communications tab: one that would fire is
 * informational, one that is suppressed is amber.
 */
export type ScheduledReminderState = 'eligible' | 'suppressed'

export const SCHEDULED_REMINDER_TONE: Record<ScheduledReminderState, PrivateBookingBadgeTone> = {
  eligible: 'info',
  suppressed: 'warning',
}
