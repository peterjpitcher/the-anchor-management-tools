type EventPricingInput = {
  is_free?: boolean | null;
  payment_mode?: string | null;
  price?: number | string | null;
  price_per_seat?: number | string | null;
};

export type EventPaymentMode = 'free' | 'cash_only' | 'prepaid';

function positiveMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function resolveEventPriceAmount(event: EventPricingInput): number {
  const positivePrice = positiveMoney(event.price_per_seat) ?? positiveMoney(event.price);
  if (positivePrice !== null) return positivePrice;
  if (event.is_free === true) return 0;
  return 0;
}

export function resolveEventPaymentMode(event: EventPricingInput): string {
  const amount = resolveEventPriceAmount(event);
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
  is_free: boolean;
  payment_mode: EventPaymentMode;
} {
  const price = resolveEventPriceAmount(event);
  const resolved = resolveEventPaymentMode(event);
  const paymentMode: EventPaymentMode =
    resolved === 'prepaid' || resolved === 'cash_only' || resolved === 'free'
      ? resolved
      : price > 0
        ? 'cash_only'
        : 'free';

  return {
    price,
    is_free: price === 0 && paymentMode === 'free',
    payment_mode: paymentMode,
  };
}
