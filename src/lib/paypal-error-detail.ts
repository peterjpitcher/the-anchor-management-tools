/**
 * What PayPal said when a call to it failed, read field by field.
 *
 * `JSON.stringify(error)` on a PayPalApiError gives `{}` for the parts that matter, and its message
 * alone drops the issue codes that say whether the guest's bank refused the payment or we got
 * something wrong. This reads the shape PayPalApiError carries (`status`, and `details` holding
 * PayPal's own `name`, `message`, `debug_id` and `details[].issue`) without importing it, so a
 * caller whose tests stand in for `@/lib/paypal` still gets an answer. Never throws.
 */

export type PayPalErrorDetail = {
  /** HTTP status PayPal answered with, when the error came from its API. */
  status: number | null
  /** PayPal's error name, e.g. UNPROCESSABLE_ENTITY. */
  name: string | null
  /** PayPal's issue codes, upper case, e.g. INSTRUMENT_DECLINED. */
  issues: string[]
  /** PayPal's debug id, which their support asks for. */
  debugId: string | null
  message: string | null
}

const MAX_TEXT = 300

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null
}

export function describePayPalError(error: unknown): PayPalErrorDetail {
  const source = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const body = (source.details && typeof source.details === 'object' ? source.details : {}) as Record<string, unknown>
  const issueRows = Array.isArray(body.details) ? body.details : []

  return {
    status: typeof source.status === 'number' && Number.isFinite(source.status) ? source.status : null,
    name: text(body.name),
    issues: issueRows
      .map((row) => text((row as Record<string, unknown> | null)?.issue))
      .filter((issue): issue is string => issue !== null)
      .map((issue) => issue.toUpperCase())
      .slice(0, 10),
    debugId: text(body.debug_id),
    message: text(body.message) ?? text(source.message) ?? (typeof error === 'string' ? text(error) : null),
  }
}

/**
 * Issue codes that mean the guest, their bank or their PayPal account stopped the payment. Nothing
 * for us to fix: the guest tries another card or calls.
 */
const GUEST_SIDE_ISSUES = new Set([
  'INSTRUMENT_DECLINED',
  'PAYER_ACTION_REQUIRED',
  'PAYER_CANNOT_PAY',
  'PAYER_ACCOUNT_RESTRICTED',
  'PAYER_ACCOUNT_LOCKED_OR_CLOSED',
  'TRANSACTION_REFUSED',
  'TRANSACTION_LIMIT_EXCEEDED',
  'REDIRECT_PAYER_FOR_ALTERNATE_FUNDING',
  'ORDER_NOT_APPROVED',
  'CARD_EXPIRED',
])

/** True when PayPal's issue codes say the guest's side refused the payment. */
export function isGuestSidePayPalRefusal(detail: Pick<PayPalErrorDetail, 'issues'>): boolean {
  return detail.issues.some((issue) => GUEST_SIDE_ISSUES.has(issue))
}
