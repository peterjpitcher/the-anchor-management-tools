type EventPricingInput = {
  is_free?: boolean | null;
  payment_mode?: string | null;
  price?: number | string | null;
  price_per_seat?: number | string | null;
};

function positiveMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function resolveEventPriceAmount(event: EventPricingInput): number {
  if (event.is_free === true) return 0;
  return positiveMoney(event.price_per_seat) ?? positiveMoney(event.price) ?? 0;
}

export function resolveEventPaymentMode(event: EventPricingInput): string {
  const amount = resolveEventPriceAmount(event);
  const explicit =
    typeof event.payment_mode === 'string' && event.payment_mode.trim()
      ? event.payment_mode.trim()
      : null;

  if (event.is_free === true) return 'free';
  if (amount > 0 && explicit === 'free') return 'cash_only';
  if (explicit) return explicit;
  return amount > 0 ? 'cash_only' : 'free';
}
