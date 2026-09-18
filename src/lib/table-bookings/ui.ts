import {
  getCanonicalDeposit,
  LARGE_GROUP_DEPOSIT_THRESHOLD,
  requiresDeposit,
} from './deposit';
import { isChristmasBookingType } from './christmas';

export type TableBookingVisualState =
  | 'private_block'
  | 'pending_payment'
  | 'confirmed'
  | 'seated'
  | 'left'
  | 'no_show'
  | 'cancelled'
  | 'completed'
  | 'visited_waiting_for_review'
  | 'review_clicked'
  | 'unknown';

export type TableBookingVisualInput = {
  is_private_block?: boolean | null;
  status?: string | null;
  /** Include this in the select: `'christmas'` bookings always owe a deposit. */
  booking_type?: string | null;
  seated_at?: string | null;
  left_at?: string | null;
  no_show_at?: string | null;
  payment_status?: string | null;
  party_size?: number | null;
  deposit_waived?: boolean | null;
  deposit_amount?: number | string | null;
  deposit_amount_locked?: number | string | null;
  paypal_deposit_capture_id?: string | null;
};

export type TableBookingDepositInput = TableBookingVisualInput & {
  party_size?: number | null;
  deposit_waived?: boolean | null;
  deposit_amount?: number | string | null;
  deposit_amount_locked?: number | string | null;
  payment_method?: string | null;
  paypal_deposit_capture_id?: string | null;
  hold_expires_at?: string | null;
};

export type TableBookingDepositState = {
  kind: 'none' | 'waived' | 'required' | 'pending' | 'paid';
  label: string;
  amount: number | null;
  methodLabel: string | null;
};

function normaliseStatus(value: string | null | undefined): string {
  return (value || '').toLowerCase();
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasPendingRequiredDepositSignal(booking: TableBookingVisualInput): boolean {
  const status = normaliseStatus(booking.status);
  const paymentStatus = normaliseStatus(booking.payment_status);

  if (status === 'pending_payment') return true;
  if (paymentStatus !== 'pending') return false;
  if (booking.deposit_waived === true || booking.paypal_deposit_capture_id) return false;

  if (booking.party_size !== null && booking.party_size !== undefined) {
    const partySize = Math.max(0, Number(booking.party_size || 0));
    return requiresDeposit(partySize, {
      isChristmas: isChristmasBookingType(booking.booking_type),
    });
  }

  const storedAmount = toNumberOrNull(booking.deposit_amount);
  const lockedAmount = toNumberOrNull(booking.deposit_amount_locked);
  if ((storedAmount ?? lockedAmount ?? 0) > 0) return true;

  // Backwards-compatible fallback for callers that only loaded payment_status.
  return true;
}

export function getTableBookingVisualState(
  booking: TableBookingVisualInput,
): TableBookingVisualState {
  const status = normaliseStatus(booking.status);
  const paymentStatus = normaliseStatus(booking.payment_status);

  if (booking.is_private_block || status === 'private_block') return 'private_block';
  if (status === 'no_show' || booking.no_show_at) return 'no_show';
  if (status === 'cancelled') return 'cancelled';
  if (booking.left_at) return 'left';
  if (booking.seated_at) return 'seated';
  if (hasPendingRequiredDepositSignal(booking)) return 'pending_payment';

  switch (status) {
    case 'confirmed':
      return 'confirmed';
    case 'completed':
      return 'completed';
    case 'visited_waiting_for_review':
      return 'visited_waiting_for_review';
    case 'review_clicked':
      return 'review_clicked';
    default:
      return 'unknown';
  }
}

export function getTableBookingStatusLabel(state: string | null | undefined): string {
  switch (state) {
    case 'private_block':
      return 'Private block';
    case 'pending_payment':
      return 'Pending payment';
    case 'confirmed':
      return 'Booked';
    case 'seated':
      return 'Seated';
    case 'left':
      return 'Left';
    case 'no_show':
      return 'No-show';
    case 'cancelled':
      return 'Cancelled';
    case 'completed':
      return 'Completed';
    case 'visited_waiting_for_review':
      return 'Visited waiting for review';
    case 'review_clicked':
      return 'Review clicked';
    default:
      return state
        ? state
            .split('_')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ')
        : 'Unknown';
  }
}

type TableBookingStatusTone =
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'neutral'
  | 'cat-2'
  | 'cat-3';

/**
 * The one colour decision for a booking's status (owner decision D4, 18 September 2026):
 * Booked is primary, Seated success, Pending payment warning, No-show danger, and Cancelled,
 * Left and Completed neutral. The review states and private blocks carry no status meaning, so
 * they take category colours. Badges and FOH timeline blocks both read this map, so a booking
 * is the same colour on every screen. Any state not listed here is neutral.
 */
export const TABLE_BOOKING_STATUS_TONE: Record<string, TableBookingStatusTone> = {
  confirmed: 'primary',
  pending: 'primary',
  seated: 'success',
  pending_payment: 'warning',
  no_show: 'danger',
  cancelled: 'neutral',
  left: 'neutral',
  completed: 'neutral',
  visited_waiting_for_review: 'cat-3',
  review_clicked: 'cat-3',
  private_block: 'cat-2',
};

// Full class strings, never built from the tone name: Tailwind only generates classes it can
// read in the source. Badge strings match DS Badge's tones, so a status badge sits beside a DS
// Badge without looking different.
const STATUS_TONE_BADGE_CLASSES: Record<TableBookingStatusTone, string> = {
  primary: 'bg-primary-soft text-primary-soft-fg border-primary/20',
  success: 'bg-success-soft text-success-fg border-success-border',
  warning: 'bg-warning-soft text-warning-fg border-warning-border',
  danger: 'bg-danger-soft text-danger-fg border-danger-border',
  neutral: 'bg-surface-2 text-text-muted border-border',
  'cat-2': 'bg-cat-2-soft text-cat-2-fg border-cat-2/20',
  'cat-3': 'bg-cat-3-soft text-cat-3-fg border-cat-3/20',
};

const STATUS_TONE_BLOCK_CLASSES: Record<TableBookingStatusTone, string> = {
  primary: 'border-primary/40 bg-primary/15 text-primary-soft-fg',
  success: 'border-success/40 bg-success/15 text-success-fg',
  warning: 'border-warning/40 bg-warning/15 text-warning-fg',
  danger: 'border-danger/40 bg-danger/15 text-danger-fg',
  neutral: 'border-border-strong bg-surface-hover text-text-muted',
  'cat-2': 'border-cat-2/40 bg-cat-2/15 text-cat-2-fg',
  'cat-3': 'border-cat-3/40 bg-cat-3/15 text-cat-3-fg',
};

function getTableBookingStatusTone(state: string | null | undefined): TableBookingStatusTone {
  // Own keys only, so a stray state such as "constructor" cannot pick up an Object method.
  if (state && Object.prototype.hasOwnProperty.call(TABLE_BOOKING_STATUS_TONE, state)) {
    return TABLE_BOOKING_STATUS_TONE[state];
  }
  return 'neutral';
}

export function getTableBookingStatusBadgeClasses(state: string | null | undefined): string {
  return STATUS_TONE_BADGE_CLASSES[getTableBookingStatusTone(state)];
}

export function getTableBookingStatusBlockClasses(state: string | null | undefined): string {
  return STATUS_TONE_BLOCK_CLASSES[getTableBookingStatusTone(state)];
}

export function getTableBookingDepositState(
  booking: TableBookingDepositInput,
): TableBookingDepositState {
  const partySize = Math.max(0, Number(booking.party_size || 0));
  const status = normaliseStatus(booking.status);
  const paymentStatus = normaliseStatus(booking.payment_status);
  const lockedAmount = toNumberOrNull(booking.deposit_amount_locked);
  const storedAmount = toNumberOrNull(booking.deposit_amount);
  const paid = paymentStatus === 'completed' || Boolean(booking.paypal_deposit_capture_id);
  const isChristmas = isChristmasBookingType(booking.booking_type);
  const requiredByPartySize = requiresDeposit(partySize, {
    depositWaived: false,
    isChristmas,
  });
  const pending = status === 'pending_payment' || (
    paymentStatus === 'pending' &&
    booking.deposit_waived !== true &&
    requiredByPartySize
  );
  const amount = getCanonicalDeposit(
    {
      party_size: partySize,
      deposit_amount: booking.deposit_amount ?? null,
      deposit_amount_locked: booking.deposit_amount_locked ?? null,
      status: booking.status ?? null,
      payment_status: booking.payment_status ?? null,
      deposit_waived: booking.deposit_waived ?? null,
      booking_type: booking.booking_type ?? null,
    },
    partySize,
  );
  const displayAmount = amount > 0 ? amount : lockedAmount ?? storedAmount;

  if (!requiredByPartySize && !pending && !paid && booking.deposit_waived !== true) {
    return { kind: 'none', label: 'No deposit', amount: null, methodLabel: null };
  }

  if (booking.deposit_waived === true && !paid && !pending) {
    return { kind: 'waived', label: 'Deposit waived', amount: null, methodLabel: null };
  }

  if (paid) {
    return {
      kind: 'paid',
      label: 'Deposit paid',
      amount: displayAmount,
      methodLabel: getPaymentMethodLabel(booking.payment_method),
    };
  }

  if (pending) {
    return {
      kind: 'pending',
      label: 'Outstanding deposit',
      amount: displayAmount,
      methodLabel: null,
    };
  }

  return {
    kind: 'required',
    label: isChristmas
      ? 'Deposit required (Christmas booking)'
      : `Deposit required (${LARGE_GROUP_DEPOSIT_THRESHOLD}+ covers)`,
    amount: displayAmount,
    methodLabel: null,
  };
}

function getPaymentMethodLabel(method: string | null | undefined): string | null {
  switch (normaliseStatus(method)) {
    case 'paypal':
      return 'PayPal';
    case 'cash':
      return 'Cash';
    case 'stripe':
    case 'card':
      return 'Card';
    default:
      return method || null;
  }
}

// Deposit badges use the same DS Badge tones: paid is success, an outstanding deposit is
// warning, a deposit the party size calls for (not yet asked for) is info, and a waived or
// absent deposit is neutral because nothing is owed.
const DEPOSIT_BADGE_CLASSES: Record<TableBookingDepositState['kind'], string> = {
  paid: 'bg-success-soft text-success-fg border-success-border',
  pending: 'bg-warning-soft text-warning-fg border-warning-border',
  required: 'bg-info-soft text-info-fg border-info-border',
  waived: 'bg-surface-2 text-text-muted border-border',
  none: 'bg-surface-2 text-text-muted border-border',
};

export function getTableBookingDepositBadgeClasses(kind: TableBookingDepositState['kind']): string {
  return DEPOSIT_BADGE_CLASSES[kind] ?? DEPOSIT_BADGE_CLASSES.none;
}

export function formatGbp(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
