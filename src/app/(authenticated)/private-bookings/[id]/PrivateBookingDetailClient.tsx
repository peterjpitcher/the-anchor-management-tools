"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDateFull, formatTime12Hour, formatDateTime12Hour, toLondonDateTimeLocalValue, parseLondonDateTimeLocalToIso } from "@/lib/dateUtils";
import { isBookingDateTbd } from "@/lib/private-bookings/tbd-detection";
import { DATE_TBD_NOTE } from "@/services/private-bookings/types";
import {
  DndContext,
  type DragEndEvent,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  getPrivateBooking,
  updateBookingStatus,
  recordDepositPayment,
  recordFinalPayment,
  addBookingItem,
  updateBookingItem,
  deleteBookingItem,
  reorderBookingItems,
  getVenueSpaces,
  getCateringPackages,
  getVendors,
  applyBookingDiscount,
  cancelPrivateBooking,
  addPrivateBookingNote,
  createDepositPaymentOrder,
  captureDepositPayment,
  resendCalendarInvite,
  getBookingPortalLink,
  sendDepositPaymentLink,
  editPrivateBookingPayment,
  getCancellationPreview,
  getCompletionPreview,
  sendBookingContract,
} from '@/app/actions/privateBookingActions'
import type {
  PrivateBookingWithDetails,
  BookingStatus,
  CateringPackage,
  VenueSpace,
  Vendor,
  PrivateBookingItem,
  PrivateBookingPayment,
  PaymentHistoryEntry,
} from "@/types/private-bookings";
import PaymentHistoryTable from './PaymentHistoryTable'
import { ConfirmDepositPanel } from './ConfirmDepositPanel'
// Design system components
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  DescriptionList,
  Dropdown,
  DropdownItem,
  Empty,
  Field,
  Fieldset,
  FormFooter,
  Icon,
  IconButton,
  Input,
  LinkButton,
  Modal,
  PageLayout,
  Radio,
  Segmented,
  Select,
  Spinner,
  Textarea,
  toast,
} from '@/ds'
import { InvoiceBookingModal } from './InvoiceBookingModal'
import {
  generatePrivateBookingInvoice,
  previewPrivateBookingInvoice,
  retryPrivateBookingInvoiceEmail,
  cancelPrivateBookingInvoice,
  type DepositTreatment,
  type PrivateBookingInvoicePreview,
} from '@/app/actions/privateBookingInvoice'
import { RefundDialog } from '@/components/features/invoices/RefundDialog'
import { RefundHistoryTable } from '@/components/features/invoices/RefundHistoryTable'
import {
  RecordLockBanner,
  RecordLockControl,
  WaiverRiskPanel,
  SuppliersPanel,
  DeductionsPanel,
  ComplaintsPanel,
} from '@/components/private-bookings/WorkflowPanels'
import { formatCurrency } from '@/lib/format'
import { computeBookingMoney } from '@/lib/private-bookings/vat'
import { PrivateBookingBilling } from '@/components/private-bookings/PrivateBookingBilling'
import { PrivateBookingReceiptPanel } from '@/components/private-bookings/PrivateBookingReceiptPanel'
import {
  CANCELLATION_OUTCOME_TONE,
  privateBookingPaymentTextClass,
  privateBookingPaymentTone,
  privateBookingStatusLabel,
  privateBookingStatusTone,
  type CancellationOutcome,
  type PrivateBookingPaymentState,
} from '../_shared/status-ui'
import { PB_BACK_TO_LIST, PB_DETAIL_NAV, privateBookingContractHref } from '../_shared/nav'

// Status labels. Colours come from the shared private booking status map.
const statusConfig: Record<BookingStatus, { label: string }> = {
  draft: { label: "Draft" },
  confirmed: { label: "Confirmed" },
  completed: { label: "Completed" },
  cancelled: { label: "Cancelled" },
};

const PAYMENT_METHODS = [
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "invoice", label: "Invoice" },
] as const;

const ITEM_TYPE_OPTIONS = [
  { id: "space", label: "Space" },
  { id: "catering", label: "Catering" },
  { id: "vendor", label: "Vendor" },
  { id: "electricity", label: "Electricity" },
  { id: "other", label: "Other" },
];

const DISCOUNT_TYPE_OPTIONS = [
  { id: "percent", label: "Percentage" },
  { id: "fixed", label: "Fixed Amount" },
];

/**
 * The old compat Form caught a server action that threw (a dropped connection) and showed the
 * error. The native forms here keep that: the error reaches the user as a toast.
 */
function withSubmitErrorToast(
  handler: (event: React.FormEvent<HTMLFormElement>) => Promise<void>,
): (event: React.FormEvent<HTMLFormElement>) => void {
  return (event) => {
    event.preventDefault();
    handler(event).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "An unexpected error occurred");
    });
  };
}

const NOTE_MAX_LENGTH = 2000;

interface PrivateBookingDetailClientProps {
  bookingId: string;
  initialBooking: PrivateBookingWithDetails | null;
  permissions: {
    canEdit: boolean;
    canDelete: boolean;
    canManageDeposits: boolean;
    canSendSms: boolean;
    canManageSpaces: boolean;
    canManageCatering: boolean;
    canManageVendors: boolean;
    canEditPayments: boolean;
    canRefund: boolean;
    /** Invoicing is super_admin only; the server action re-checks it. */
    canInvoice: boolean;
    canViewPricing?: boolean;
  };
  paymentHistory: PaymentHistoryEntry[];
  /**
   * Set by the page while private_booking_deposit_confirmation is on: whether the deposit is still
   * to be confirmed, and the deadline confirming it would set.
   */
  depositConfirmation?: { awaiting: boolean; holdExpiryPreview: string | null };
  initialError?: string | null;
}

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  if (value === null || value === undefined) {
    return fallback
  }
  return fallback
};

const normalizeItem = (item: PrivateBookingItem): PrivateBookingItem => {
  const discountValue = item.discount_value === null || item.discount_value === undefined
    ? undefined
    : toNumber(item.discount_value);

  return {
    ...item,
    quantity: toNumber(item.quantity),
    unit_price: toNumber(item.unit_price),
    discount_value: discountValue,
    line_total: toNumber(item.line_total),
    display_order: item.display_order === null || item.display_order === undefined
      ? undefined
      : toNumber(item.display_order)
  };
};

const normalizeBooking = (booking: PrivateBookingWithDetails): PrivateBookingWithDetails => {
  const guestCount = booking.guest_count === null || booking.guest_count === undefined
    ? undefined
    : toNumber(booking.guest_count);

  const discountAmount = booking.discount_amount === null || booking.discount_amount === undefined
    ? undefined
    : toNumber(booking.discount_amount);

  const calculatedTotal = booking.calculated_total === null || booking.calculated_total === undefined
    ? undefined
    : toNumber(booking.calculated_total);

  return {
    ...booking,
    guest_count: guestCount,
    deposit_amount: toNumber(booking.deposit_amount),
    total_amount: toNumber(booking.total_amount),
    discount_amount: discountAmount,
    calculated_total: calculatedTotal,
    end_time_next_day: booking.end_time_next_day ?? false,
    items: booking.items
      ?.map(normalizeItem)
      ?.sort((a, b) => {
        const orderA = a.display_order ?? 0;
        const orderB = b.display_order ?? 0;
        if (orderA === orderB) {
          return (a.created_at || '').localeCompare(b.created_at || '');
        }
        return orderA - orderB;
      }),
    audit_trail: booking.audit_trail ?? [],
  };
};

const formatMoney = (value: unknown): string => formatCurrency(toNumber(value));

const formatEndTime = (booking: PrivateBookingWithDetails): string => {
  if (!booking.end_time) {
    return 'TBC';
  }

  const formatted = formatTime12Hour(booking.end_time);
  return booking.end_time_next_day ? `${formatted} (+1 day)` : formatted;
};

// Payment Modal Component
interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  type: "deposit" | "final";
  amount: number;
  maxAmount?: number;
  onSuccess: () => void;
}

function PaymentModal({
  open: isOpen,
  onClose,
  bookingId,
  type,
  amount,
  maxAmount,
  onSuccess,
}: PaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "card" | "invoice"
  >("card");
  const [customAmount, setCustomAmount] = useState(amount.toFixed(2));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCustomAmount(Number.isFinite(amount) ? amount.toFixed(2) : "0.00");
    setAmountError(null);
  }, [amount, isOpen]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomAmount(e.target.value);
    setAmountError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (type === "final") {
      const parsed = parseFloat(customAmount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setAmountError("Please enter a valid amount greater than £0.");
        return;
      }
      if (maxAmount !== undefined && parsed > maxAmount + 0.005) {
        setAmountError(`Amount cannot exceed the remaining balance of £${maxAmount.toFixed(2)}.`);
        return;
      }
    }

    setIsSubmitting(true);

    const formData = new FormData();
    formData.set("payment_method", paymentMethod);
    formData.set("amount", customAmount);

    const result =
      type === "deposit"
        ? await recordDepositPayment(bookingId, formData)
        : await recordFinalPayment(bookingId, formData);

    if (result.success) {
      onSuccess();
      onClose();
    } else {
      toast.error(result.error ?? "Failed to record the payment.");
    }
    setIsSubmitting(false);
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Record Payment"
      description={type === "deposit" ? "The booking's deposit" : "Towards the remaining balance"}
      footer={
        <>
          <Button type="button" onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button type="submit" form={`record-payment-${type}`} variant="primary" loading={isSubmitting}>
            Record Payment
          </Button>
        </>
      }
    >
      <form id={`record-payment-${type}`} onSubmit={withSubmitErrorToast(handleSubmit)} className="space-y-4">
        {type === "deposit" ? (
          // The deposit is fixed, so the amount is shown in a read-only field rather than typed.
          <Input
            label="Payment Amount (£)"
            value={Number(customAmount).toFixed(2)}
            readOnly
            hint="Deposit amount is fixed and cannot be changed."
          />
        ) : (
          <Input
            label="Payment Amount (£)"
            type="number"
            value={customAmount}
            onChange={handleAmountChange}
            step="0.01"
            min="0.01"
            max={maxAmount !== undefined ? maxAmount.toFixed(2) : undefined}
            required
            error={amountError ?? undefined}
            hint={
              maxAmount !== undefined
                ? `Remaining balance: £${maxAmount.toFixed(2)}. You may record a partial payment.`
                : undefined
            }
          />
        )}

        <Fieldset legend="Payment Method">
          {PAYMENT_METHODS.map((method) => (
            <Radio
              key={method.value}
              name={`payment-method-${type}`}
              value={method.value}
              label={method.label}
              checked={paymentMethod === method.value}
              onChange={(value) =>
                setPaymentMethod(value as "cash" | "card" | "invoice")
              }
            />
          ))}
        </Fieldset>
      </form>
    </Modal>
  );
}

interface SortableBookingItemProps {
  item: PrivateBookingItem
  getItemIcon: (type: string) => ReactNode
  onEdit: (item: PrivateBookingItem) => void
  onDelete: (itemId: string) => void
  formatMoney: (value: unknown) => string
  canEdit: boolean
}

function SortableBookingItem({
  item,
  getItemIcon,
  onEdit,
  onDelete,
  formatMoney,
  canEdit,
}: SortableBookingItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !canEdit })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    touchAction: 'manipulation' as const,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start justify-between border-b border-border pb-4 last:border-0 ${
        isDragging ? 'bg-surface shadow-default rounded-default' : ''
      }`}
    >
      <div className="flex items-start space-x-3 flex-1">
        {canEdit && (
          <IconButton
            type="button"
            size="sm"
            label="Reorder booking item"
            icon={<Icon name="menu" size={20} />}
            className="text-text-muted cursor-grab active:cursor-grabbing"
            {...attributes}
            {...listeners}
          />
        )}
        <div className="text-text-subtle pt-1">
          {getItemIcon(item.item_type)}
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text">
            {item.description}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
            <span>Qty: {item.quantity}</span>
            <span>{formatMoney(item.unit_price)} each</span>
            {!!item.discount_value && item.discount_value > 0 && (
              <>
                <span className="text-success-fg">
                  -
                  {item.discount_type === 'percent'
                    ? `${item.discount_value}%`
                    : `${formatMoney(item.discount_value)}`}
                </span>
                {item.discount_value === 100 && item.discount_type === 'percent' && (
                  <span className="text-text-soft line-through">
                    (was {formatMoney(item.quantity * item.unit_price)})
                  </span>
                )}
              </>
            )}
          </div>
          {item.notes && (
            <p className="mt-1 text-sm text-text-muted">
              {item.notes}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <span className="text-base font-semibold text-text">
          {formatMoney(item.line_total)}
        </span>
        {canEdit && (
          <>
            <IconButton
              onClick={() => onEdit(item)}
              size="sm"
              label="Edit item"
              title="Edit item"
              type="button"
              icon={<Icon name="edit" size={16} />}
              className="text-text-muted"
            />
            <IconButton
              onClick={() => onDelete(item.id)}
              size="sm"
              label="Delete item"
              title="Delete item"
              type="button"
              icon={<Icon name="trash" size={16} />}
              className="text-danger hover:text-danger-fg"
            />
          </>
        )}
      </div>
    </div>
  )
}

// Status Change Modal Component
interface StatusModalProps {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  currentStatus: BookingStatus;
  onSuccess: () => void;
}

type CancellationPreview = {
  // The outcomes, and their badge colours, are named in the shared status-ui file.
  outcome: CancellationOutcome | null;
  refund_amount: number;
  retained_amount: number;
  deposit_deduction: number;
  max_retainable: number;
  preview_body: string | null;
  error?: string;
};

const CANCELLATION_OUTCOME_LABEL: Record<
  NonNullable<CancellationPreview['outcome']>,
  string
> = {
  no_money: 'No money changed hands',
  refundable: 'Balance refundable (deposit retained)',
  deposit_partial_refund: 'Deposit refundable less 5% admin deduction',
  gm_review_required: "Less than 30 days' notice: manager decides deposit retention",
  manual_review: 'Manual review',
};

const getCancellationOutcomeLabel = (preview: CancellationPreview): string => {
  if (!preview.outcome) return '';
  if (preview.outcome === 'gm_review_required') {
    return `Less than 30 days' notice: manager decides deposit retention (up to ${formatCurrency(preview.max_retainable)})`;
  }
  return CANCELLATION_OUTCOME_LABEL[preview.outcome];
};

function StatusModal({
  open: isOpen,
  onClose,
  bookingId,
  currentStatus,
  onSuccess,
}: StatusModalProps) {
  const [newStatus, setNewStatus] = useState<BookingStatus>(currentStatus);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancelPreview, setCancelPreview] =
    useState<CancellationPreview | null>(null);
  const [completePreview, setCompletePreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // SOP §14: <30 days with a paid deposit, the manager decides how much of
  // the deposit (0..max_retainable) to retain, with a recorded reason.
  const [retainedAmountStr, setRetainedAmountStr] = useState('');
  const [retentionReason, setRetentionReason] = useState('');
  const [retentionSeeded, setRetentionSeeded] = useState(false);
  // SOP §14: capture how the cancellation reached us. A phone call alone is
  // not written cancellation, so record the channel and when it was received.
  const [cancelChannel, setCancelChannel] = useState<
    'email' | 'whatsapp' | 'text' | 'phone' | 'in_person' | 'other'
  >('email');
  const [cancelReceivedAt, setCancelReceivedAt] = useState('');

  // Reset state when modal opens / changes booking.
  useEffect(() => {
    if (isOpen) {
      setNewStatus(currentStatus);
      setCancelPreview(null);
      setCompletePreview(null);
      setPreviewLoading(false);
      setIsSubmitting(false);
      setRetainedAmountStr('');
      setRetentionReason('');
      setRetentionSeeded(false);
      setCancelChannel('email');
      setCancelReceivedAt(toLondonDateTimeLocalValue(new Date()));
    }
  }, [isOpen, currentStatus]);

  // Fetch preview body whenever the admin selects cancel / complete.
  useEffect(() => {
    let active = true;

    async function loadPreview() {
      if (!isOpen) return;

      if (newStatus === 'cancelled' && currentStatus !== 'cancelled') {
        setPreviewLoading(true);
        const preview = await getCancellationPreview(bookingId);
        if (!active) return;
        setCancelPreview(preview);
        if (preview.outcome === 'gm_review_required') {
          // Default the retention to the maximum; the manager can reduce it.
          setRetainedAmountStr((prev) =>
            prev === '' ? preview.max_retainable.toFixed(2) : prev,
          );
          setRetentionSeeded(true);
        }
        setPreviewLoading(false);
      } else if (newStatus === 'completed' && currentStatus !== 'completed') {
        setPreviewLoading(true);
        const preview = await getCompletionPreview(bookingId);
        if (!active) return;
        setCompletePreview(preview.preview_body);
        setPreviewLoading(false);
      } else {
        setCancelPreview(null);
        setCompletePreview(null);
      }
    }

    void loadPreview();
    return () => {
      active = false;
    };
  }, [newStatus, isOpen, bookingId, currentStatus]);

  // Live-update the SMS preview as the manager adjusts the retained amount.
  useEffect(() => {
    if (!isOpen || !retentionSeeded) return;
    if (newStatus !== 'cancelled') return;
    const parsed = Number(retainedAmountStr);
    if (!Number.isFinite(parsed) || parsed < 0) return;

    const handle = setTimeout(async () => {
      const preview = await getCancellationPreview(bookingId, {
        retainedAmount: parsed,
      });
      setCancelPreview(preview);
    }, 400);
    return () => clearTimeout(handle);
  }, [retainedAmountStr, retentionSeeded, isOpen, newStatus, bookingId]);

  const handleSubmit = async () => {
    let retention: { retainedAmount: number; reason: string } | null = null;
    if (
      newStatus === 'cancelled' &&
      cancelPreview?.outcome === 'gm_review_required'
    ) {
      const parsed = Number(retainedAmountStr);
      const max = cancelPreview.max_retainable;
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
        toast.error(
          `Retained amount must be between £0 and £${max.toFixed(2)}`,
        );
        return;
      }
      if (parsed > 0 && !retentionReason.trim()) {
        toast.error(
          'Please record the reason for retaining part or all of the deposit',
        );
        return;
      }
      retention = { retainedAmount: parsed, reason: retentionReason.trim() };
    }

    // SOP §14: record how and when the cancellation reached us.
    const capture =
      newStatus === 'cancelled'
        ? {
            channel: cancelChannel,
            receivedAt: parseLondonDateTimeLocalToIso(cancelReceivedAt) ?? undefined,
          }
        : null;

    setIsSubmitting(true);
    // Cancellations go through the dedicated cancel action so the manager's
    // retention decision (SOP §14) reaches the service layer.
    const result =
      newStatus === 'cancelled'
        ? await cancelPrivateBooking(bookingId, undefined, retention, capture)
        : await updateBookingStatus(bookingId, newStatus);
    if ('success' in result && result.success) {
      onSuccess();
      onClose();
    } else if ('error' in result && result.error) {
      toast.error(result.error);
    }
    setIsSubmitting(false);
  };

  const statusFlow: Record<BookingStatus, BookingStatus[]> = {
    draft: ["confirmed", "cancelled"],
    confirmed: ["completed", "cancelled"],
    completed: [],
    cancelled: ["draft"],
  };

  const availableStatuses = statusFlow[currentStatus] || [];

  const showCancelPreview =
    newStatus === 'cancelled' && currentStatus !== 'cancelled';
  const showCompletePreview =
    newStatus === 'completed' && currentStatus !== 'completed';
  const isDestructive = newStatus === 'cancelled';

  // The customer message each choice sends is previewed in the dialog, so the button names only
  // the action. Next to Cancel Booking the dismiss button is Keep Booking, never a second Cancel.
  const confirmLabel = newStatus === 'cancelled'
    ? 'Cancel Booking'
    : newStatus === 'completed'
      ? 'Mark as Complete'
      : 'Change Status';

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Change Status"
      mobileFullscreen
      footer={
        availableStatuses.length > 0 ? (
          <>
            <Button type="button" onClick={onClose} variant="secondary">
              {isDestructive ? 'Keep Booking' : 'Cancel'}
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={newStatus === currentStatus}
              loading={isSubmitting}
              variant={isDestructive ? 'danger' : 'primary'}
            >
              {confirmLabel}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={onClose} variant="secondary">
            Close
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-sm text-text-muted">Current status:</p>
          <div className="flex items-center mt-1">
            <Badge tone={privateBookingStatusTone(currentStatus)}>
              {statusConfig[currentStatus].label}
            </Badge>
          </div>
        </div>

        {availableStatuses.length > 0 ? (
          <>
            <Fieldset legend="Change To">
              {availableStatuses.map((status) => (
                <Radio
                  key={status}
                  name="new-booking-status"
                  value={status}
                  label={statusConfig[status].label}
                  description={
                    status === "confirmed"
                      ? "Customer will receive confirmation SMS"
                      : undefined
                  }
                  checked={newStatus === status}
                  onChange={(value) => setNewStatus(value as BookingStatus)}
                  className="rounded-default border border-border p-3"
                />
              ))}
            </Fieldset>

            {showCancelPreview && (
              <>
                {/* The alert only reports the outcome; the questions it raises sit below it, so no
                    form field is inside a live region. */}
                <Alert tone="danger" title="Cancel Booking" role="status">
                  {previewLoading ? (
                    <div className="flex items-center gap-2">
                      <Spinner size="sm" />
                      Computing outcome…
                    </div>
                  ) : cancelPreview?.error ? (
                    <p>{cancelPreview.error}</p>
                  ) : cancelPreview ? (
                    <div className="space-y-3">
                      {cancelPreview.outcome && (
                        <div className="flex items-center gap-2">
                          <Badge
                            tone={
                              CANCELLATION_OUTCOME_TONE[cancelPreview.outcome]
                            }
                          >
                            {getCancellationOutcomeLabel(cancelPreview)}
                          </Badge>
                        </div>
                      )}
                      {cancelPreview.refund_amount > 0 && (
                        <p className="text-sm text-text">
                          Refund:{' '}
                          <strong>
                            {formatCurrency(cancelPreview.refund_amount)}
                          </strong>{' '}
                          within 10 working days
                        </p>
                      )}
                      {cancelPreview.retained_amount > 0 && (
                        <p className="text-sm text-text">
                          Retained:{' '}
                          <strong>
                            {formatCurrency(cancelPreview.retained_amount)}
                          </strong>
                        </p>
                      )}
                    </div>
                  ) : null}
                </Alert>

                {!previewLoading && cancelPreview && !cancelPreview.error && (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field
                        label="How was the cancellation received?"
                        hint="A phone call on its own is not a written cancellation: ask the customer to confirm in writing where you can."
                      >
                        <Select
                          value={cancelChannel}
                          onChange={(e) =>
                            setCancelChannel(
                              e.target.value as
                                | 'email'
                                | 'whatsapp'
                                | 'text'
                                | 'phone'
                                | 'in_person'
                                | 'other',
                            )
                          }
                          disabled={isSubmitting}
                          options={[
                            { value: 'email', label: 'Email' },
                            { value: 'whatsapp', label: 'WhatsApp' },
                            { value: 'text', label: 'Text' },
                            { value: 'phone', label: 'Phone' },
                            { value: 'in_person', label: 'In person' },
                            { value: 'other', label: 'Other' },
                          ]}
                        />
                      </Field>
                      <Field label="Received at">
                        <Input
                          type="datetime-local"
                          value={cancelReceivedAt}
                          onChange={(e) => setCancelReceivedAt(e.target.value)}
                          disabled={isSubmitting}
                        />
                      </Field>
                    </div>
                    {cancelPreview.outcome === 'gm_review_required' && (
                      <>
                        <Field
                          label="Deposit to retain (£)"
                          hint={`Manager decision: up to ${formatCurrency(cancelPreview.max_retainable)} of the paid deposit. Retaining anything requires manager permission.`}
                        >
                          <Input
                            type="number"
                            min="0"
                            max={cancelPreview.max_retainable.toFixed(2)}
                            step="0.01"
                            value={retainedAmountStr}
                            onChange={(e) => setRetainedAmountStr(e.target.value)}
                            disabled={isSubmitting}
                          />
                        </Field>
                        {Number(retainedAmountStr) > 0 && (
                          <Field label="Reason for retaining the deposit">
                            <Textarea
                              value={retentionReason}
                              onChange={(e) => setRetentionReason(e.target.value)}
                              rows={2}
                              required
                              disabled={isSubmitting}
                              placeholder="Required when retaining any of the deposit"
                            />
                          </Field>
                        )}
                      </>
                    )}
                    {cancelPreview.preview_body && (
                      <div>
                        <p className="text-xs font-medium text-text-muted mb-1">
                          Customer will receive:
                        </p>
                        <pre className="whitespace-pre-wrap rounded-sm border border-border bg-surface p-3 text-sm text-text">
                          {cancelPreview.preview_body}
                        </pre>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {showCompletePreview && (
              <Alert tone="info" title="Mark as Complete" role="status">
                <div className="space-y-3">
                {previewLoading ? (
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    Loading preview…
                  </div>
                ) : completePreview ? (
                  <div>
                    <p className="text-xs font-medium text-text-muted mb-1">
                      Customer will receive:
                    </p>
                    <pre className="whitespace-pre-wrap rounded-sm border border-border bg-surface p-3 text-sm text-text">
                      {completePreview}
                    </pre>
                  </div>
                ) : null}
                <p className="text-xs text-text-muted">
                  A separate decision email about Google reviews will be sent
                  to the manager the following morning.
                </p>
                </div>
              </Alert>
            )}

          </>
        ) : (
          <Empty
            size="sm"
            title="No status changes available"
            description="A completed booking cannot change status."
          />
        )}
      </div>
    </Modal>
  );
}

// Add Item Modal Component
interface AddItemModalProps {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  onItemAdded: () => void;
}

function AddItemModal({
  open: isOpen,
  onClose,
  bookingId,
  onItemAdded,
}: AddItemModalProps) {
  const [itemType, setItemType] = useState<
    "space" | "catering" | "vendor" | "electricity" | "other"
  >("space");
  const [spaces, setSpaces] = useState<VenueSpace[]>([]);
  const [packages, setPackages] = useState<CateringPackage[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedItem, setSelectedItem] = useState<
    VenueSpace | CateringPackage | Vendor | null
  >(null);
  const [quantity, setQuantity] = useState("1");
  const [customDescription, setCustomDescription] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(
    "percent",
  );
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Reset form when item type changes
    setSelectedItem(null);
    setCustomDescription("");
    setCustomPrice("");
    setDiscountAmount("");
    setNotes("");

    // Reset quantity for all except electricity (which is always 1)
    if (itemType !== "electricity") {
      setQuantity("1");
    }

    loadOptions();
  }, [itemType]);

  // Set quantity to 1 for total_value items
  useEffect(() => {
    if (
      itemType === "catering" &&
      selectedItem &&
      "pricing_model" in selectedItem &&
      selectedItem.pricing_model === "total_value"
    ) {
      setQuantity("1");
    }
  }, [selectedItem, itemType]);

  const loadOptions = useCallback(async () => {
    if (itemType === "space") {
      const result = await getVenueSpaces();
      if (result.data) setSpaces(result.data);
    } else if (itemType === "catering") {
      const result = await getCateringPackages();
      if (result.data) setPackages(result.data);
    } else if (itemType === "vendor") {
      const result = await getVendors();
      if (result.data) setVendors(result.data);
    } else if (itemType === "electricity") {
      // Electricity is a fixed charge, no options to load
      setCustomDescription("Additional Electricity Supply");
      setCustomPrice("25");
      setQuantity("1");
    }
  }, [itemType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const hasCustomPrice = customPrice.trim() !== "";
    let description = customDescription;
    let unitPrice = hasCustomPrice ? parseFloat(customPrice) || 0 : 0;

    if (itemType === "electricity") {
      // Electricity has fixed values
      description = "Additional Electricity Supply";
      unitPrice = 25;
    } else if (itemType !== "other" && selectedItem) {
      if (itemType === "space" && "rate_per_hour" in selectedItem) {
        description = selectedItem.name;
        unitPrice = selectedItem.rate_per_hour;
      } else if (itemType === "catering" && "cost_per_head" in selectedItem) {
        description = selectedItem.name;
        // For total_value items, use the custom price entered by the user
        if (
          "pricing_model" in selectedItem &&
          selectedItem.pricing_model === "total_value"
        ) {
          unitPrice = parseFloat(customPrice) || selectedItem.cost_per_head;
        } else {
          unitPrice = selectedItem.cost_per_head;
        }
      } else if (itemType === "vendor" && "service_type" in selectedItem) {
        description = `${selectedItem.name} (${selectedItem.service_type})`;
        // The Unit Price field is required for vendor items, so only fall back to
        // the vendor's typical rate when the user left it blank. Overwriting it
        // with 0 here silently discarded the price they were made to type.
        if (!hasCustomPrice) {
          const typicalRate =
            "typical_rate_normalized" in selectedItem
              ? selectedItem.typical_rate_normalized
              : undefined;
          unitPrice = parseFloat(String(typicalRate ?? selectedItem.typical_rate ?? "")) || 0;
        }
      }
    }

    const parsedQuantity = Number.parseFloat(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      toast.error("Quantity must be greater than 0");
      setIsSubmitting(false);
      return;
    }

    // For total_value pricing model, quantity should be 1
    const finalQuantity =
      itemType === "catering" &&
      selectedItem &&
      "pricing_model" in selectedItem &&
      selectedItem.pricing_model === "total_value"
        ? 1
        : parsedQuantity;

    const data = {
      booking_id: bookingId,
      item_type: itemType === "electricity" ? "other" : itemType, // Store electricity as 'other' type
      space_id: itemType === "space" ? selectedItem?.id : null,
      package_id: itemType === "catering" ? selectedItem?.id : null,
      vendor_id: itemType === "vendor" ? selectedItem?.id : null,
      description,
      quantity: finalQuantity,
      unit_price: unitPrice,
      discount_value: discountAmount ? parseFloat(discountAmount) : undefined,
      discount_type: discountAmount ? discountType : undefined,
      notes: notes || null,
    };

    const result = await addBookingItem(data);

    if (result.success) {
      onItemAdded();
      onClose();
      // Reset form
      setSelectedItem(null);
      setQuantity("1");
      setCustomDescription("");
      setCustomPrice("");
      setDiscountAmount("");
      setNotes("");
    } else {
      toast.error(result.error ?? "Failed to add the item.");
    }

    setIsSubmitting(false);
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Add Item"
      size="lg"
      footer={
        <>
          <Button type="button" onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button type="submit" form="pb-add-item-form" variant="primary" loading={isSubmitting}>
            Add Item
          </Button>
        </>
      }
    >
      <form id="pb-add-item-form" onSubmit={withSubmitErrorToast(handleSubmit)} className="space-y-4">
        {/* Item Type Selection */}
        <Fieldset legend="Item Type">
          <Segmented
            aria-label="Item type"
            options={ITEM_TYPE_OPTIONS}
            value={itemType}
            onChange={(id) =>
              setItemType(id as "space" | "catering" | "vendor" | "electricity" | "other")
            }
            className="flex-wrap"
          />
        </Fieldset>

        {/* Item Selection */}
        {itemType !== "other" && itemType !== "electricity" && (
          <Field
            label={`Select ${itemType === "space" ? "Space" : itemType === "catering" ? "Package" : "Vendor"}`}
          >
            <Select
              value={selectedItem?.id || ""}
              onChange={(e) => {
                const items =
                  itemType === "space"
                    ? spaces
                    : itemType === "catering"
                      ? packages
                      : vendors;
                const item = items.find((i) => i.id === e.target.value);
                setSelectedItem(item || null);
              }}
              required
            >
              <option value="">Select...</option>
              {(itemType === "space"
                ? spaces
                : itemType === "catering"
                  ? packages
                  : vendors
              ).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {itemType === "space" &&
                    "rate_per_hour" in item &&
                    ` (£${item.rate_per_hour}/hr)`}
                  {itemType === "catering" &&
                    "cost_per_head" in item &&
                    (item.pricing_model === "total_value"
                      ? ` (£${item.cost_per_head} total)`
                      : ` (£${item.cost_per_head}/person)`)}
                  {itemType === "vendor" &&
                    "service_type" in item &&
                    item.service_type &&
                    ` - ${item.service_type}`}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {/* Custom Description (for 'other' and 'electricity' items) */}
        {(itemType === "other" || itemType === "electricity") && (
          <Field label="Description">
            <Input
              type="text"
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              required
              readOnly={itemType === "electricity"}
            />
          </Field>
        )}

        {/* Quantity and Price - Different layouts based on pricing model */}
        {itemType === "catering" &&
        selectedItem &&
        "pricing_model" in selectedItem &&
        selectedItem.pricing_model === "total_value" ? (
          // Total Value Layout - Single price field
          <Field label="Total Price (£)">
            <Input
              type="number"
              value={customPrice || selectedItem.cost_per_head || ""}
              onChange={(e) => setCustomPrice(e.target.value)}
              step="0.01"
              min="0"
              required
              placeholder="Enter total price"
            />
          </Field>
        ) : (
          // Standard Layout - Quantity and Unit Price
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label={itemType === "catering" ? "Number of Guests" : "Quantity"}
            >
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                min={itemType === "catering" ? "1" : "0.01"}
                step={itemType === "catering" ? "1" : "0.01"}
                required
                readOnly={itemType === "electricity"}
              />
            </Field>
            <Field label="Unit Price (£)">
              <Input
                type="number"
                value={
                  customPrice ||
                  (selectedItem &&
                    (itemType === "space" && "rate_per_hour" in selectedItem
                      ? selectedItem.rate_per_hour
                      : itemType === "catering" &&
                          "cost_per_head" in selectedItem
                        ? selectedItem.cost_per_head
                        : "")) ||
                  ""
                }
                onChange={(e) => setCustomPrice(e.target.value)}
                step="0.01"
                min="0"
                required={
                  itemType === "other" ||
                  itemType === "vendor" ||
                  itemType === "electricity"
                }
                readOnly={
                  (itemType !== "other" &&
                    itemType !== "vendor" &&
                    !!selectedItem) ||
                  itemType === "electricity"
                }
              />
            </Field>
          </div>
        )}

        {/* Discount */}
        <Fieldset legend="Discount (optional)">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              type="number"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder="Amount"
              aria-label="Discount amount"
              min="0"
              step="0.01"
            />
            <Select
              value={discountType}
              aria-label="Discount type"
              onChange={(e) =>
                setDiscountType(e.target.value as "percent" | "fixed")
              }
            >
              <option value="percent">Percentage (%)</option>
              <option value="fixed">Fixed Amount (£)</option>
            </Select>
          </div>
        </Fieldset>

        {/* Notes */}
        <Field label="Notes (optional)">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </Field>

      </form>
    </Modal>
  );
}

// Discount Modal Component
interface DiscountModalProps {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  currentTotal: number;
  onSuccess: () => void;
}

function DiscountModal({
  open: isOpen,
  onClose,
  bookingId,
  currentTotal,
  onSuccess,
}: DiscountModalProps) {
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(
    "percent",
  );
  const [discountAmount, setDiscountAmount] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const result = await applyBookingDiscount(bookingId, {
      discount_type: discountType,
      discount_amount: parseFloat(discountAmount),
      discount_reason: reason,
    });

    if (result.success) {
      onSuccess();
      onClose();
    } else {
      toast.error(result.error ?? "Failed to apply the discount.");
    }
    setIsSubmitting(false);
  };

  const calculateDiscount = () => {
    if (!discountAmount) return 0;
    const amount = parseFloat(discountAmount);
    return discountType === "percent" ? (currentTotal * amount) / 100 : amount;
  };

  const calculateNewTotal = () => {
    return Math.max(0, currentTotal - calculateDiscount());
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Apply Discount"
      mobileFullscreen
      footer={
        <>
          <Button type="button" onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button
            type="submit"
            form="pb-discount-form"
            variant="primary"
            disabled={!discountAmount}
            loading={isSubmitting}
          >
            Apply Discount
          </Button>
        </>
      }
    >
      <form id="pb-discount-form" onSubmit={withSubmitErrorToast(handleSubmit)} className="space-y-4">
        <Fieldset legend="Discount Type">
          <Segmented
            aria-label="Discount type"
            options={DISCOUNT_TYPE_OPTIONS}
            value={discountType}
            onChange={(id) => setDiscountType(id as "percent" | "fixed")}
          />
        </Fieldset>

        <Field
          label={discountType === "percent" ? "Percentage (%)" : "Amount (£)"}
        >
          <Input
            type="number"
            value={discountAmount}
            onChange={(e) => setDiscountAmount(e.target.value)}
            step="0.01"
            min="0"
            max={discountType === "percent" ? "100" : undefined}
            required
          />
        </Field>

        <Field label="Reason for Discount">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            required
            placeholder="e.g., Early bird discount, loyalty customer, etc."
          />
        </Field>

        {/* Preview */}
        {discountAmount && (
          <div className="bg-surface-2 p-4 rounded-default">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Current Total:</span>
                <span className="font-medium">{formatMoney(currentTotal)}</span>
              </div>
              <div className="flex justify-between text-danger-fg">
                <span>Discount:</span>
                <span className="font-medium">
                  -{formatMoney(calculateDiscount())}
                </span>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <span>New Total:</span>
                <span>{formatMoney(calculateNewTotal())}</span>
              </div>
            </div>
          </div>
        )}

      </form>
    </Modal>
  );
}

// Edit Item Modal
interface EditItemModalProps {
  open: boolean;
  onClose: () => void;
  item: PrivateBookingItem;
  onSuccess: () => void;
}

function EditItemModal({
  open: isOpen,
  onClose,
  item,
  onSuccess,
}: EditItemModalProps) {
  const [quantity, setQuantity] = useState(item.quantity.toString());
  const [unitPrice, setUnitPrice] = useState(item.unit_price.toString());
  const [discountValue, setDiscountValue] = useState(
    item.discount_value?.toString() || "",
  );
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(
    item.discount_type || "percent",
  );
  const [notes, setNotes] = useState(item.notes || "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Reset form when item changes
    setQuantity(item.quantity.toString());
    setUnitPrice(item.unit_price.toString());
    setDiscountValue(item.discount_value?.toString() || "");
    setDiscountType(item.discount_type || "percent");
    setNotes(item.notes || "");
  }, [item]);

  const calculateLineTotal = () => {
    const qty = Number.parseFloat(quantity) || 0;
    const price = parseFloat(unitPrice) || 0;
    const discount = parseFloat(discountValue) || 0;

    let subtotal = qty * price;

    if (discount > 0) {
      if (discountType === "percent") {
        subtotal = subtotal * (1 - discount / 100);
      } else {
        subtotal = Math.max(0, subtotal - discount);
      }
    }

    return subtotal;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const parsedQuantity = Number.parseFloat(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      toast.error("Quantity must be greater than 0");
      setIsSubmitting(false);
      return;
    }

    const result = await updateBookingItem(item.id, {
      quantity: parsedQuantity,
      unit_price: parseFloat(unitPrice),
      discount_value: discountValue ? parseFloat(discountValue) : undefined,
      discount_type: discountValue ? discountType : undefined,
      notes: notes || null,
    });

    setIsSubmitting(false);

    if (result.error) {
      toast.error(`Error: ${result.error}`);
    } else {
      onSuccess();
      onClose();
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Edit Item"
      mobileFullscreen
      footer={
        <>
          <Button type="button" onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button type="submit" form="pb-edit-item-form" variant="primary" loading={isSubmitting}>
            Save Changes
          </Button>
        </>
      }
    >
      <form id="pb-edit-item-form" onSubmit={withSubmitErrorToast(handleSubmit)} className="space-y-4">
        <Input label="Description" value={item.description} readOnly />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Quantity">
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              min={item.item_type === "catering" ? "1" : "0.01"}
              step={item.item_type === "catering" ? "1" : "0.01"}
              required
            />
          </Field>

          <Field label="Unit Price (£)">
            <Input
              type="number"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              min="0"
              step="0.01"
              required
            />
          </Field>
        </div>

        <Fieldset legend="Discount (optional)">
          <div className="flex gap-2">
            <Input
              type="number"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              min="0"
              step={discountType === "percent" ? "1" : "0.01"}
              max={discountType === "percent" ? "100" : undefined}
              placeholder="0"
              aria-label="Discount amount"
              className="flex-1"
            />
            <Select
              value={discountType}
              aria-label="Discount type"
              onChange={(e) =>
                setDiscountType(e.target.value as "percent" | "fixed")
              }
              className="w-20"
            >
              <option value="percent">%</option>
              <option value="fixed">£</option>
            </Select>
          </div>
        </Fieldset>

        <Field label="Notes (optional)">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g., Special pricing agreement, discount reason, etc."
          />
        </Field>

        <div className="bg-surface-2 p-3 rounded-default">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Line Total:</span>
            <span className="font-semibold text-text">
              {formatMoney(calculateLineTotal())}
            </span>
          </div>
        </div>

      </form>
    </Modal>
  );
}

export default function PrivateBookingDetailClient({
  bookingId,
  initialBooking,
  permissions,
  paymentHistory,
  depositConfirmation,
  initialError,
}: PrivateBookingDetailClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [booking, setBooking] = useState<PrivateBookingWithDetails | null>(() =>
    initialBooking ? normalizeBooking(initialBooking) : null,
  );
  const [items, setItems] = useState<PrivateBookingItem[]>(() =>
    (initialBooking?.items || []).map(normalizeItem),
  );
  const [pageError, setPageError] = useState<string | null>(initialError ?? null);
  const [isReordering, setIsReordering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showFinalModal, setShowFinalModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showEditItemModal, setShowEditItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<PrivateBookingItem | null>(
    null,
  );
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [sendingCalendarInvite, setSendingCalendarInvite] = useState(false);
  // SOP §11: contract + terms are emailed to the customer before payment
  const [sendingContract, setSendingContract] = useState(false);
  const [downloadingContract, setDownloadingContract] = useState(false);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoicePreview, setInvoicePreview] = useState<PrivateBookingInvoicePreview | null>(null);
  const [invoicePreviewLoading, setInvoicePreviewLoading] = useState(false);
  const [invoiceSending, setInvoiceSending] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceBlocked, setInvoiceBlocked] = useState(false);
  const [retryingInvoiceEmail, setRetryingInvoiceEmail] = useState(false);
  const [showCancelInvoiceModal, setShowCancelInvoiceModal] = useState(false);
  const [cancelInvoiceReason, setCancelInvoiceReason] = useState('');
  const [cancellingInvoice, setCancellingInvoice] = useState(false);
  // PayPal deposit state
  const [paypalDepositLoading, setPaypalDepositLoading] = useState(false);
  const [paypalCaptureHandled, setPaypalCaptureHandled] = useState(false);
  const [sendingDepositLink, setSendingDepositLink] = useState(false);
  // Inline deposit amount edit state
  const [editingDeposit, setEditingDeposit] = useState(false);
  const [editDepositAmount, setEditDepositAmount] = useState('');
  const [savingDeposit, setSavingDeposit] = useState(false);
  // SOP §12: reducing the deposit below £250 needs a recorded GM reason;
  // £0 needs an explicit GM waiver plus reason.
  const [depositEditReason, setDepositEditReason] = useState('');
  const [depositWaiveConfirmed, setDepositWaiveConfirmed] = useState(false);
  // Share portal link state
  const [isCopyingLink, setIsCopyingLink] = useState(false);
  // SOP workflow panels: bump to force suppliers/deductions/complaints reloads
  const [workflowRefreshKey, setWorkflowRefreshKey] = useState(0);
  const refreshWorkflow = useCallback(() => {
    setWorkflowRefreshKey((key) => key + 1);
    router.refresh();
  }, [router]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!initialBooking) {
      setBooking(null);
      setItems([]);
      return;
    }
    const normalized = normalizeBooking(initialBooking);
    setBooking(normalized);
    setItems(normalized.items || []);
  }, [initialBooking]);

  useEffect(() => {
    setPageError(initialError ?? null);
  }, [initialError]);

  const {
    canEdit,
    canDelete,
    canManageDeposits,
    canManageSpaces,
    canManageCatering,
    canManageVendors,
    canEditPayments,
    canRefund,
    canInvoice,
    canViewPricing,
  } = permissions;

  // Refund dialog state
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [refundTotals, setRefundTotals] = useState({ totalRefunded: 0, totalPending: 0 });

  // Load refund totals when booking changes
  useEffect(() => {
    if (!booking?.id) return;
    let cancelled = false;
    import('@/app/actions/refundActions').then(({ getRefundHistory }) =>
      getRefundHistory('private_booking', booking.id).then((result) => {
        if (cancelled || !result.data) return;
        const completed = result.data
          .filter((r: any) => r.status === 'completed')
          .reduce((sum: number, r: any) => sum + Number(r.amount), 0);
        const pending = result.data
          .filter((r: any) => r.status === 'pending')
          .reduce((sum: number, r: any) => sum + Number(r.amount), 0);
        setRefundTotals({ totalRefunded: completed, totalPending: pending });
      })
    );
    return () => { cancelled = true; };
  }, [booking?.id]);

  const loadBooking = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const result = await getPrivateBooking(id);
        if (result.data) {
          const normalized = normalizeBooking(result.data);
          setBooking(normalized);
          setItems(normalized.items || []);
          setPageError(null);
        } else if (result.error) {
          if (result.error.toLowerCase().includes('permission')) {
            router.push('/unauthorized');
            return;
          }
          toast.error(result.error);
          setPageError(result.error);
          setBooking(null);
          setItems([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!bookingId || initialBooking) {
      return;
    }
    loadBooking(bookingId);
  }, [bookingId, initialBooking, loadBooking]);

  const refreshBooking = useCallback(() => {
    if (!bookingId) {
      return;
    }
    // Full page refresh ensures both booking state AND server-provided
    // paymentHistory prop are updated (loadBooking only refreshes component state)
    router.refresh();
    loadBooking(bookingId);
  }, [bookingId, loadBooking, router]);

  // Handle PayPal return URL: capture the payment when PayPal redirects back
  useEffect(() => {
    const paypalReturn = searchParams.get('paypal_return');
    // PayPal returns the order ID in the 'token' query parameter
    const orderId = searchParams.get('token') || searchParams.get('order_id');

    if (paypalReturn !== 'deposit' || !orderId || paypalCaptureHandled) {
      return;
    }

    setPaypalCaptureHandled(true);

    // Clean URL params immediately to prevent re-runs on navigation
    const cleanUrl = `/private-bookings/${bookingId}`;
    router.replace(cleanUrl, { scroll: false });

    (async () => {
      try {
        const result = await captureDepositPayment(bookingId, orderId);
        if (result.success) {
          toast.success('Deposit payment received successfully.');
          refreshBooking();
        } else {
          toast.error(result.error || 'Failed to confirm deposit payment. Please contact support.');
        }
      } catch (_err) {
        toast.error('An unexpected error occurred confirming your payment. Please contact support.');
      }
    })();
  }, [searchParams]); // intentionally depends only on searchParams: runs once on return from PayPal

  const handlePaypalDeposit = useCallback(async () => {
    if (paypalDepositLoading) return;
    setPaypalDepositLoading(true);
    try {
      const result = await createDepositPaymentOrder(bookingId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.approveUrl) {
        window.location.href = result.approveUrl;
      }
    } catch (_err) {
      toast.error('Failed to create PayPal payment link. Please try again.');
    } finally {
      setPaypalDepositLoading(false);
    }
  }, [bookingId, paypalDepositLoading]);

  const handleSendDepositLink = useCallback(async () => {
    if (sendingDepositLink) return;
    setSendingDepositLink(true);
    try {
      const result = await sendDepositPaymentLink(bookingId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success('Payment link sent to customer');
    } catch (_err) {
      toast.error('Failed to send payment link. Please try again.');
    } finally {
      setSendingDepositLink(false);
    }
  }, [bookingId, sendingDepositLink]);

  const handleSaveDepositAmount = useCallback(async () => {
    if (savingDeposit) return;
    const nextAmount = Number(editDepositAmount);
    const trimmedReason = depositEditReason.trim();
    // SOP §12: reductions below the £250 standard need a recorded reason;
    // £0 needs an explicit GM waiver plus reason.
    if (Number.isFinite(nextAmount) && nextAmount === 0) {
      if (!depositWaiveConfirmed) {
        toast.error('Please confirm the deposit waiver (GM approved)');
        return;
      }
      if (!trimmedReason) {
        toast.error('Please record the reason for waiving the deposit');
        return;
      }
    } else if (Number.isFinite(nextAmount) && nextAmount > 0 && nextAmount < 250 && !trimmedReason) {
      toast.error('Please record the reason for the reduced deposit (GM discretion)');
      return;
    }
    setSavingDeposit(true);
    try {
      const formData = new FormData();
      formData.set('bookingId', bookingId);
      formData.set('type', 'deposit');
      formData.set('amount', editDepositAmount);
      formData.set('method', booking?.deposit_payment_method ?? 'cash');
      if (Number.isFinite(nextAmount) && nextAmount === 0) {
        formData.set('waived', 'true');
        formData.set('waived_reason', trimmedReason);
      } else if (Number.isFinite(nextAmount) && nextAmount > 0 && nextAmount < 250) {
        formData.set('reduction_reason', trimmedReason);
      }
      const result = await editPrivateBookingPayment(formData);
      if (result.success) {
        toast.success(Number.isFinite(nextAmount) && nextAmount <= 0
          ? 'Booking confirmed with no deposit required'
          : 'Deposit amount updated');
        setEditingDeposit(false);
        router.refresh();
      } else {
        toast.error(result.error ?? 'Failed to update deposit amount');
      }
    } catch {
      toast.error('Failed to update deposit amount');
    } finally {
      setSavingDeposit(false);
    }
  }, [bookingId, editDepositAmount, savingDeposit, depositEditReason, depositWaiveConfirmed, booking?.deposit_payment_method, router]);

  const handleAddNote = useCallback(async () => {
    if (addingNote) {
      return;
    }

    const trimmed = noteText.trim();
    if (!trimmed) {
      toast.error('Please enter a note before saving.');
      return;
    }

    if (!bookingId) {
      toast.error('Booking information is missing.');
      return;
    }

    setAddingNote(true);
    try {
      const result = await addPrivateBookingNote(bookingId, trimmed);
      if (result?.error) {
        toast.error(result.error);
        return;
      }

      toast.success('Note added to booking');
      setNoteText('');
      refreshBooking();
    } catch (error) {
      console.error('Error adding booking note:', error);
      toast.error('Failed to save note');
    } finally {
      setAddingNote(false);
    }
  }, [addingNote, bookingId, noteText, refreshBooking]);

  const handleNoteSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await handleAddNote();
    },
    [handleAddNote],
  );

  const handleResendCalendarInvite = useCallback(async () => {
    if (!bookingId || sendingCalendarInvite) return;
    setSendingCalendarInvite(true);
    try {
      const result = await resendCalendarInvite(bookingId);
      if (result.success) {
        toast.success('Calendar invite sent successfully');
      } else {
        toast.error(result.error || 'Failed to send calendar invite');
      }
    } finally {
      setSendingCalendarInvite(false);
    }
  }, [bookingId, sendingCalendarInvite]);

  const handleOpenInvoiceModal = useCallback(async () => {
    if (!bookingId) return;
    setInvoiceModalOpen(true);
    setInvoiceError(null);
    setInvoiceBlocked(false);
    setInvoicePreview(null);
    setInvoicePreviewLoading(true);
    try {
      const result = await previewPrivateBookingInvoice(bookingId);
      if (result.error || !result.preview) {
        setInvoiceError(result.error ?? 'We could not work out the figures for this booking.');
        setInvoiceBlocked(Boolean(result.blocked));
      } else {
        setInvoicePreview(result.preview);
      }
    } finally {
      setInvoicePreviewLoading(false);
    }
  }, [bookingId]);

  const handleConfirmInvoice = useCallback(
    async ({
      depositTreatment,
      reference,
      paypalPaymentsEnabled,
    }: {
      depositTreatment: DepositTreatment;
      reference: string;
      paypalPaymentsEnabled?: boolean;
    }) => {
      if (!bookingId || invoiceSending) return;
      setInvoiceSending(true);
      setInvoiceError(null);
      setInvoiceBlocked(false);
      try {
        const result = await generatePrivateBookingInvoice({
          bookingId,
          depositTreatment,
          reference,
          // Only present on a customer's first invoice, where the dialog asks.
          paypalPaymentsEnabled,
          // Binds this confirmation to the figures that were on screen. If the
          // booking moved underneath the dialog, the send is refused.
          sourceHash: invoicePreview?.sourceHash,
        });

        if (result.error) {
          setInvoiceError(result.error);
          setInvoiceBlocked(Boolean(result.blocked));
          return;
        }

        setInvoiceModalOpen(false);
        if (result.sent) {
          toast.success(`Invoice ${result.invoiceNumber} sent`);
        } else {
          toast.error(
            `Invoice ${result.invoiceNumber} was created but the email did not send. Use Email Invoice.`,
          );
        }
        router.refresh();
      } finally {
        setInvoiceSending(false);
      }
    },
    [bookingId, invoiceSending, invoicePreview, router],
  );

  const handleRetryInvoiceEmail = useCallback(async () => {
    if (!bookingId || retryingInvoiceEmail) return;
    setRetryingInvoiceEmail(true);
    try {
      const result = await retryPrivateBookingInvoiceEmail(bookingId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Invoice sent');
        router.refresh();
      }
    } finally {
      setRetryingInvoiceEmail(false);
    }
  }, [bookingId, retryingInvoiceEmail, router]);

  const handleCancelInvoice = useCallback(async () => {
    if (!bookingId || cancellingInvoice) return;
    const reason = cancelInvoiceReason.trim();
    if (!reason) {
      toast.error('Give a reason for cancelling this invoice.');
      return;
    }
    setCancellingInvoice(true);
    try {
      const result = await cancelPrivateBookingInvoice(bookingId, reason);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.invoiceNumber
          ? `${result.invoiceNumber} cancelled. Change the items, then invoice again.`
          : 'Invoice cancelled. Change the items, then invoice again.',
      );
      setShowCancelInvoiceModal(false);
      setCancelInvoiceReason('');
      router.refresh();
    } finally {
      setCancellingInvoice(false);
    }
  }, [bookingId, cancelInvoiceReason, cancellingInvoice, router]);

  const handleSendContract = useCallback(async () => {
    if (!bookingId || sendingContract) return;
    setSendingContract(true);
    try {
      const result = await sendBookingContract(bookingId);
      if (result.success) {
        toast.success(`Contract v${result.version} sent to the customer`);
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to send contract');
      }
    } finally {
      setSendingContract(false);
    }
  }, [bookingId, sendingContract, router]);

  // Download the server-rendered contract PDF straight to the browser's downloads.
  // Uses the ?format=pdf route (rendered server-side with fixed A4 / no minimum
  // font size) so the layout is exact regardless of the viewer's print settings.
  const handleDownloadContract = useCallback(async () => {
    if (!bookingId || downloadingContract) return;
    setDownloadingContract(true);
    try {
      const response = await fetch(`/api/private-bookings/contract?bookingId=${bookingId}&format=pdf`);
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(message || 'Failed to generate contract PDF');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const customerName = (booking?.customer_full_name || booking?.customer_name || 'contract').trim();
      anchor.download = `The Anchor - Private Booking Contract - ${customerName}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('Contract downloaded');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to download contract');
    } finally {
      setDownloadingContract(false);
    }
  }, [bookingId, downloadingContract, booking?.customer_full_name, booking?.customer_name, router]);

  const handleCopyPortalLink = useCallback(async () => {
    if (!bookingId || isCopyingLink) return;
    setIsCopyingLink(true);
    try {
      const result = await getBookingPortalLink(bookingId);
      if (result.success && result.url) {
        await navigator.clipboard.writeText(result.url);
        toast.success('Secure booking link copied, ready to paste into WhatsApp');
      } else {
        toast.error(result.error || 'Failed to generate link');
      }
    } catch {
      toast.error('Failed to copy link to clipboard');
    } finally {
      setIsCopyingLink(false);
    }
  }, [bookingId, isCopyingLink]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    if (!canEdit || isReordering || !bookingId) {
      return;
    }

    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    const oldIndex = items.findIndex((item) => item.id === activeId);
    const newIndex = items.findIndex((item) => item.id === overId);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const reordered = arrayMove(items, oldIndex, newIndex).map((item, index) => ({
      ...item,
      display_order: index,
    }));

    setItems(reordered);
    setBooking((prev) => (prev ? { ...prev, items: reordered } : prev));
    setIsReordering(true);

    try {
      const result = await reorderBookingItems(bookingId, reordered.map((item) => item.id));

      if (result?.error) {
        toast.error(result.error);
        await loadBooking(bookingId);
      } else {
        toast.success('Item order updated');
      }
    } catch (error) {
      console.error('Error reordering booking items:', error);
      toast.error('Failed to update item order');
      await loadBooking(bookingId);
    } finally {
      setIsReordering(false);
    }
  }, [canEdit, isReordering, bookingId, items, loadBooking]);

  const handleDeleteItem = async (itemId: string) => {
    if (!canEdit) {
      return;
    }
    const result = await deleteBookingItem(itemId);
    if (result.success) {
      refreshBooking();
    } else {
      toast.error(result.error ?? "Failed to delete the item.");
    }
    setDeleteConfirm(null);
  };

  const getItemIcon = (type: string) => {
    switch (type) {
      case "space":
        return <Icon name="mapPin" size={20} className="block" />;
      case "catering":
        return <Icon name="sparkles" size={20} className="block" />;
      case "vendor":
        return <Icon name="users" size={20} className="block" />;
      default:
        return <Icon name="clipboardList" size={20} className="block" />;
    }
  };

  const calculateSubtotal = () =>
    items.reduce((sum, item) => sum + toNumber(item.line_total), 0);

  // Calculate the original price before any item-level discounts
  const calculateOriginalTotal = () =>
    items.reduce(
      (sum, item) => sum + toNumber(item.quantity) * toNumber(item.unit_price),
      0,
    );

  // Calculate total item-level discounts
  const calculateItemDiscounts = () =>
    items.reduce((sum, item) => {
      const discountValue = item.discount_value;
      if (discountValue && discountValue > 0) {
        const qty = toNumber(item.quantity);
        const price = toNumber(item.unit_price);
        const originalPrice = qty * price;

        if (item.discount_type === "percent") {
          return sum + originalPrice * (discountValue / 100);
        }

        return sum + discountValue;
      }
      return sum;
    }, 0);

  const calculateTotal = () => {
    const subtotal = calculateSubtotal();
    if (booking?.discount_type === "percent") {
      return subtotal * (1 - (booking.discount_amount || 0) / 100);
    } else if (booking?.discount_type === "fixed") {
      return subtotal - (booking.discount_amount || 0);
    }
    return subtotal;
  };

  // One header for every state, so the title does not jump while the booking loads. Every tab of
  // the booking shows the customer's name.
  const layoutProps = {
    title: booking ? booking.customer_full_name || booking.customer_name : 'Private Booking',
    subtitle: 'Overview: the booking at a glance',
    backButton: PB_BACK_TO_LIST,
    navItems: PB_DETAIL_NAV(bookingId),
  }

  if (loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading booking…" />
  }

  if (!booking) {
    return <PageLayout {...layoutProps} error={pageError ?? "We couldn't find that booking."} />
  }

  const isDateTbd = isBookingDateTbd(booking);
  const internalNotesForDisplay = booking.internal_notes
    ? booking.internal_notes
        .split('\n')
        .filter((line) => line.trim() !== DATE_TBD_NOTE)
        .join('\n')
        .trim() || null
    : null
  const depositAmount = toNumber(booking.deposit_amount, 0);
  const depositRequired = depositAmount > 0;
  // Only while the flag is on (the page sets it). Paid or waived since the page loaded ends it.
  const depositAwaitingConfirmation =
    depositConfirmation?.awaiting === true && depositRequired && !booking.deposit_paid_date;
  const appliedDepositAmount = toNumber(booking.applied_deposit_amount, 0);
  const depositAppliedToInvoice = Boolean(booking.invoice_id && booking.invoice_deposit_treatment === "deducted");
  // Colours the deposit line the way the bookings list colours its deposit badge.
  const depositPaymentState: PrivateBookingPaymentState = !depositRequired
    ? 'not_required'
    : booking.deposit_paid_date
      ? 'deposit_paid'
      : depositAwaitingConfirmation
        ? 'deposit_to_be_confirmed'
        : 'deposit_due';

  // Stored prices are NET (SOP 2026-07); customer-payable figures are gross.
  // Computed locally from items so the summary stays live during edits.
  const bookingMoney = computeBookingMoney(
    items,
    booking.discount_type,
    booking.discount_amount,
  );

  const supplementaryTotal = toNumber(booking.supplementary_charges_total, 0);
  const aggregateBookingTotal = bookingMoney.grossTotal + supplementaryTotal;

  const editDepositValue = Number(editDepositAmount);
  const showDepositReductionReason =
    editingDeposit && Number.isFinite(editDepositValue) && editDepositValue > 0 && editDepositValue < 250;
  const showDepositWaiver =
    editingDeposit && editDepositAmount.trim() !== '' && editDepositValue === 0;

  type AuditEntry = NonNullable<PrivateBookingWithDetails['audit_trail']>[number]
  const auditTrail = booking.audit_trail ?? []

  const getAuditActor = (entry: AuditEntry): string => {
    const profile = entry.performed_by_profile
    if (profile) {
      if (profile.full_name && profile.full_name.trim().length > 0) {
        return profile.full_name
      }
      if (profile.email) {
        return profile.email
      }
    }

    const metadata = (entry.metadata ?? {}) as Record<string, unknown>
    if (typeof metadata.actor_name === 'string' && metadata.actor_name.trim().length > 0) {
      return metadata.actor_name
    }
    if (typeof metadata.user_email === 'string' && metadata.user_email.trim().length > 0) {
      return metadata.user_email
    }

    if (entry.performed_by) {
      return 'Team member'
    }

    return 'System'
  }

  const formatAuditAction = (action: string): string => {
    const labels: Record<string, string> = {
      note_added: 'Added a note',
      contract_generated: 'Generated contract',
      status_updated: 'Updated status',
      sms_sent: 'Sent SMS',
      email_sent: 'Sent Email'
    }

    if (labels[action]) {
      return labels[action]
    }

    return action
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const getAuditDetails = (entry: AuditEntry): string | null => {
    let metadata = (entry.metadata ?? {}) as Record<string, unknown>

    // Handle stringified JSON
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata)
      } catch {
        // If parsing fails, treat it as an empty object or log error
        console.error('Failed to parse metadata JSON:', metadata)
        metadata = {}
      }
    }

    if (entry.action === 'note_added') {
      if (typeof metadata.note_text === 'string' && metadata.note_text.trim().length > 0) {
        return metadata.note_text
      }
      if (typeof entry.new_value === 'string' && entry.new_value.trim().length > 0) {
        return entry.new_value
      }
      return null
    }

    if (entry.action === 'contract_generated') {
      if (metadata.contract_version !== undefined && metadata.contract_version !== null) {
        return `Generated contract version ${metadata.contract_version}.`
      }
      return 'Generated updated contract.'
    }

    if (entry.action === 'sms_sent' || entry.action === 'sms_failed' || entry.action === 'sms_queued') {
      const parts = [];
      
      const recipient = metadata.recipient || metadata.to || metadata.customer_phone;
      if (recipient) {
        parts.push(`To: ${recipient}`);
      }

      const messageBody = metadata.message || metadata.message_body || metadata.body;
      if (messageBody) {
        parts.push(`"${messageBody}"`);
      }

      if (entry.action === 'sms_failed' && metadata.error) {
        parts.push(`Error: ${metadata.error}`);
      }
      
      return parts.length > 0 ? parts.join('\n') : 'SMS details unavailable.'
    }

    if (entry.field_name && entry.old_value && entry.new_value) {
      const fieldLabel = entry.field_name
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
      return `${fieldLabel}: ${entry.old_value} → ${entry.new_value}`
    }

    if (typeof metadata.description === 'string' && metadata.description.trim().length > 0) {
      return metadata.description
    }

    if (typeof metadata.note_preview === 'string' && metadata.note_preview.trim().length > 0) {
      return metadata.note_preview
    }

    return null
  }

  return (
    <PageLayout
      {...layoutProps}
      headerActions={
        <>
          {/* With Change Status and Edit there are more than three actions, so Share Link and
              Open Contract collapse into the labelled More menu. The contract is a PDF that opens
              outside the app, so it is an action, not a tab. */}
          {canEdit ? (
            <Dropdown
              width="auto"
              trigger={
                <Button type="button" variant="secondary" size="sm" iconRight={<Icon name="chevronDown" size={14} />}>
                  More
                </Button>
              }
            >
              <DropdownItem
                icon={<Icon name="link" size={16} />}
                onClick={() => void handleCopyPortalLink()}
                disabled={isCopyingLink}
              >
                Share Link
              </DropdownItem>
              <DropdownItem
                icon={<Icon name="externalLink" size={16} />}
                onClick={() => window.open(privateBookingContractHref(bookingId), '_blank', 'noopener,noreferrer')}
              >
                Open Contract
              </DropdownItem>
            </Dropdown>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCopyPortalLink}
                loading={isCopyingLink}
                icon={<Icon name="link" size={16} />}
                aria-label="Copy customer portal link to clipboard"
              >
                Share Link
              </Button>
              <LinkButton
                href={privateBookingContractHref(bookingId)}
                target="_blank"
                variant="secondary"
                size="sm"
                icon={<Icon name="externalLink" size={16} />}
              >
                Open Contract
              </LinkButton>
            </>
          )}
          {canEdit && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setShowStatusModal(true)}>Change Status</Button>
              <LinkButton variant="secondary" size="sm" href={`/private-bookings/${bookingId}/edit`}>Edit</LinkButton>
            </>
          )}
        </>
      }
    >
      {pageError && (
        <Alert
          tone="danger"
          title="We couldn’t refresh the booking"
        >
          {pageError}
        </Alert>
      )}

      <RecordLockBanner booking={booking} />

      {depositAwaitingConfirmation && (
        <ConfirmDepositPanel
          bookingId={bookingId}
          depositAmount={depositAmount}
          holdExpiryPreview={depositConfirmation?.holdExpiryPreview ?? null}
          isDateTbd={isDateTbd}
          canConfirm={canManageDeposits}
          onConfirmed={() => router.refresh()}
        />
      )}

      {isDateTbd && (
        <Alert
          tone="warning"
          title="Event date and time still to be confirmed"
        >
          Keep this booking in draft until the customer confirms the event details.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader
              title="Event Details"
              action={
                <Badge tone={privateBookingStatusTone(booking.status)}>
                  {privateBookingStatusLabel(booking.status)}
                </Badge>
              }
            />
            <CardBody className="space-y-4">
              <DescriptionList
                items={[
                  {
                    key: 'event_date',
                    label: 'Event Date',
                    value: isDateTbd ? (
                      <span className="flex items-center font-medium text-warning-fg">
                        <Icon name="calendar" size={20} className="text-warning mr-2" />
                        To be confirmed
                      </span>
                    ) : (
                      <>
                        <span className="flex items-center">
                          <Icon name="calendar" size={20} className="text-text-subtle mr-2" />
                          {formatDateFull(booking.event_date)}
                        </span>
                        {booking.setup_date && (
                          <span className="mt-1 block text-text-muted">
                            Setup: {formatDateFull(booking.setup_date)}
                          </span>
                        )}
                      </>
                    ),
                  },
                  {
                    key: 'time',
                    label: 'Time',
                    value: isDateTbd ? (
                      <span className="flex items-center font-medium text-warning-fg">
                        <Icon name="clock" size={20} className="text-warning mr-2" />
                        To be confirmed
                      </span>
                    ) : (
                      <>
                        <span className="flex items-center">
                          <Icon name="clock" size={20} className="text-text-subtle mr-2" />
                          {formatTime12Hour(booking.start_time)} -{' '}
                          {formatEndTime(booking)}
                        </span>
                        {booking.setup_time && (
                          <span className="mt-1 block text-text-muted">
                            Setup: {formatTime12Hour(booking.setup_time || null)}
                          </span>
                        )}
                      </>
                    ),
                  },
                  {
                    key: 'guest_count',
                    label: 'Guest Count',
                    value: (
                      <span className="flex items-center">
                        <Icon name="users" size={20} className="text-text-subtle mr-2" />
                        {booking.guest_count ?? "TBC"} guests
                      </span>
                    ),
                  },
                  {
                    key: 'event_type',
                    label: 'Event Type',
                    value: (
                      <span className="flex items-center">
                        <Icon name="sparkles" size={20} className="text-text-subtle mr-2" />
                        {booking.event_type || "Private Event"}
                      </span>
                    ),
                  },
                  {
                    key: 'contact_phone',
                    label: 'Contact Phone',
                    value: (
                      <span className="flex items-center">
                        <Icon name="phone" size={20} className="text-text-subtle mr-2" />
                        {booking.contact_phone ? (
                          <a
                            href={`tel:${booking.contact_phone}`}
                            className="text-primary hover:underline"
                          >
                            {booking.contact_phone}
                          </a>
                        ) : (
                          <span className="text-text-muted">Not provided</span>
                        )}
                      </span>
                    ),
                  },
                  {
                    key: 'contact_email',
                    label: 'Contact Email',
                    value: (
                      <>
                        <span className="flex items-center">
                          <Icon name="mail" size={20} className="text-text-subtle mr-2" />
                          {booking.contact_email ? (
                            <a
                              href={`mailto:${booking.contact_email}`}
                              className="text-primary hover:underline"
                            >
                              {booking.contact_email}
                            </a>
                          ) : (
                            <span className="text-text-muted">Not provided</span>
                          )}
                        </span>
                        {canEdit &&
                          booking.contact_email &&
                          (booking.status === 'confirmed' || booking.status === 'completed') && (
                            <span className="mt-2 block">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                loading={sendingCalendarInvite}
                                disabled={sendingCalendarInvite}
                                onClick={handleResendCalendarInvite}
                                icon={<Icon name="calendar" size={16} />}
                              >
                                Resend Calendar Invite
                              </Button>
                            </span>
                          )}
                      </>
                    ),
                  },
                  {
                    key: 'source',
                    label: 'Booking Source',
                    value: (
                      <span className="flex items-center">
                        <Icon name="building" size={20} className="text-text-subtle mr-2" />
                        {booking.source || "Direct"}
                      </span>
                    ),
                  },
                ]}
              />

              {booking.balance_due_date && (
                <Alert
                  tone="warning"
                  title={`Balance & final details due by ${formatDateFull(booking.balance_due_date)}`}
                />
              )}
            </CardBody>
          </Card>

          {/* Booking Items Card */}
          <Card>
            <CardHeader
              title="Booking Items"
              action={
                canEdit ? (
                  <div className="flex items-center gap-3">
                    {isReordering && (
                      <span className="text-xs text-text-muted">Saving order…</span>
                    )}
                    <Button
                      onClick={() => setShowAddItemModal(true)}
                      size="sm"
                      variant="primary"
                      icon={<Icon name="plus" size={16} />}
                    >
                      Add Item
                    </Button>
                  </div>
                ) : undefined
              }
            />
              {items.length === 0 ? (
                <Empty
                  size="sm"
                  icon={<Icon name="clipboardList" size={48} />}
                  title="No items yet"
                  description={
                    canEdit
                      ? "Build this booking with Add Item."
                      : "Items will appear here once added."
                  }
                />
              ) : (
                <CardBody>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={items.map((item) => item.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-4">
                      {items.map((item) => (
                        <SortableBookingItem
                          key={item.id}
                          item={item}
                          getItemIcon={getItemIcon}
                          formatMoney={formatMoney}
                          canEdit={canEdit}
                          onEdit={(current) => {
                            setEditingItem(current);
                            setShowEditItemModal(true);
                          }}
                          onDelete={(id) => setDeleteConfirm(id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                </CardBody>
              )}
          </Card>

          {/* Notes Section */}
          {(booking.customer_requests ||
            booking.internal_notes ||
            booking.contract_note ||
            booking.special_requirements ||
            booking.accessibility_needs) && (
            <Card>
              <CardHeader title="Notes & Requirements" />
              <CardBody>
                <DescriptionList
                  columns={1}
                  items={[
                    { key: 'customer_requests', label: 'Customer Requests', value: booking.customer_requests },
                    { key: 'special_requirements', label: 'Special Requirements', value: booking.special_requirements },
                    { key: 'accessibility_needs', label: 'Accessibility Needs', value: booking.accessibility_needs },
                    { key: 'internal_notes', label: 'Internal Notes', value: internalNotesForDisplay },
                    { key: 'contract_note', label: 'Contract Note', value: booking.contract_note },
                  ]
                    .filter((note) => Boolean(note.value))
                    .map((note) => ({
                      ...note,
                      value: <span className="whitespace-pre-wrap text-text-muted">{note.value}</span>,
                    }))}
                />
              </CardBody>
            </Card>
          )}

          <WaiverRiskPanel
            booking={booking}
            canManage={canManageDeposits}
            onChanged={refreshWorkflow}
          />

          <SuppliersPanel
            bookingId={bookingId}
            canEdit={canEdit}
            canManage={canManageDeposits}
            refreshKey={workflowRefreshKey}
            onChanged={refreshWorkflow}
          />

          <DeductionsPanel
            bookingId={bookingId}
            canManage={canManageDeposits}
            refreshKey={workflowRefreshKey}
          />

          <ComplaintsPanel
            bookingId={bookingId}
            canManage={canManageDeposits}
            refreshKey={workflowRefreshKey}
          />
        </div>

        {/* Sidebar - Right 1/3 */}
        <div className="space-y-6">
          {canEdit && (
            <Card>
              <CardHeader title="Quick Booking Update" />
              <CardBody>
                <form onSubmit={withSubmitErrorToast(handleNoteSubmit)} className="space-y-4">
                  <Textarea
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    rows={4}
                    maxLength={NOTE_MAX_LENGTH}
                    aria-label="Quick booking update"
                    placeholder="Capture quick updates, decisions, or follow-ups for the team."
                  />
                  <FormFooter
                    start={
                      <span className="text-xs">
                        {noteText.length}/{NOTE_MAX_LENGTH} characters
                      </span>
                    }
                  >
                    <Button
                      type="submit"
                      size="sm"
                      variant="primary"
                      loading={addingNote}
                      disabled={noteText.trim().length === 0}
                    >
                      Add Note
                    </Button>
                  </FormFooter>
                </form>
              </CardBody>
            </Card>
          )}
          {/* Financial Summary Card */}
          <Card>
            <CardHeader
              title="Financial Summary"
              action={
                canEdit ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() => setShowDiscountModal(true)}
                  >
                    Apply Discount
                  </Button>
                ) : undefined
              }
            />
            <CardBody className="space-y-3">
              <div className="space-y-3">
                {/* Always show original price and discounts */}
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">
                    Original Price (before discounts)
                  </span>
                  <span className="font-medium text-text">
                    {items.length > 0
                      ? formatMoney(calculateOriginalTotal())
                      : formatMoney(0)}
                  </span>
                </div>

                {/* Show item-level discounts if any */}
                {calculateItemDiscounts() > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-success-fg">Item Discounts</span>
                    <span className="font-medium text-success-fg">
                      -{formatMoney(calculateItemDiscounts())}
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Subtotal</span>
                  <span className="font-medium text-text">
                    {items.length > 0 ? formatMoney(calculateSubtotal()) : formatMoney(0)}
                  </span>
                </div>

                {/* Show booking-level discount if any */}
                {!!booking.discount_amount && booking.discount_amount > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-success-fg">
                        Booking Discount (
                        {booking.discount_type === "percent"
                          ? `${booking.discount_amount}%`
                          : `£${booking.discount_amount}`}
                        )
                        {booking.discount_reason && (
                          <span className="block text-xs text-text-muted font-normal mt-1">
                            {booking.discount_reason}
                          </span>
                        )}
                      </span>
                      <span className="font-medium text-success-fg">
                        -{formatMoney(calculateSubtotal() - calculateTotal())}
                      </span>
                    </div>
                  </>
                )}

                {/* Show total savings if any discounts */}
                {(calculateItemDiscounts() > 0 ||
                  (booking.discount_amount && booking.discount_amount > 0)) && (
                  <div className="bg-success-soft border border-success-border p-2 rounded-default">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-success-fg">
                        Total Savings
                      </span>
                      <span className="font-bold text-success-fg">
                        {formatMoney(calculateOriginalTotal() - calculateTotal())}
                      </span>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-border space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Event price (ex VAT)</span>
                    <span className="font-medium text-text">
                      {formatMoney(bookingMoney.discountedNet)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">VAT</span>
                    <span className="font-medium text-text">
                      {formatMoney(bookingMoney.vatAmount)}
                    </span>
                  </div>
                  {supplementaryTotal > 0 && <div className="flex justify-between text-sm"><span>Additional invoices inc. VAT</span><span>{formatMoney(supplementaryTotal)}</span></div>}
                  {toNumber(booking.invoice_credits_total) > 0 && <div className="flex justify-between text-sm"><span>Credits issued (shown separately)</span><span>{formatMoney(booking.invoice_credits_total)}</span></div>}
                  <div className="flex justify-between">
                    <span className="text-base font-medium text-text">
                      Total charges inc. VAT
                    </span>
                    <span className="text-xl font-bold text-text">
                      {formatMoney(aggregateBookingTotal)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-3 border-t border-border">
                <div className="bg-info-soft border border-info-border p-3 rounded-default">
                  <p className="text-xs font-medium text-info-fg mb-2">
                    {depositAppliedToInvoice ? "Deposit applied to invoice" : "Refundable Deposit"}
                  </p>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text">
                        {depositAppliedToInvoice ? "Applied towards event price" : "Security Deposit"}
                      </p>
                      <p className={`text-xs ${privateBookingPaymentTextClass(depositPaymentState)}`}>
                        {!depositRequired
                          ? "No deposit required"
                          : booking.deposit_paid_date
                          ? `Paid ${formatDateFull(booking.deposit_paid_date)}`
                          : depositAwaitingConfirmation
                          ? "To be confirmed: the guest has not been told yet"
                          : "Not paid"}
                      </p>
                    </div>
                  <div className="text-right">
                    {editingDeposit ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1 justify-end">
                          <Input
                            type="number"
                            value={editDepositAmount}
                            onChange={(e) => setEditDepositAmount(e.target.value)}
                            disabled={savingDeposit}
                            min="0"
                            step="0.01"
                            placeholder="Amount"
                            aria-label="Deposit amount"
                            inputSize="sm"
                            className="w-24"
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleSaveDepositAmount}
                            loading={savingDeposit}
                            disabled={savingDeposit}
                            aria-label="Save deposit amount"
                          >
                            <Icon name="check" size={16} />
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setEditingDeposit(false)}
                            disabled={savingDeposit}
                            type="button"
                            aria-label="Cancel edit"
                          >
                            <Icon name="x" size={16} />
                          </Button>
                        </div>
                        {showDepositReductionReason && (
                          <div className="text-left">
                            <Textarea
                              label="Reason for reduced deposit (GM discretion)"
                              value={depositEditReason}
                              onChange={(e) => setDepositEditReason(e.target.value)}
                              rows={2}
                              required
                              disabled={savingDeposit}
                              placeholder="Standard deposit is £250"
                            />
                          </div>
                        )}
                        {showDepositWaiver && (
                          <div className="space-y-2 text-left">
                            <Checkbox
                              label="Deposit waived (GM approved: venue-hosted/internal event)"
                              checked={depositWaiveConfirmed}
                              onChange={(checked) => setDepositWaiveConfirmed(checked)}
                              disabled={savingDeposit}
                            />
                            <Textarea
                              value={depositEditReason}
                              onChange={(e) => setDepositEditReason(e.target.value)}
                              rows={2}
                              required
                              disabled={savingDeposit}
                              placeholder="Reason for waiving the deposit"
                              aria-label="Reason for waiving the deposit"
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-end">
                        <p className="text-sm font-medium text-text">
                          {depositAppliedToInvoice ? formatMoney(appliedDepositAmount) : depositRequired ? formatMoney(depositAmount) : "No deposit"}
                        </p>
                        {!booking.deposit_paid_date && canManageDeposits && (
                          <IconButton
                            type="button"
                            size="sm"
                            onClick={() => {
                              setEditDepositAmount(String(depositAmount));
                              setDepositEditReason('');
                              setDepositWaiveConfirmed(false);
                              setEditingDeposit(true);
                            }}
                            className="text-text-muted"
                            label="Edit deposit amount"
                            icon={<Icon name="edit" size={14} />}
                          />
                        )}
                      </div>
                    )}
                    {!booking.deposit_paid_date &&
                      depositRequired &&
                      (booking.status === "draft" || booking.status === "confirmed") &&
                      canManageDeposits && (
                        <div className="mt-1 flex flex-col gap-1 items-end">
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => setShowDepositModal(true)}
                          >
                            Record Payment
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={handlePaypalDeposit}
                            disabled={paypalDepositLoading}
                            loading={paypalDepositLoading}
                          >
                            Pay via PayPal
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={handleCopyPortalLink}
                            disabled={isCopyingLink}
                            loading={isCopyingLink}
                          >
                            Copy Payment Link
                          </Button>
                          {/* While the deposit is to be confirmed, Confirm deposit sends the link. */}
                          {!depositAwaitingConfirmation && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={handleSendDepositLink}
                              disabled={sendingDepositLink}
                              loading={sendingDepositLink}
                            >
                              Send Payment Link
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {depositRequired && (
                    <p className="text-xs text-text-muted mt-2">
                      {depositAppliedToInvoice ? "This deposit has been applied to the invoice. Any refund needs an invoice review." : "Returned after event (subject to terms)"}
                    </p>
                  )}
                  {/* Refund status badge */}
                  {depositRequired && refundTotals.totalRefunded > 0 && (
                    <div className="mt-2">
                      <Badge
                        tone={privateBookingPaymentTone(
                          refundTotals.totalRefunded >= depositAmount ? 'refunded' : 'partially_refunded',
                        )}
                        size="sm"
                      >
                        {refundTotals.totalRefunded >= depositAmount ? 'Refunded' : 'Partially Refunded'}
                      </Badge>
                    </div>
                  )}
                  {/* Refund button */}
                  {depositRequired && !depositAppliedToInvoice && canRefund && booking.deposit_paid_date && refundTotals.totalRefunded < depositAmount && (
                    <div className="mt-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowRefundDialog(true)}
                      >
                        Process Refund
                      </Button>
                    </div>
                  )}
                </div>

                {/* Only a separately held deposit is additional to the event price. */}
                <div className="flex justify-between text-sm pt-3 border-t border-border">
                  <span className="font-medium text-text">
                    Total to pay before event
                  </span>
                  <span className="font-semibold text-text">
                    {formatMoney(
                      aggregateBookingTotal + (depositRequired && !depositAppliedToInvoice ? depositAmount : 0),
                    )}
                  </span>
                </div>

                {(() => {
                  const payments: PrivateBookingPayment[] = booking.payments ?? [];
                  const totalPaid = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0) + appliedDepositAmount;
                  // Balance is VAT-inclusive: stored prices are net
                  const bookingTotal = aggregateBookingTotal;
                  // An applied invoice deposit is already included in totalPaid.
                  const remaining = booking.invoice_id && booking.invoice_balance_total != null
                    ? toNumber(booking.invoice_balance_total)
                    : Math.max(0, bookingTotal - totalPaid);
                  return (
                    <>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-text">
                            Balance Due
                          </p>
                          <p className="text-xs text-text-muted">
                            For original charges and issued extras
                          </p>
                          {booking.balance_due_date && (
                            <p className="text-xs text-text-muted">
                              Due by {formatDateFull(booking.balance_due_date)}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          {isDateTbd ? (
                            <p className="text-sm font-medium text-text">To be confirmed</p>
                          ) : (
                            <>
                              {totalPaid > 0 && remaining > 0 && (
                                <p className="text-xs text-text-muted mb-0.5">
                                  {formatMoney(totalPaid)} of {formatMoney(bookingTotal)} paid
                                </p>
                              )}
                              <p className="text-sm font-medium text-text">
                                {formatMoney(remaining)}
                              </p>
                            </>
                          )}
                          {!isDateTbd && remaining > 0 && canManageDeposits && !booking.invoice_id && (
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              onClick={() => setShowFinalModal(true)}
                              className="mt-1"
                            >
                              Record Payment
                            </Button>
                          )}
                        </div>
                      </div>

                      {booking.invoice_id && remaining > 0 && <a href="#booking-billing" className="mt-2 block text-sm text-primary underline">Record payment against an invoice</a>}

                      <div className="mt-3 pt-3 border-t border-border">
                        <PaymentHistoryTable
                          payments={paymentHistory}
                          bookingId={bookingId}
                          canEditPayments={canEditPayments}
                          totalAmount={aggregateBookingTotal}
                        />
                      </div>

                      {booking.final_payment_date && remaining === 0 && (
                        <div className="pt-3 border-t border-border">
                          <div className="flex items-center justify-between">
                            <span className={`text-sm font-medium ${privateBookingPaymentTextClass('paid_in_full')}`}>
                              ✓ Fully Paid
                            </span>
                            <span className="text-xs text-text-muted">
                              {formatDateFull(booking.final_payment_date)}
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </CardBody>
          </Card>

          {/* Refund history draws its own card, and nothing when there are no refunds. */}
          {booking.deposit_paid_date && (
            <RefundHistoryTable
              sourceType="private_booking"
              sourceId={booking.id}
            />
          )}

          {/* Quick Actions Card. Sending a message is the Messages tab, so it has no button here. */}
          <Card>
            <CardHeader title="Quick Actions" />
            <CardBody>
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={handleDownloadContract}
                  loading={downloadingContract}
                  icon={<Icon name="file" size={16} />}
                  iconRight={<Icon name="download" size={16} />}
                >
                  <span className="flex-1 text-left">Download Contract</span>
                </Button>

                <LinkButton
                  href={`/api/private-bookings/event-sheet?bookingId=${bookingId}`}
                  target="_blank"
                  variant="secondary"
                  className="w-full"
                  icon={<Icon name="clipboardList" size={16} />}
                  iconRight={<Icon name="externalLink" size={16} />}
                >
                  <span className="flex-1 text-left">Staff Event Sheet</span>
                </LinkButton>

                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={handleSendContract}
                  disabled={!booking.contact_email}
                  loading={sendingContract}
                  icon={<Icon name="mail" size={16} />}
                  iconRight={<Icon name="chevronRight" size={16} />}
                >
                  <span className="flex-1 text-left">Email Contract</span>
                </Button>
                {booking.contract_sent_at ? (
                  <p className="text-xs text-text-muted px-1">
                    Contract sent {formatDateFull(booking.contract_sent_at)}
                    {booking.contract_sent_to ? ` to ${booking.contract_sent_to}` : ''}
                  </p>
                ) : (
                  <p className="text-xs text-warning-fg px-1">
                    Contract not yet sent: terms must reach the customer before the deposit is paid.
                  </p>
                )}

                {canInvoice && (() => {
                  const alreadyInvoiced = Boolean(booking.invoice_id);
                  const hasEmail = Boolean(booking.contact_email);
                  const isConfirmed = booking.status === 'confirmed';
                  const hasValue = (booking.items ?? []).some(
                    (bookingItem) => toNumber(bookingItem.line_total, 0) > 0,
                  );

                  // The reason a button cannot be used is shown as persistent
                  // text, never a tooltip: this screen is used on an iPad, and
                  // a tooltip on a disabled button reaches neither touch nor
                  // keyboard users.
                  const blockedReason = !isConfirmed
                    ? 'Only confirmed bookings can be invoiced.'
                    : !hasValue
                      ? 'Add priced items before invoicing this booking.'
                      : !hasEmail
                        ? 'Add an email address to invoice this booking.'
                        : null;

                  if (alreadyInvoiced) {
                    return (
                      <div className="rounded-default bg-surface-2 px-3 py-2">
                        <p className="text-sm font-medium text-text">
                          {booking.invoice_sent_at
                            ? `Invoice sent ${formatDateFull(booking.invoice_sent_at)}`
                            : 'Invoice created but not yet sent'}
                        </p>
                        <p className="mt-1 text-xs text-text-muted">
                          {booking.invoice_deposit_treatment === 'deducted'
                            ? 'Deposit applied to the invoice.'
                            : 'Deposit held separately.'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3">
                          <Link
                            href={`/invoices/${booking.invoice_id}`}
                            className="rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-hidden focus-visible:shadow-ring"
                          >
                            View Invoice
                          </Link>
                          {!booking.invoice_sent_at && (
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              onClick={handleRetryInvoiceEmail}
                              loading={retryingInvoiceEmail}
                            >
                              Email Invoice
                            </Button>
                          )}
                          {/* The way back when the booked items change after
                              invoicing. Cancelling voids the invoice and
                              releases the booking, so the generate button
                              returns and can raise a corrected invoice. */}
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="text-danger-fg"
                            onClick={() => setShowCancelInvoiceModal(true)}
                          >
                            Cancel Invoice
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        onClick={handleOpenInvoiceModal}
                        disabled={Boolean(blockedReason)}
                        icon={<Icon name="file" size={16} />}
                        iconRight={<Icon name="chevronRight" size={16} />}
                      >
                        <span className="flex-1 text-left">Generate and Send Invoice</span>
                      </Button>
                      {blockedReason && (
                        <p className="mt-1 px-1 text-xs text-warning-fg">{blockedReason}</p>
                      )}
                    </div>
                  );
                })()}

              </div>
            </CardBody>
          </Card>

          {/* Booking Info Card */}
          <Card>
            <CardHeader title="Booking Information" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { key: 'id', label: 'Booking ID', value: <span className="font-mono">{booking.id.slice(0, 8)}</span> },
                  { key: 'created', label: 'Created', value: formatDateFull(booking.created_at) },
                  { key: 'updated', label: 'Last Updated', value: formatDateFull(booking.updated_at) },
                  ...(booking.contract_version > 0
                    ? [{ key: 'contract', label: 'Contract Version', value: `v${booking.contract_version}` }]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          <RecordLockControl
            booking={booking}
            canManage={canManageDeposits}
            onChanged={refreshWorkflow}
          />
        </div>
      </div>

      {booking.invoice_id && canViewPricing && (
        <>
          <PrivateBookingBilling bookingId={bookingId} canIssue={canInvoice} canRecordPayments={canManageDeposits} canAddExtras={['confirmed', 'completed'].includes(booking.status)} onChanged={refreshBooking} />
          <PrivateBookingReceiptPanel bookingId={bookingId} canGenerate={canInvoice} />
        </>
      )}

      <Card>
        <CardHeader title="Audit Trail" />
          {auditTrail.length === 0 ? (
            <Empty
              size="sm"
              icon={<Icon name="clock" size={48} />}
              title="No history yet"
              description="Updates and actions for this booking will appear here."
            />
          ) : (
            <CardBody>
            <ul className="space-y-4">
              {auditTrail.map((entry) => {
                const details = getAuditDetails(entry)
                return (
                  <li key={entry.id} className="relative pl-5">
                    <span className="absolute left-0 top-2 h-2 w-2 rounded-full bg-primary" />
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-text">
                          {getAuditActor(entry)}
                        </p>
                        <span className="text-xs text-text-muted">
                          {formatDateTime12Hour(entry.performed_at)}
                        </span>
                      </div>
                      <p className="text-sm text-text-muted">
                        {formatAuditAction(entry.action)}
                      </p>
                      {details && (
                        <p className="text-sm text-text-muted whitespace-pre-wrap">
                          {details}
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            </CardBody>
          )}
      </Card>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDeleteItem(deleteConfirm)}
        title="Delete Item"
        message="This removes the item and its price from the booking. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
      />

      {/* Modals */}
      {canManageDeposits && depositRequired && (
        <PaymentModal
          open={showDepositModal}
          onClose={() => setShowDepositModal(false)}
          bookingId={bookingId}
          type="deposit"
          amount={depositAmount}
          onSuccess={refreshBooking}
        />
      )}

      {canManageDeposits && (() => {
        const payments: PrivateBookingPayment[] = booking?.payments ?? [];
        const totalPaid = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0) + appliedDepositAmount;
        // An applied invoice deposit is already included in totalPaid. (gross, inc. VAT)
        const remaining = Math.max(0, aggregateBookingTotal - totalPaid);
        return (
          <PaymentModal
            open={showFinalModal}
            onClose={() => setShowFinalModal(false)}
            bookingId={bookingId}
            type="final"
            amount={remaining}
            maxAmount={remaining}
            onSuccess={refreshBooking}
          />
        );
      })()}

      {canEdit && (
        <StatusModal
          open={showStatusModal}
          onClose={() => setShowStatusModal(false)}
          bookingId={bookingId}
          currentStatus={booking.status}
          onSuccess={refreshBooking}
        />
      )}

      {canEdit && (
        <AddItemModal
          open={showAddItemModal}
          onClose={() => setShowAddItemModal(false)}
          bookingId={bookingId}
          onItemAdded={refreshBooking}
        />
      )}

      {canEdit && (
        <DiscountModal
          open={showDiscountModal}
          onClose={() => setShowDiscountModal(false)}
          bookingId={bookingId}
          currentTotal={calculateSubtotal()}
          onSuccess={refreshBooking}
        />
      )}

      {canEdit && editingItem && (
        <EditItemModal
          open={showEditItemModal}
          onClose={() => {
            setShowEditItemModal(false);
            setEditingItem(null);
          }}
          item={editingItem}
          onSuccess={refreshBooking}
        />
      )}

      {/* Refund dialog */}
      <InvoiceBookingModal
        open={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        preview={invoicePreview}
        loading={invoicePreviewLoading}
        sending={invoiceSending}
        error={invoiceError}
        blocked={invoiceBlocked}
        onConfirm={handleConfirmInvoice}
      />

      <Modal
        open={showCancelInvoiceModal}
        onClose={() => {
          if (!cancellingInvoice) {
            setShowCancelInvoiceModal(false);
            setCancelInvoiceReason('');
          }
        }}
        title="Cancel Invoice"
        mobileFullscreen
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowCancelInvoiceModal(false);
                setCancelInvoiceReason('');
              }}
              disabled={cancellingInvoice}
            >
              Keep Invoice
            </Button>
            <Button
              variant="danger"
              onClick={handleCancelInvoice}
              disabled={cancellingInvoice || !cancelInvoiceReason.trim()}
              loading={cancellingInvoice}
            >
              Cancel Invoice
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-text">
            The invoice is voided and unlinked from this booking. The customer
            is not emailed, so tell them yourself that the old invoice no longer
            stands.
          </p>
          <p className="text-sm text-text">
            The deposit stays on the booking and is applied again to the
            replacement invoice. Change the items first, then use{' '}
            <span className="font-medium">Generate and Send Invoice</span>.
          </p>
          <Textarea
            label="Reason"
            value={cancelInvoiceReason}
            onChange={(e) => setCancelInvoiceReason(e.target.value)}
            placeholder="Booked items changed"
            rows={3}
            disabled={cancellingInvoice}
          />
        </div>
      </Modal>

      {canRefund && booking && (
        <RefundDialog
          open={showRefundDialog}
          onOpenChange={setShowRefundDialog}
          sourceType="private_booking"
          sourceId={booking.id}
          originalAmount={booking.deposit_amount ?? 0}
          totalRefunded={refundTotals.totalRefunded}
          totalPending={refundTotals.totalPending}
          hasPayPalCapture={!!booking.paypal_deposit_capture_id}
          captureExpired={
            booking.deposit_paid_date
              ? (new Date().getTime() - new Date(booking.deposit_paid_date).getTime()) / (1000 * 60 * 60 * 24) > 180
              : false
          }
        />
      )}
    </PageLayout>
  );
}
