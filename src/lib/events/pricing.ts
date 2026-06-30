type EventPricingInput = {
  is_free?: boolean | null;
  payment_mode?: string | null;
  price?: number | string | null;
  price_per_seat?: number | string | null;
  online_discount_type?: string | null;
  online_discount_value?: number | string | null;
};

export type EventPaymentMode = 'free' | 'cash_only' | 'prepaid';
export type EventOnlineDiscountType = 'fixed' | 'percent';

function positiveMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function resolveEventPriceAmount(event: EventPricingInput): number {
  const ticketPrice = resolveEventTicketPriceAmount(event);
  const discount = resolveEventOnlineDiscountAmount(event);
  return Math.max(0, Number((ticketPrice - discount).toFixed(2)));
}

export function resolveEventTicketPriceAmount(event: EventPricingInput): number {
  const positivePrice = positiveMoney(event.price_per_seat) ?? positiveMoney(event.price);
  if (positivePrice !== null) return positivePrice;
  if (event.is_free === true) return 0;
  return 0;
}

function normalizeEventOnlineDiscountType(value: unknown): EventOnlineDiscountType | null {
  return value === 'fixed' || value === 'percent' ? value : null;
}

export function resolveEventOnlineDiscountAmount(event: EventPricingInput): number {
  if (event.payment_mode !== 'prepaid') return 0;

  const ticketPrice = resolveEventTicketPriceAmount(event);
  if (ticketPrice <= 0) return 0;

  const discountType = normalizeEventOnlineDiscountType(event.online_discount_type);
  const rawValue = event.online_discount_value;
  const discountValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (!discountType || !Number.isFinite(discountValue) || discountValue <= 0) return 0;

  const amount = discountType === 'percent'
    ? ticketPrice * (Math.min(discountValue, 100) / 100)
    : discountValue;

  return Math.min(ticketPrice, Number(amount.toFixed(2)));
}

export function resolveEventPaymentMode(event: EventPricingInput): string {
  const amount = resolveEventTicketPriceAmount(event);
  const explicit =
    typeof event.payment_mode === 'string' && event.payment_mode.trim()
      ? event.payment_mode.trim()
      : null;

  if (amount > 0 && explicit === 'free') return 'cash_only';
  if (amount > 0) return explicit === 'prepaid' ? 'prepaid' : 'cash_only';
  if (event.is_free === true) return 'free';
  if (explicit) return explicit;
  return 'free';
}

export function normalizeEventPricingFields(event: EventPricingInput): {
  price: number;
  online_discount_type: EventOnlineDiscountType | null;
  online_discount_value: number | null;
  is_free: boolean;
  payment_mode: EventPaymentMode;
} {
  const price = resolveEventTicketPriceAmount(event);
  const resolved = resolveEventPaymentMode(event);
  const paymentMode: EventPaymentMode =
    resolved === 'prepaid' || resolved === 'cash_only' || resolved === 'free'
      ? resolved
      : price > 0
        ? 'cash_only'
        : 'free';
  const discountType = price > 0 && paymentMode === 'prepaid'
    ? normalizeEventOnlineDiscountType(event.online_discount_type)
    : null;
  const rawDiscountValue = event.online_discount_value;
  const parsedDiscountValue = typeof rawDiscountValue === 'number' ? rawDiscountValue : Number(rawDiscountValue);
  const discountValue =
    discountType && Number.isFinite(parsedDiscountValue) && parsedDiscountValue > 0
      ? Number((discountType === 'percent' ? Math.min(parsedDiscountValue, 100) : parsedDiscountValue).toFixed(2))
      : null;

  return {
    price,
    online_discount_type: discountValue ? discountType : null,
    online_discount_value: discountValue,
    is_free: price === 0 && paymentMode === 'free',
    payment_mode: paymentMode,
  };
}
