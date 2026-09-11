import { createAdminClient } from '@/lib/supabase/admin'
import { getGoogleReviewLink } from '@/lib/events/review-link'
import {
  PRIVATE_BOOKING_MESSAGE_COLUMNS,
  type CancellationAmounts,
  type CatalogueBooking,
  type CatalogueContext,
} from '@/lib/private-bookings/message-catalogue'

type AdminClient = ReturnType<typeof createAdminClient>

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * What is still owed, computed exactly as the monitor cron does before a balance reminder, so a
 * rebuilt reminder states the same amount.
 */
async function loadBalanceAmount(client: AdminClient, bookingId: string): Promise<number | null> {
  const { data, error } = await (client.from('private_bookings_with_details') as any)
    .select('balance_remaining, gross_total, calculated_total, total_amount')
    .eq('id', bookingId)
    .maybeSingle()
  if (error || !data) return null
  const totalAmount = Number(data.gross_total ?? data.calculated_total ?? data.total_amount ?? 0)
  const viewBalanceRemaining = Number(data.balance_remaining)
  const balanceDue = Number.isFinite(viewBalanceRemaining) ? Math.max(viewBalanceRemaining, 0) : Math.max(totalAmount, 0)
  return Number.isFinite(balanceDue) ? balanceDue : null
}

/**
 * Loads a private booking and whatever else its message needs to be rebuilt. Returns null when
 * the booking cannot be read.
 */
export async function loadPrivateBookingMessageContext(input: {
  client: AdminClient
  bookingId: string
  triggerType: string
  now: Date
  cancellation?: CancellationAmounts | null
  storedFacts?: Record<string, unknown> | null
}): Promise<CatalogueContext | null> {
  const { data, error } = await (input.client.from('private_bookings') as any)
    .select(PRIVATE_BOOKING_MESSAGE_COLUMNS)
    .eq('id', input.bookingId)
    .maybeSingle()

  if (error || !data) return null

  const context: CatalogueContext = {
    booking: data as CatalogueBooking,
    now: input.now,
    cancellation: input.cancellation ?? null,
    storedFacts: input.storedFacts ?? null,
  }

  if (input.triggerType.startsWith('balance_reminder_')) {
    context.balanceAmount = await loadBalanceAmount(input.client, input.bookingId)
  }
  if (input.triggerType === 'review_request') {
    context.reviewLink = await getGoogleReviewLink(input.client as any)
  }

  return context
}

/** Cancellation amounts from facts stored with a delivery (the bounce fallback). */
export function cancellationFromFacts(facts: Record<string, unknown> | null | undefined): CancellationAmounts | null {
  if (!facts || facts.refund_amount === undefined) return null
  return {
    refundAmount: toNumber(facts.refund_amount),
    retainedAmount: toNumber(facts.retained_amount),
    deductionAmount: toNumber(facts.deduction_amount),
  }
}

/**
 * Cancellation amounts from a queued text's metadata (Send Now). The queue has always stored the
 * refund and retained amounts; for a partial refund the retained amount is the administration
 * deduction (financial.ts sets both from the same value).
 */
export function cancellationFromQueueMetadata(metadata: Record<string, unknown> | null | undefined): CancellationAmounts | null {
  if (!metadata || metadata.refund_amount === undefined) return null
  const retained = toNumber(metadata.retained_amount)
  return {
    refundAmount: toNumber(metadata.refund_amount),
    retainedAmount: retained,
    deductionAmount: metadata.financial_outcome === 'deposit_partial_refund' ? retained : 0,
  }
}
