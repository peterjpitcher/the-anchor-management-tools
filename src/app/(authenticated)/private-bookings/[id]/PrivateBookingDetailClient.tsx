"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateFull, formatTime12Hour } from "@/lib/dateUtils";
import {
  PencilIcon,
  UserGroupIcon,
  CurrencyPoundIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  PhoneIcon,
  ClockIcon,
  CheckCircleIcon,
  BanknotesIcon,
  CreditCardIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
  MapPinIcon,
  SparklesIcon,
  ClipboardDocumentListIcon,
  PercentBadgeIcon,
  ChatBubbleLeftRightIcon,
  DocumentIcon,
  CalendarDaysIcon,
  BuildingOfficeIcon,
  BoltIcon,
  Bars3Icon,
} from "@heroicons/react/24/outline";
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
} from '@/app/actions/privateBookingActions'
import type {
  PrivateBookingWithDetails,
  BookingStatus,
  CateringPackage,
  VenueSpace,
  Vendor,
  PrivateBookingItem,
} from "@/types/private-bookings";
// New UI components
import { PageLayout } from "@/components/ui-v2/layout/PageLayout";
import { Card } from "@/components/ui-v2/layout/Card";
import { Section } from "@/components/ui-v2/layout/Section";
import { Button } from "@/components/ui-v2/forms/Button";
import { LinkButton } from "@/components/ui-v2/navigation/LinkButton";
import { Input } from "@/components/ui-v2/forms/Input";
import { Select } from "@/components/ui-v2/forms/Select";
import { Textarea } from "@/components/ui-v2/forms/Textarea";
import { Form } from "@/components/ui-v2/forms/Form";
import { FormGroup } from "@/components/ui-v2/forms/FormGroup";
import { Badge } from "@/components/ui-v2/display/Badge";
import { Modal } from "@/components/ui-v2/overlay/Modal";
import { ConfirmDialog } from "@/components/ui-v2/overlay/ConfirmDialog";
import { Skeleton } from "@/components/ui-v2/feedback/Skeleton";
import { EmptyState } from "@/components/ui-v2/display/EmptyState";
import { Alert } from "@/components/ui-v2/feedback/Alert";
import { toast } from "@/components/ui-v2/feedback/Toast";
import { formatCurrency } from "@/components/ui-v2/utils/format";
// Using types from private-bookings.ts

// Status configuration
const statusConfig: Record<
  BookingStatus,
  {
    label: string;
    variant: "success" | "info" | "warning" | "error" | "default";
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  draft: {
    label: "Draft",
    variant: "default",
    icon: PencilIcon,
  },
  confirmed: {
    label: "Confirmed",
    variant: "success",
    icon: CheckCircleIcon,
  },
  completed: {
    label: "Completed",
    variant: "info",
    icon: CheckCircleIcon,
  },
  cancelled: {
    label: "Cancelled",
    variant: "error",
    icon: XMarkIcon,
  },
};

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
  };
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
  };
};

const DATE_TBD_NOTE = 'Event date/time to be confirmed';

const formatMoney = (value: unknown): string => formatCurrency(toNumber(value));

// Payment Modal Component
interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  type: "deposit" | "final";
  amount: number;
  onSuccess: () => void;
}

function PaymentModal({
  open: isOpen,
  onClose,
  bookingId,
  type,
  amount,
  onSuccess,
}: PaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "card" | "invoice"
  >("card");
  const [customAmount, setCustomAmount] = useState(amount.toString());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    }
    setIsSubmitting(false);
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={`Record ${type === "deposit" ? "Deposit" : "Final"} Payment`}
    >
      <Form onSubmit={handleSubmit} className="space-y-4">
        <FormGroup label="Payment Amount (£)">
          <Input
            type="number"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            step="0.01"
            min="0"
            required
          />
        </FormGroup>

        <FormGroup label="Payment Method">
          <div className="space-y-2">
            {[
              { value: "card", label: "Card", icon: CreditCardIcon },
              { value: "cash", label: "Cash", icon: BanknotesIcon },
              { value: "invoice", label: "Invoice", icon: DocumentTextIcon },
            ].map((method) => (
              <label key={method.value} className="flex items-center">
                <input
                  type="radio"
                  value={method.value}
                  checked={paymentMethod === method.value}
                  onChange={(e) =>
                    setPaymentMethod(
                      e.target.value as "cash" | "card" | "invoice",
                    )
                  }
                  className="mr-3 h-5 w-5"
                />
                <method.icon className="h-5 w-5 mr-2 text-gray-400" />
                <span className="text-sm text-gray-900">{method.label}</span>
              </label>
            ))}
          </div>
        </FormGroup>

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isSubmitting ? "Recording..." : "Record Payment"}
          </Button>
        </div>
      </Form>
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
      className={`flex items-start justify-between border-b pb-4 last:border-0 ${
        isDragging ? 'bg-white shadow-md rounded-md' : ''
      }`}
    >
      <div className="flex items-start space-x-3 flex-1">
        {canEdit && (
          <button
            type="button"
            className="mt-1 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing"
            aria-label="Reorder booking item"
            {...attributes}
            {...listeners}
          >
            <Bars3Icon className="h-5 w-5" />
          </button>
        )}
        <div className="text-gray-400 pt-1">
          {getItemIcon(item.item_type)}
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900">
            {item.description}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span>Qty: {item.quantity}</span>
            <span>{formatMoney(item.unit_price)} each</span>
            {!!item.discount_value && item.discount_value > 0 && (
              <>
                <span className="text-green-600">
                  -
                  {item.discount_type === 'percent'
                    ? `${item.discount_value}%`
                    : `${formatMoney(item.discount_value)}`}
                </span>
                {item.discount_value === 100 && item.discount_type === 'percent' && (
                  <span className="text-gray-400 line-through">
                    (was {formatMoney(item.quantity * item.unit_price)})
                  </span>
                )}
              </>
            )}
          </div>
          {item.notes && (
            <p className="mt-1 text-sm text-gray-500">
              {item.notes}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <span className="text-base font-semibold text-gray-900">
          {formatMoney(item.line_total)}
        </span>
        {canEdit && (
          <>
            <button
              onClick={() => onEdit(item)}
              className="text-gray-400 hover:text-gray-500"
              title="Edit item"
              type="button"
            >
              <PencilIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => onDelete(item.id)}
              className="text-red-400 hover:text-red-500"
              title="Delete item"
              type="button"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
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

function StatusModal({
  open: isOpen,
  onClose,
  bookingId,
  currentStatus,
  onSuccess,
}: StatusModalProps) {
  const [newStatus, setNewStatus] = useState<BookingStatus>(currentStatus);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const result = await updateBookingStatus(bookingId, newStatus);
    if (result.success) {
      onSuccess();
      onClose();
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

  return (
    <Modal open={isOpen} onClose={onClose} title="Change Booking Status" mobileFullscreen>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-gray-600">Current status:</p>
          <div className="flex items-center mt-1">
            <Badge variant={statusConfig[currentStatus].variant}>
              {statusConfig[currentStatus].label}
            </Badge>
          </div>
        </div>

        {availableStatuses.length > 0 ? (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Change to:</p>
              {availableStatuses.map((status) => {
                const StatusIcon = statusConfig[status].icon;
                return (
                  <label
                    key={status}
                    className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      type="radio"
                      value={status}
                      checked={newStatus === status}
                      onChange={(e) =>
                        setNewStatus(e.target.value as BookingStatus)
                      }
                      className="mr-3 h-5 w-5"
                    />
                    <StatusIcon className="h-5 w-5 mr-2 text-gray-400" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {statusConfig[status].label}
                      </p>
                      {status === "confirmed" && (
                        <p className="text-xs text-gray-500">
                          Customer will receive confirmation SMS
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button type="button" onClick={onClose} variant="secondary">
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || newStatus === currentStatus}
                loading={isSubmitting}
              >
                {isSubmitting ? "Updating..." : "Update Status"}
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500">
              No status changes available for completed bookings.
            </p>
            <Button onClick={onClose} variant="secondary" className="mt-4">
              Close
            </Button>
          </div>
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
  const [quantity, setQuantity] = useState(1);
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
      setQuantity(1);
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
      setQuantity(1);
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
      setQuantity(1);
    }
  }, [itemType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    let description = customDescription;
    let unitPrice = parseFloat(customPrice) || 0;

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
        unitPrice = 0; // Vendors don't have a fixed price in the schema
      }
    }

    // For total_value pricing model, quantity should be 1
    const finalQuantity =
      itemType === "catering" &&
      selectedItem &&
      "pricing_model" in selectedItem &&
      selectedItem.pricing_model === "total_value"
        ? 1
        : quantity;

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
      setQuantity(1);
      setCustomDescription("");
      setCustomPrice("");
      setDiscountAmount("");
      setNotes("");
    }

    setIsSubmitting(false);
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Add Booking Item"
      size="lg"
    >
      <Form onSubmit={handleSubmit} className="space-y-4">
        {/* Item Type Selection */}
        <FormGroup label="Item Type">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => setItemType("space")}
              className={`flex flex-col items-center p-3 rounded-lg border-2 transition-colors ${
                itemType === "space"
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <MapPinIcon className="h-6 w-6 mb-1" />
              <span className="text-sm">Space</span>
            </button>
            <button
              type="button"
              onClick={() => setItemType("catering")}
              className={`flex flex-col items-center p-3 rounded-lg border-2 transition-colors ${
                itemType === "catering"
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <SparklesIcon className="h-6 w-6 mb-1" />
              <span className="text-sm">Catering</span>
            </button>
            <button
              type="button"
              onClick={() => setItemType("vendor")}
              className={`flex flex-col items-center p-3 rounded-lg border-2 transition-colors ${
                itemType === "vendor"
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <UserGroupIcon className="h-6 w-6 mb-1" />
              <span className="text-sm">Vendor</span>
            </button>
            <button
              type="button"
              onClick={() => setItemType("electricity")}
              className={`flex flex-col items-center p-3 rounded-lg border-2 transition-colors ${
                itemType === "electricity"
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <BoltIcon className="h-6 w-6 mb-1" />
              <span className="text-sm">Electricity</span>
            </button>
            <button
              type="button"
              onClick={() => setItemType("other")}
              className={`flex flex-col items-center p-3 rounded-lg border-2 transition-colors ${
                itemType === "other"
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <ClipboardDocumentListIcon className="h-6 w-6 mb-1" />
              <span className="text-sm">Other</span>
            </button>
          </div>
        </FormGroup>

        {/* Item Selection */}
        {itemType !== "other" && itemType !== "electricity" && (
          <FormGroup
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
          </FormGroup>
        )}

        {/* Custom Description (for 'other' and 'electricity' items) */}
        {(itemType === "other" || itemType === "electricity") && (
          <FormGroup label="Description">
            <Input
              type="text"
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              required
              readOnly={itemType === "electricity"}
            />
          </FormGroup>
        )}

        {/* Quantity and Price - Different layouts based on pricing model */}
        {itemType === "catering" &&
        selectedItem &&
        "pricing_model" in selectedItem &&
        selectedItem.pricing_model === "total_value" ? (
          // Total Value Layout - Single price field
          <FormGroup label="Total Price (£)">
            <Input
              type="number"
              value={customPrice || selectedItem.cost_per_head || ""}
              onChange={(e) => setCustomPrice(e.target.value)}
              step="0.01"
              min="0"
              required
              placeholder="Enter total price"
            />
          </FormGroup>
        ) : (
          // Standard Layout - Quantity and Unit Price
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormGroup
              label={itemType === "catering" ? "Number of Guests" : "Quantity"}
            >
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                min="1"
                required
                readOnly={itemType === "electricity"}
              />
            </FormGroup>
            <FormGroup label="Unit Price (£)">
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
            </FormGroup>
          </div>
        )}

        {/* Discount */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Discount (optional)
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormGroup>
              <Input
                type="number"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                placeholder="Amount"
                min="0"
                step="0.01"
              />
            </FormGroup>
            <FormGroup>
              <Select
                value={discountType}
                onChange={(e) =>
                  setDiscountType(e.target.value as "percent" | "fixed")
                }
              >
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed Amount (£)</option>
              </Select>
            </FormGroup>
          </div>
        </div>

        {/* Notes */}
        <FormGroup label="Notes (optional)">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </FormGroup>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isSubmitting ? "Adding..." : "Add Item"}
          </Button>
        </div>
      </Form>
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
    <Modal open={isOpen} onClose={onClose} title="Apply Booking Discount" mobileFullscreen>
      <Form onSubmit={handleSubmit} className="space-y-4">
        <FormGroup label="Discount Type">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDiscountType("percent")}
              className={`p-3 rounded-lg border-2 transition-colors ${
                discountType === "percent"
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <PercentBadgeIcon className="h-6 w-6 mx-auto mb-1" />
              <span className="text-sm">Percentage</span>
            </button>
            <button
              type="button"
              onClick={() => setDiscountType("fixed")}
              className={`p-3 rounded-lg border-2 transition-colors ${
                discountType === "fixed"
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <CurrencyPoundIcon className="h-6 w-6 mx-auto mb-1" />
              <span className="text-sm">Fixed Amount</span>
            </button>
          </div>
        </FormGroup>

        <FormGroup
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
        </FormGroup>

        <FormGroup label="Reason for Discount">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            required
            placeholder="e.g., Early bird discount, loyalty customer, etc."
          />
        </FormGroup>

        {/* Preview */}
        {discountAmount && (
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Current Total:</span>
                <span className="font-medium">{formatMoney(currentTotal)}</span>
              </div>
              <div className="flex justify-between text-red-600">
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

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!discountAmount}
            loading={isSubmitting}
          >
            {isSubmitting ? "Applying..." : "Apply Discount"}
          </Button>
        </div>
      </Form>
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
  const [quantity, setQuantity] = useState(item.quantity);
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
    setQuantity(item.quantity);
    setUnitPrice(item.unit_price.toString());
    setDiscountValue(item.discount_value?.toString() || "");
    setDiscountType(item.discount_type || "percent");
    setNotes(item.notes || "");
  }, [item]);

  const calculateLineTotal = () => {
    const qty = quantity || 0;
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

    const result = await updateBookingItem(item.id, {
      quantity,
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
    <Modal open={isOpen} onClose={onClose} title="Edit Item" mobileFullscreen>
      <Form onSubmit={handleSubmit} className="space-y-4">
        <FormGroup label="Description">
          <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded">
            {item.description}
          </p>
        </FormGroup>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormGroup label="Quantity">
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              min="1"
              required
            />
          </FormGroup>

          <FormGroup label="Unit Price (£)">
            <Input
              type="number"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              min="0"
              step="0.01"
              required
            />
          </FormGroup>
        </div>

        <FormGroup label="Discount (optional)">
          <div className="flex gap-2">
            <Input
              type="number"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              min="0"
              step={discountType === "percent" ? "1" : "0.01"}
              max={discountType === "percent" ? "100" : undefined}
              placeholder="0"
              className="flex-1"
            />
            <Select
              value={discountType}
              onChange={(e) =>
                setDiscountType(e.target.value as "percent" | "fixed")
              }
              className="w-20"
            >
              <option value="percent">%</option>
              <option value="fixed">£</option>
            </Select>
          </div>
        </FormGroup>

        <FormGroup label="Notes (optional)">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g., Special pricing agreement, discount reason, etc."
          />
        </FormGroup>

        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Line Total:</span>
            <span className="font-semibold text-gray-900">
              {formatMoney(calculateLineTotal())}
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

export default function PrivateBookingDetailClient({
  bookingId,
  initialBooking,
  permissions,
  initialError,
}: PrivateBookingDetailClientProps) {
  const router = useRouter();
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
    canSendSms,
    canManageSpaces,
    canManageCatering,
    canManageVendors
  } = permissions;

  const navActions = canEdit
    ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowStatusModal(true)}>
            Change Status
          </Button>
          <LinkButton href={`/private-bookings/${bookingId}/edit`} variant="primary" size="sm">
            Edit Details
          </LinkButton>
        </div>
      )
    : undefined;

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
    if (!bookingId) {
      return;
    }
    loadBooking(bookingId);
  }, [bookingId, loadBooking]);

  const refreshBooking = useCallback(() => {
    if (!bookingId) {
      return;
    }
    loadBooking(bookingId);
  }, [bookingId, loadBooking]);

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
    }
    setDeleteConfirm(null);
  };

  const getItemIcon = (type: string) => {
    switch (type) {
      case "space":
        return <MapPinIcon className="h-5 w-5" />;
      case "catering":
        return <SparklesIcon className="h-5 w-5" />;
      case "vendor":
        return <UserGroupIcon className="h-5 w-5" />;
      default:
        return <ClipboardDocumentListIcon className="h-5 w-5" />;
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

  if (loading) {
    return (
      <PageLayout
        title="Private Booking"
        subtitle="Loading booking details"
        backButton={{
          label: "Back to Private Bookings",
          href: "/private-bookings",
        }}
        loading
        loadingLabel="Loading booking..."
      />
    )
  }

  if (!booking) {
    return (
      <PageLayout
        title="Private Booking"
        subtitle={pageError ? undefined : "Booking not found"}
        backButton={{
          label: "Back to Private Bookings",
          href: "/private-bookings",
        }}
        error={pageError ?? "We couldn't find that booking."}
      />
    )
  }

  const isDateTbd = booking.internal_notes?.includes(DATE_TBD_NOTE) ?? false;
  const internalNotesForDisplay = booking.internal_notes
    ? booking.internal_notes
        .split('\n')
        .filter((line) => line.trim() !== DATE_TBD_NOTE)
        .join('\n')
        .trim() || null
    : null

  // StatusIcon is defined inline where needed above; remove duplicate unused const here

  return (
    <PageLayout
      title={booking.customer_full_name || booking.customer_name}
      subtitle={booking.event_type ?? undefined}
      breadcrumbs={[
        { label: "Private Bookings", href: "/private-bookings" },
        { label: booking.customer_full_name || booking.customer_name, href: "" },
      ]}
      backButton={{ label: "Back to Private Bookings", href: "/private-bookings" }}
      navActions={navActions}
    >
      {pageError && (
        <Alert
          variant="error"
          title="We couldn’t refresh the booking"
          description={pageError}
          className="mb-6"
        />
      )}

      {isDateTbd && (
        <Alert
          variant="warning"
          title="Event date and time still to be confirmed"
          className="mb-6"
        >
          Keep this booking in draft until the customer confirms the event details.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Section id="event-details" title="Event Details">
            <Card>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-500">
                    Event Date
                  </label>
                  {isDateTbd ? (
                    <div className="mt-1 flex items-center text-sm font-medium text-amber-600">
                      <CalendarDaysIcon className="h-5 w-5 text-amber-500 mr-2" />
                      <span>To be confirmed</span>
                    </div>
                  ) : (
                    <>
                      <div className="mt-1 flex items-center text-sm text-gray-900">
                        <CalendarDaysIcon className="h-5 w-5 text-gray-400 mr-2" />
                        {formatDateFull(booking.event_date)}
                      </div>
                      {booking.setup_date && (
                        <p className="mt-1 text-sm text-gray-500">
                          Setup: {formatDateFull(booking.setup_date)}
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500">
                    Time
                  </label>
                  {isDateTbd ? (
                    <div className="mt-1 flex items-center text-sm font-medium text-amber-600">
                      <ClockIcon className="h-5 w-5 text-amber-500 mr-2" />
                      <span>To be confirmed</span>
                    </div>
                  ) : (
                    <>
                      <div className="mt-1 flex items-center text-sm text-gray-900">
                        <ClockIcon className="h-5 w-5 text-gray-400 mr-2" />
                        {formatTime12Hour(booking.start_time)} -{' '}
                        {formatTime12Hour(booking.end_time || null)}
                      </div>
                      {booking.setup_time && (
                        <p className="mt-1 text-sm text-gray-500">
                          Setup: {formatTime12Hour(booking.setup_time || null)}
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500">
                    Guest Count
                  </label>
                  <div className="mt-1 flex items-center text-sm text-gray-900">
                    <UserGroupIcon className="h-5 w-5 text-gray-400 mr-2" />
                    {booking.guest_count ?? "TBC"} guests
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500">
                    Event Type
                  </label>
                  <div className="mt-1 flex items-center text-sm text-gray-900">
                    <SparklesIcon className="h-5 w-5 text-gray-400 mr-2" />
                    {booking.event_type || "Private Event"}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500">
                    Contact Phone
                  </label>
                  <div className="mt-1 flex items-center text-sm">
                    <PhoneIcon className="h-5 w-5 text-gray-400 mr-2" />
                    {booking.contact_phone ? (
                      <a
                        href={`tel:${booking.contact_phone}`}
                        className="text-blue-600 hover:underline"
                      >
                        {booking.contact_phone}
                      </a>
                    ) : (
                      <span className="text-gray-500">Not provided</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500">
                    Contact Email
                  </label>
                  <div className="mt-1 flex items-center text-sm">
                    <EnvelopeIcon className="h-5 w-5 text-gray-400 mr-2" />
                    {booking.contact_email ? (
                      <a
                        href={`mailto:${booking.contact_email}`}
                        className="text-blue-600 hover:underline"
                      >
                        {booking.contact_email}
                      </a>
                    ) : (
                      <span className="text-gray-500">Not provided</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500">
                    Booking Source
                  </label>
                  <div className="mt-1 flex items-center text-sm text-gray-900">
                    <BuildingOfficeIcon className="h-5 w-5 text-gray-400 mr-2" />
                    {booking.source || "Direct"}
                  </div>
                </div>
              </div>

              {booking.balance_due_date && (
                <div className="mt-6">
                  <Alert
                    variant="warning"
                    title={`Balance due by ${formatDateFull(booking.balance_due_date)}`}
                  />
                </div>
              )}
            </Card>
          </Section>

          {/* Booking Items Card */}
          <Section
            id="booking-items"
            title="Booking Items"
            actions={
              canEdit ? (
                <div className="flex items-center gap-3">
                  {isReordering && (
                    <span className="text-xs text-gray-500">Saving order…</span>
                  )}
                  <Button onClick={() => setShowAddItemModal(true)} size="sm">
                    <PlusIcon className="h-4 w-4 mr-1" />
                    Add Item
                  </Button>
                </div>
              ) : null
            }
          >
            <Card>
              {items.length === 0 ? (
                <EmptyState icon={<ClipboardDocumentListIcon className="h-12 w-12" />}
                  title="No items added yet"
                  description={
                    canEdit
                      ? "Click 'Add Item' to build this booking."
                      : "Items will appear here once added."
                  }
                />
              ) : (
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
              )}
            </Card>
          </Section>

          {/* Notes Section */}
          {(booking.customer_requests ||
            booking.internal_notes ||
            booking.special_requirements ||
            booking.accessibility_needs) && (
            <Section id="notes-requirements" title="Notes & Requirements">
              <Card>
                <div className="space-y-4">
                  {booking.customer_requests && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-1">
                        Customer Requests
                      </h3>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">
                        {booking.customer_requests}
                      </p>
                    </div>
                  )}
                  {booking.special_requirements && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-1">
                        Special Requirements
                      </h3>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">
                        {booking.special_requirements}
                      </p>
                    </div>
                  )}
                  {booking.accessibility_needs && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-1">
                        Accessibility Needs
                      </h3>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">
                        {booking.accessibility_needs}
                      </p>
                    </div>
                  )}
                  {internalNotesForDisplay && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-1">
                        Internal Notes
                      </h3>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">
                        {internalNotesForDisplay}
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            </Section>
          )}
        </div>

        {/* Sidebar - Right 1/3 */}
        <div className="space-y-6">
          {/* Financial Summary Card */}
          <Section
            title="Financial Summary"
            actions={
              canEdit ? (
                <button
                  onClick={() => setShowDiscountModal(true)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Apply Discount
                </button>
              ) : null
            }
          >
            <Card>
              <div className="space-y-3">
                {/* Always show original price and discounts */}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">
                    Original Price (before discounts)
                  </span>
                  <span className="font-medium text-gray-900">
                    {items.length > 0
                      ? formatMoney(calculateOriginalTotal())
                      : formatMoney(0)}
                  </span>
                </div>

                {/* Show item-level discounts if any */}
                {calculateItemDiscounts() > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-green-600">Item Discounts</span>
                    <span className="font-medium text-green-600">
                      -{formatMoney(calculateItemDiscounts())}
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="font-medium text-gray-900">
                    {items.length > 0 ? formatMoney(calculateSubtotal()) : formatMoney(0)}
                  </span>
                </div>

                {/* Show booking-level discount if any */}
                {!!booking.discount_amount && booking.discount_amount > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-green-600">
                        Booking Discount (
                        {booking.discount_type === "percent"
                          ? `${booking.discount_amount}%`
                          : `£${booking.discount_amount}`}
                        )
                        {booking.discount_reason && (
                          <span className="block text-xs text-gray-500 font-normal mt-1">
                            {booking.discount_reason}
                          </span>
                        )}
                      </span>
                      <span className="font-medium text-green-600">
                        -{formatMoney(calculateSubtotal() - calculateTotal())}
                      </span>
                    </div>
                  </>
                )}

                {/* Show total savings if any discounts */}
                {(calculateItemDiscounts() > 0 ||
                  (booking.discount_amount && booking.discount_amount > 0)) && (
                  <div className="bg-green-50 p-2 rounded-lg">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-green-800">
                        Total Savings
                      </span>
                      <span className="font-bold text-green-800">
                        {formatMoney(calculateOriginalTotal() - calculateTotal())}
                      </span>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t">
                  <div className="flex justify-between">
                    <span className="text-base font-medium text-gray-900">
                      Total Event Cost
                    </span>
                    <span className="text-xl font-bold text-gray-900">
                      {formatMoney(calculateTotal())}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-3 border-t">
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs font-medium text-blue-900 mb-2">
                    Refundable Deposit
                  </p>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">
                        Security Deposit
                      </p>
                      <p className="text-xs text-gray-500">
                        {booking.deposit_paid_date
                          ? `Paid ${formatDateFull(booking.deposit_paid_date)}`
                          : "Not paid"}
                      </p>
                    </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      {formatMoney(booking.deposit_amount ?? 250)}
                    </p>
                    {!booking.deposit_paid_date &&
                      booking.status !== "draft" &&
                      canManageDeposits && (
                        <button
                            onClick={() => setShowDepositModal(true)}
                            className="mt-1 text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            Record Payment
                          </button>
                        )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    Returned after event (subject to terms)
                  </p>
                </div>

                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700">
                      Balance Due
                    </p>
                    <p className="text-xs text-gray-500">
                      For booking items only
                    </p>
                    {booking.balance_due_date && (
                      <p className="text-xs text-gray-500">
                        Due by {formatDateFull(booking.balance_due_date)}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      {isDateTbd ? 'To be confirmed' : formatMoney(calculateTotal())}
                    </p>
                    {!isDateTbd && !booking.final_payment_date && calculateTotal() > 0 && canManageDeposits && (
                      <button
                        onClick={() => setShowFinalModal(true)}
                        className="mt-1 text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Record Payment
                      </button>
                    )}
                  </div>
                </div>

                {booking.final_payment_date && (
                  <div className="pt-3 border-t">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-green-600 font-medium">
                        ✓ Fully Paid
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatDateFull(booking.final_payment_date)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </Section>

          {/* Quick Actions Card */}
          <Section id="quick-actions" title="Quick Actions">
            <Card>
              <div className="space-y-3">
                {canSendSms && (
                  <Link
                    href={`/private-bookings/${bookingId}/messages`}
                    className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50 rounded-lg hover:bg-gray-100"
                  >
                    <div className="flex items-center">
                      <ChatBubbleLeftRightIcon className="h-5 w-5 mr-3 text-purple-600" />
                      Send SMS Message
                    </div>
                    <ChevronRightIcon className="h-4 w-4 text-gray-400" />
                  </Link>
                )}

                <Link
                  href={`/private-bookings/${bookingId}/contract`}
                  className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50 rounded-lg hover:bg-gray-100"
                >
                  <div className="flex items-center">
                    <DocumentIcon className="h-5 w-5 mr-3 text-blue-600" />
                    Generate Contract
                  </div>
                  <ChevronRightIcon className="h-4 w-4 text-gray-400" />
                </Link>

                <button
                  disabled
                  className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-gray-400 bg-gray-50 rounded-lg cursor-not-allowed opacity-50"
                >
                  <div className="flex items-center">
                    <DocumentTextIcon className="h-5 w-5 mr-3 text-gray-400" />
                    Upload Document
                  </div>
                  <span className="text-xs text-gray-400">Coming Soon</span>
                </button>
              </div>
            </Card>
          </Section>

          {/* Booking Info Card */}
          <Section id="booking-info" title="Booking Information">
            <Card>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500">
                    Booking ID
                  </label>
                  <p className="mt-1 text-sm text-gray-900 font-mono">
                    {booking.id.slice(0, 8)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500">
                    Created
                  </label>
                  <p className="mt-1 text-sm text-gray-900">
                    {formatDateFull(booking.created_at)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500">
                    Last Updated
                  </label>
                  <p className="mt-1 text-sm text-gray-900">
                    {formatDateFull(booking.updated_at)}
                  </p>
                </div>
                {booking.contract_version > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500">
                      Contract Version
                    </label>
                    <p className="mt-1 text-sm text-gray-900">
                      v{booking.contract_version}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </Section>
        </div>
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDeleteItem(deleteConfirm)}
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone."
        confirmText="Delete"
        confirmVariant="danger"
      />

      {/* Modals */}
      {canManageDeposits && (
        <PaymentModal
          open={showDepositModal}
          onClose={() => setShowDepositModal(false)}
          bookingId={bookingId}
          type="deposit"
          amount={booking.deposit_amount ?? 250}
          onSuccess={refreshBooking}
        />
      )}

      {canManageDeposits && (
        <PaymentModal
          open={showFinalModal}
          onClose={() => setShowFinalModal(false)}
          bookingId={bookingId}
          type="final"
          amount={calculateTotal()}
          onSuccess={refreshBooking}
        />
      )}

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
    </PageLayout>
  );
}
