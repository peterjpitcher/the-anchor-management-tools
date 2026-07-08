import { z } from 'zod';
import { toLocalIsoDate } from '@/lib/dateUtils';
import type {
  BookingStatus,
  BookingLayout,
  BookingItemFormData,
} from '@/types/private-bookings';

// ---------------------------------------------------------------------------
// Status transition rules
// ---------------------------------------------------------------------------

export const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: ['draft'],
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export type PrivateBookingSmsSideEffectSummary = {
  triggerType: string
  templateKey: string
  queueId?: string
  sent?: boolean
  suppressed?: boolean
  requiresApproval?: boolean
  code?: string | null
  logFailure?: boolean
  error?: string
}

export type NormalizedSmsSafetyMeta = {
  code: string | null
  logFailure: boolean
  fatal: boolean
}

// ---------------------------------------------------------------------------
// Helpers shared across sub-modules
// ---------------------------------------------------------------------------

 
export function normalizeSmsSafetyMeta(result: any): NormalizedSmsSafetyMeta {
  const code = typeof result?.code === 'string' ? result.code : null
  const logFailure = result?.logFailure === true || code === 'logging_failed'
  const fatal = logFailure || code === 'safety_unavailable' || code === 'idempotency_conflict'
  return { code, logFailure, fatal }
}

export const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

export function sanitizeBookingSearchTerm(value: string): string {
  return value
    .replace(/[,%_()"'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

const STANDARD_HOLD_DAYS = 14;
const SHORT_NOTICE_HOLD_DAYS = 2;
/** Balance and final details are due this many calendar days before the event (SOP §10/§13). */
export const BALANCE_DUE_DAYS_BEFORE_EVENT = 14;

/** The balance & final-details due date: 14 calendar days before the event. */
export function balanceDueMoment(eventDate: Date): Date {
  const due = new Date(eventDate);
  due.setDate(due.getDate() - BALANCE_DUE_DAYS_BEFORE_EVENT);
  return due;
}

/**
 * The single source of truth for a booking's balance & final-details due
 * date as stored in `private_bookings.balance_due_date` (SOP §13):
 * 14 calendar days before the event, never in the past — bookings created
 * or rescheduled inside the window are due immediately — and never after the
 * event itself. The DB trigger `calculate_balance_due_date()` mirrors this
 * formula exactly; renderers must only ever read the stored column.
 */
export function computeBalanceDueDateIso(eventDate: string | Date, now: Date = new Date()): string {
  const event = eventDate instanceof Date ? eventDate : new Date(eventDate);
  const dueMoment = balanceDueMoment(event);
  const clampedToToday = now.getTime() > dueMoment.getTime() ? toLocalIsoDate(now) : toLocalIsoDate(dueMoment);
  const eventIso = toLocalIsoDate(event);
  // A past-dated event must not receive a deadline after its own event date —
  // that would leave the cron chasing a balance for an event already held.
  return clampedToToday > eventIso ? eventIso : clampedToToday;
}

/**
 * Compute the automatic hold expiry date for a private booking.
 *
 * SOP §10: a hold must never run past the balance & final-details deadline
 * (14 calendar days before the event).
 * - Booking created inside that window (short notice): 48 hours from now,
 *   capped at event start — and everything is due immediately.
 * - Otherwise: 14 days from now, capped at the balance due date.
 */
export function computeHoldExpiry(eventDate: Date, now: Date): Date {
  const dueMoment = balanceDueMoment(eventDate);

  if (now.getTime() > dueMoment.getTime()) {
    // Short notice: 48 hours from now, capped at event start
    const shortNoticeExpiry = new Date(now);
    shortNoticeExpiry.setDate(shortNoticeExpiry.getDate() + SHORT_NOTICE_HOLD_DAYS);
    return shortNoticeExpiry.getTime() > eventDate.getTime() ? eventDate : shortNoticeExpiry;
  }

  // Normal: 14 days from now, capped at the balance & final-details due date
  const standardExpiry = new Date(now);
  standardExpiry.setDate(standardExpiry.getDate() + STANDARD_HOLD_DAYS);
  return standardExpiry.getTime() > dueMoment.getTime() ? dueMoment : standardExpiry;
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Format time to HH:MM */
export function formatTimeToHHMM(time: string | undefined): string | undefined {
  if (!time) return undefined

  // If time is already in correct format, return it
  if (/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
    return time
  }

  // Parse and format time
  const [hours, minutes] = time.split(':')
  const formattedHours = hours.padStart(2, '0')
  const formattedMinutes = (minutes || '00').padStart(2, '0')

  return `${formattedHours}:${formattedMinutes}`
}

// Time validation schema
const timeSchema = z.string().regex(
  /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
  'Time must be in HH:MM format (24-hour)'
)

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

export const privateBookingSchema = z.object({
  customer_first_name: z.string().min(1, 'First name is required'),
  customer_last_name: z.string().optional(),
  customer_id: z.string().uuid().optional().nullable(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  contact_phone: z.string().optional(),
  contact_email: z.string().email('Invalid email format').optional().or(z.literal('')),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  start_time: timeSchema.optional(),
  setup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().or(z.literal('')),
  setup_time: timeSchema.optional().or(z.literal('')),
  end_time: timeSchema.optional().or(z.literal('')),
  guest_count: z.number().min(0, 'Guest count cannot be negative').optional(),
  event_type: z.string().optional(),
  internal_notes: z.string().optional(),
  contract_note: z.string().optional(),
  customer_requests: z.string().optional(),
  special_requirements: z.string().optional(),
  accessibility_needs: z.string().optional(),
  source: z.string().optional(),
  deposit_amount: z.number().min(0).optional(),
  deposit_reduction_reason: z.string().optional(),
  deposit_waived: z.boolean().optional(),
  deposit_waived_reason: z.string().optional(),
  balance_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().or(z.literal('')),
  hold_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().or(z.literal('')),
  has_open_dispute: z.boolean().optional(),
  status: z.enum(['draft', 'confirmed', 'completed', 'cancelled']).optional(),
  // Enquiry intake fields (SOP pack §9)
  layout: z.enum(['seated', 'standing', 'mixed']).optional(),
  guest_count_adults: z.number().min(0, 'Adult guest count cannot be negative').optional(),
  guest_count_under_18: z.number().min(0, 'Under-18 guest count cannot be negative').optional(),
  bar_tab_required: z.boolean().optional(),
  bar_tab_limit: z.number().min(0, 'Bar tab limit cannot be negative').optional(),
  bar_tab_prepaid_amount: z.number().min(0, 'Bar tab pre-payment cannot be negative').optional(),
  bar_tab_preauth_reference: z.string().optional(),
  outside_food: z.boolean().optional(),
  high_power_equipment: z.boolean().optional(),
  decorations_plan: z.string().optional(),
  dogs_expected: z.boolean().optional(),
  special_risk_notes: z.string().optional(),
  communication_preference: z.string().optional(),
  cleardown_time: timeSchema.optional().or(z.literal(''))
})

export const bookingNoteSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, 'Please enter a note before saving.')
    .max(2000, 'Notes are limited to 2000 characters.')
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DATE_TBD_NOTE = 'Event date/time to be confirmed';
export const DEFAULT_TBD_TIME = '12:00';

export const ALLOWED_VENDOR_TYPES = [
  'dj', 'band', 'photographer', 'florist', 'decorator', 'cake', 'entertainment',
  'transport', 'equipment', 'other'
] as const;

const STORAGE_TYPES = ['ambient', 'chilled', 'frozen', 'dry', 'other'] as const;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type CreatePrivateBookingInput = {
  customer_first_name: string;
  customer_last_name?: string;
  customer_id?: string | null;
  default_country_code?: string;
  contact_phone?: string;
  contact_email?: string;
  event_date?: string;
  start_time?: string;
  end_time?: string;
  setup_date?: string;
  setup_time?: string;
  guest_count?: number;
  event_type?: string;
  internal_notes?: string;
  contract_note?: string;
  customer_requests?: string;
  special_requirements?: string;
  accessibility_needs?: string;
  source?: string;
  deposit_amount?: number;
  deposit_reduction_reason?: string;
  deposit_waived?: boolean;
  deposit_waived_reason?: string;
  balance_due_date?: string;
  hold_expiry?: string;
  has_open_dispute?: boolean;
  status?: string;
  created_by?: string;
  date_tbd?: boolean;
  items?: BookingItemFormData[];
  // Enquiry intake fields (SOP pack §9)
  layout?: BookingLayout;
  guest_count_adults?: number;
  guest_count_under_18?: number;
  bar_tab_required?: boolean;
  bar_tab_limit?: number;
  bar_tab_prepaid_amount?: number;
  bar_tab_preauth_reference?: string;
  outside_food?: boolean;
  high_power_equipment?: boolean;
  decorations_plan?: string;
  dogs_expected?: boolean;
  special_risk_notes?: string;
  communication_preference?: string;
  cleardown_time?: string;
};

export type UpdatePrivateBookingInput = Partial<CreatePrivateBookingInput> & {
  status?: BookingStatus;
  /** Client-only: why the event date moved (SOP §15) — audited, never persisted as a column. */
  date_change_reason?: string;
};

// ---------------------------------------------------------------------------
// Intake helpers (SOP pack §9, §12, §18)
// ---------------------------------------------------------------------------

/** Intake columns written via the post-create follow-up UPDATE (the create RPC ignores unknown keys). */
export const PRIVATE_BOOKING_INTAKE_FIELDS = [
  'layout',
  'guest_count_adults',
  'guest_count_under_18',
  'bar_tab_required',
  'bar_tab_limit',
  'bar_tab_prepaid_amount',
  'bar_tab_preauth_reference',
  'outside_food',
  'high_power_equipment',
  'decorations_plan',
  'dogs_expected',
  'special_risk_notes',
  'communication_preference',
  'cleardown_time',
] as const;

/**
 * SOP §12: bar tabs must be pre-arranged with a recorded limit and be
 * pre-paid and/or pre-authorised. Throws when the rule is broken.
 */
export function assertBarTabRules(input: {
  bar_tab_required?: boolean | null;
  bar_tab_limit?: number | null;
  bar_tab_prepaid_amount?: number | null;
  bar_tab_preauth_reference?: string | null;
}): void {
  if (input.bar_tab_required !== true) return;
  if (toNumber(input.bar_tab_limit, 0) <= 0) {
    throw new Error('Bar tabs must have a recorded limit');
  }
  const hasPrepayment = toNumber(input.bar_tab_prepaid_amount, 0) > 0;
  const hasPreauth = Boolean((input.bar_tab_preauth_reference || '').trim());
  if (!hasPrepayment && !hasPreauth) {
    throw new Error('Bar tabs must be pre-paid and/or pre-authorised');
  }
}

/** Event types that always trigger a high-risk review (SOP pack §18). */
export const HIGH_RISK_EVENT_TYPE_PATTERN =
  /18th|21st|gender reveal|stag|hen|promoted|ticketed|charity|corporate|live music|dj\b|inflat|bouncy|extern|late/i;

export type DerivedRiskStatus = 'normal' | 'high' | 'gm_approval_required';

/**
 * Derive the booking risk status from intake data (SOP pack §18, §6.7).
 * Pure — callers must never overwrite an existing GM decision
 * ('approved' / 'rejected') with the derived value.
 */
export function deriveRiskStatus(input: {
  event_type?: string | null;
  guest_count?: number | null;
  guest_count_under_18?: number | null;
  outside_food?: boolean | null;
  high_power_equipment?: boolean | null;
  special_risk_notes?: string | null;
}): DerivedRiskStatus {
  const guestCount = toNumber(input.guest_count, 0);

  const isHighRisk =
    (Boolean(input.event_type) && HIGH_RISK_EVENT_TYPE_PATTERN.test(input.event_type as string)) ||
    toNumber(input.guest_count_under_18, 0) > 0 ||
    input.outside_food === true ||
    input.high_power_equipment === true ||
    Boolean((input.special_risk_notes || '').trim()) ||
    guestCount >= 100;

  if (isHighRisk) return 'high';

  // SOP §6.7: bookings below 30 expected guests need a General Manager override.
  if (guestCount > 0 && guestCount < 30) return 'gm_approval_required';

  return 'normal';
}
