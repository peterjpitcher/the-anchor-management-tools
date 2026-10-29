import { EVENT_PAYMENT_MODE_LOCKED_MESSAGE } from '@/lib/events/event-change-guard'

/**
 * What an action returns when an event change is refused or needs a manager to confirm it first
 * (BK-026, BK-036). The drawer and the ticket screens show `confirmation.lines` in a confirm
 * dialog and send the change again with the confirmation flag set.
 */
export type EventChangeRefusal = {
  error: string
  confirmation?: { lines: string[] }
}

/**
 * Turns the service's refusal errors, and the database's payment method lock, into an action
 * result. Matched by name, not instanceof, so a mocked service module still maps them. Returns
 * null for any other error, which the caller handles as before.
 */
export function describeEventChangeRefusal(error: unknown): EventChangeRefusal | null {
  if (!(error instanceof Error)) return null
  if (error.name === 'EventChangeNeedsConfirmationError') {
    const lines = (error as Error & { confirmations?: unknown }).confirmations
    return {
      error: 'Confirm this change before it is saved.',
      confirmation: { lines: Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string') : [] },
    }
  }
  if (error.name === 'EventChangeBlockedError') return { error: error.message }
  if (isPaymentModeLockedError(error)) return { error: EVENT_PAYMENT_MODE_LOCKED_MESSAGE }
  return null
}

/** The database refused a payment method change because the event has bookings (D9). */
export function isPaymentModeLockedError(error: unknown): boolean {
  if (!error) return false
  const text = typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : String(error)
  return text.includes('event_payment_mode_locked')
}
