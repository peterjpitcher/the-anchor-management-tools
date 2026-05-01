import {
  getCanonicalDeposit,
  LARGE_GROUP_DEPOSIT_THRESHOLD,
  requiresDeposit,
} from './deposit';

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
  seated_at?: string | null;
  left_at?: string | null;
  no_show_at?: string | null;
  payment_status?: string | null;
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
  if (status === 'pending_payment' || paymentStatus === 'pending') return 'pending_payment';

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

export function getTableBookingStatusBadgeClasses(state: string | null | undefined): string {
  switch (state) {
    case 'private_block':
      return 'bg-slate-200 text-slate-800 border-slate-300';
    case 'confirmed':
    case 'pending':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'seated':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'pending_payment':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'left':
    case 'completed':
      return 'bg-gray-100 text-gray-600 border-gray-200';
    case 'no_show':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'cancelled':
      return 'bg-gray-100 text-gray-500 border-gray-200';
    case 'visited_waiting_for_review':
    case 'review_clicked':
      return 'bg-purple-100 text-purple-900 border-purple-200';
    default:
      return 'bg-gray-100 text-gray-900 border-gray-200';
  }
}

export function getTableBookingStatusBlockClasses(state: string | null | undefined): string {
  switch (state) {
    case 'private_block':
      return 'border-slate-400 bg-slate-300/90 text-slate-900';
    case 'seated':
      return 'border-emerald-300 bg-emerald-200/90 text-emerald-900';
    case 'left':
      return 'border-sky-300 bg-sky-200/90 text-sky-900';
    case 'confirmed':
      return 'border-green-300 bg-green-200/90 text-green-900';
    case 'pending_payment':
      return 'border-amber-300 bg-amber-200/90 text-amber-900';
    case 'no_show':
      return 'border-red-300 bg-red-200/90 text-red-900';
    case 'cancelled':
      return 'border-gray-300 bg-gray-200/90 text-gray-700';
    case 'completed':
      return 'border-blue-300 bg-blue-200/90 text-blue-900';
    case 'visited_waiting_for_review':
    case 'review_clicked':
      return 'border-purple-300 bg-purple-200/90 text-purple-900';
    default:
      return 'border-gray-300 bg-gray-200/90 text-gray-800';
  }
}

export function getTableBookingDepositState(
  booking: TableBookingDepositInput,
): TableBookingDepositState {
  const partySize = Math.max(0, Number(booking.party_size || 0));
  const status = normaliseStatus(booking.status);
  const paymentStatus = normaliseStatus(booking.payment_status);
  const lockedAmount = toNumberOrNull(booking.deposit_amount_locked);
  const storedAmount = toNumberOrNull(booking.deposit_amount);
  const hasStoredAmount = lockedAmount !== null || storedAmount !== null;
  const paid = paymentStatus === 'completed' || Boolean(booking.paypal_deposit_capture_id);
  const pending = status === 'pending_payment' || paymentStatus === 'pending';
  const requiredByPartySize = requiresDeposit(partySize, { depositWaived: false });
  const amount = getCanonicalDeposit(
    {
      party_size: partySize,
      deposit_amount: booking.deposit_amount ?? null,
      deposit_amount_locked: booking.deposit_amount_locked ?? null,
      status: booking.status ?? null,
      payment_status: booking.payment_status ?? null,
      deposit_waived: booking.deposit_waived ?? null,
    },
    partySize,
  );
  const displayAmount = amount > 0 ? amount : lockedAmount ?? storedAmount;

  if (!requiredByPartySize && !pending && !paid && !hasStoredAmount && booking.deposit_waived !== true) {
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
    label: `Deposit required (${LARGE_GROUP_DEPOSIT_THRESHOLD}+ covers)`,
    amount: displayAmount,
    methodLabel: null,
  };
}

export function getPaymentMethodLabel(method: string | null | undefined): string | null {
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

export function getTableBookingDepositBadgeClasses(kind: TableBookingDepositState['kind']): string {
  switch (kind) {
    case 'paid':
      return 'border-green-300 bg-green-50 text-green-800';
    case 'pending':
      return 'border-amber-300 bg-amber-50 text-amber-800';
    case 'required':
      return 'border-blue-300 bg-blue-50 text-blue-800';
    case 'waived':
      return 'border-gray-300 bg-gray-50 text-gray-600';
    default:
      return 'border-gray-200 bg-gray-50 text-gray-500';
  }
}

export function formatGbp(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
