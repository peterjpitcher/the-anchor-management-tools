export const BILLING_RUN_IN_FLIGHT_GRACE_MS = 10 * 60 * 1000

type BillingRunGuardInput = {
  createdByThisInvocation: boolean
  status: string | null | undefined
  invoiceId: string | null | undefined
  startedAt: string | null | undefined
  nowMs?: number
  graceMs?: number
}

/**
 * A newly inserted run belongs to the current invocation and must continue.
 * Only an existing, recent run without an invoice can belong to another worker.
 */
export function shouldSkipConcurrentBillingRun({
  createdByThisInvocation,
  status,
  invoiceId,
  startedAt,
  nowMs = Date.now(),
  graceMs = BILLING_RUN_IN_FLIGHT_GRACE_MS,
}: BillingRunGuardInput): boolean {
  if (createdByThisInvocation || status !== 'processing' || invoiceId) {
    return false
  }

  const startedAtMs = Date.parse(String(startedAt || ''))
  if (!Number.isFinite(startedAtMs)) {
    return false
  }

  return nowMs - startedAtMs < graceMs
}
