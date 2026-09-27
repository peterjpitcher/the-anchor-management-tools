/**
 * Reads the refund resource PayPal sends with PAYMENT.CAPTURE.REFUNDED, PAYMENT.REFUND.* and
 * PAYMENT.CAPTURE.REVERSED.
 *
 * A reversal (a chargeback, or PayPal taking a payment back) is documented as arriving in the
 * same shape as a refund: its own id, the amount taken back, a status, and an `up` link to the
 * capture it came out of. Nothing here guesses when a field is missing: the caller decides what an
 * unreadable payload means, and for money that is always a human, never a default.
 */

export type PayPalRefundStatus = 'COMPLETED' | 'PENDING' | 'FAILED' | 'CANCELLED'

export type PayPalRefundResource = {
  /** The PayPal refund (or reversal) id. */
  refundId: string | null
  /** The capture the money came out of, from the HATEOAS `up` link. */
  captureId: string | null
  /** Positive amount in pounds to two places, or null when it cannot be read exactly. */
  amount: number | null
  currency: string | null
  /** A status we know how to record, or null. `rawStatus` keeps whatever PayPal actually sent. */
  status: PayPalRefundStatus | null
  rawStatus: string | null
  statusDetails: string | null
}

const KNOWN_STATUSES = new Set<PayPalRefundStatus>(['COMPLETED', 'PENDING', 'FAILED', 'CANCELLED'])

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The capture id on a refund resource's `up` link, or '' when there is none. */
export function readCaptureIdFromRefundResource(resource: any): string { // PayPal payloads are untyped here
  const link = Array.isArray(resource?.links)
    ? resource.links.find((candidate: any) => candidate?.rel === 'up')?.href // untyped PayPal link
    : undefined
  if (typeof link !== 'string') return ''
  return link.split('/').pop()?.trim() ?? ''
}

/** Exact pounds from a PayPal amount string: "12.5" and "12.50" are fine, "12.505" or "-3" are not. */
export function parsePayPalAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const raw = String(value).trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null
  const pennies = Math.round(Number(raw) * 100)
  return Number.isSafeInteger(pennies) && pennies > 0 ? pennies / 100 : null
}

export function readPayPalRefundResource(event: any): PayPalRefundResource { // PayPal webhook event, untyped
  const resource = event?.resource ?? {}
  const rawStatus = trimmed(resource?.status)
  const upperStatus = rawStatus ? rawStatus.toUpperCase() : null
  const currency = trimmed(resource?.amount?.currency_code)

  return {
    refundId: trimmed(resource?.id),
    captureId: readCaptureIdFromRefundResource(resource) || null,
    amount: parsePayPalAmount(resource?.amount?.value),
    currency: currency ? currency.toUpperCase() : null,
    status: upperStatus && KNOWN_STATUSES.has(upperStatus as PayPalRefundStatus)
      ? (upperStatus as PayPalRefundStatus)
      : null,
    rawStatus,
    statusDetails: trimmed(resource?.status_details?.reason),
  }
}
