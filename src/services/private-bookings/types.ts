import { z } from 'zod';
import type {
  BookingStatus,
  BookingItemFormData,
} from '@/types/private-bookings';

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

export const STANDARD_HOLD_DAYS = 14;
export const SHORT_NOTICE_HOLD_DAYS = 2;

/**
 * Compute the automatic hold expiry date for a private booking.
 * - If booking is created < 7 days before the event (short notice): 48 hours from now, capped at event start.
 * - Otherwise: 14 days from now, capped at 7 days before the event.
 */
export function computeHoldExpiry(eventDate: Date, now: Date): Date {
  const sevenDaysBeforeEvent = new Date(eventDate);
  sevenDaysBeforeEvent.setDate(sevenDaysBeforeEvent.getDate() - 7);

  if (now.getTime() > sevenDaysBeforeEvent.getTime()) {
    // Short notice: 48 hours from now, capped at event start
    const shortNoticeExpiry = new Date(now);
    shortNoticeExpiry.setDate(shortNoticeExpiry.getDate() + SHORT_NOTICE_HOLD_DAYS);
    return shortNoticeExpiry.getTime() > eventDate.getTime() ? eventDate : shortNoticeExpiry;
  }

  // Normal: 14 days from now, capped at 7 days before event
  const standardExpiry = new Date(now);
  standardExpiry.setDate(standardExpiry.getDate() + STANDARD_HOLD_DAYS);
  return standardExpiry.getTime() > sevenDaysBeforeEvent.getTime() ? sevenDaysBeforeEvent : standardExpiry;
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
  balance_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().or(z.literal('')),
  hold_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().or(z.literal('')),
  status: z.enum(['draft', 'confirmed', 'completed', 'cancelled']).optional()
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

export const STORAGE_TYPES = ['ambient', 'chilled', 'frozen', 'dry', 'other'] as const;

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
  balance_due_date?: string;
  hold_expiry?: string;
  status?: string;
  created_by?: string;
  date_tbd?: boolean;
  items?: BookingItemFormData[];
};

export type UpdatePrivateBookingInput = Partial<CreatePrivateBookingInput> & {
  status?: BookingStatus;
};
