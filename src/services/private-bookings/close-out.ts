import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

/**
 * Closing a private hire after the night (BK-062 and BK-131, customer bookings review of
 * 24 October 2026; owner decision D27).
 *
 * After a hire nothing recorded what happened to the security deposit, or that the balance was
 * paid, and nothing closed the booking: 31 past hires were still "confirmed", 18 deposits had no
 * outcome and 13 balances no payment. The owner's assumption (D27) is that balances and deposits
 * are usually settled at the till on the night, so the close-out takes:
 * - the balance: one tick, "settled at the till", which records what is outstanding as paid by
 *   card or cash (staff pick which);
 * - the deposit: returned at the till (recorded as a cash or card refund), kept in full or in
 *   part with a reason (the rest returned at the till), or put against the bill (recorded as a
 *   balance payment of the deposit, so the bill and the deposit agree). A refund through PayPal
 *   goes through Process Refund instead, which closes the deposit itself;
 * - and closes the booking: status completed, post-event complete.
 *
 * It sends the guest nothing. Completing through updateBooking sends the thank-you message, which
 * must not reach a guest whose party was months ago, so the close-out writes the status itself.
 * Everything it records is audited on the booking.
 *
 * All of it happens in one database transaction, close_out_private_booking (migration
 * 20261027163736), under the booking's row lock: either every part is recorded and the booking is
 * closed, or nothing is. A failure part-way used to leave a deposit applied to the bill with the
 * booking still showing it open, so a retry applied it twice. The checks here only give staff a
 * plain message before the call; the function checks everything again under the lock.
 */

export type DepositOutcome =
  | { outcome: 'returned'; method: 'cash' | 'card' }
  | { outcome: 'kept'; amount: number; reason: string; restMethod?: 'cash' | 'card' }
  | { outcome: 'applied' }

export type CloseOutInput = {
  bookingId: string
  /** Record the outstanding balance as paid at the till, by this method. */
  balanceSettledAtTill?: { method: 'cash' | 'card' } | null
  deposit?: DepositOutcome | null
  performedBy: string
}

export type CloseOutResult = {
  balanceRecorded: number
  depositStatus: string | null
  completed: boolean
}

export class CloseOutError extends Error {}

const CLOSE_OUT_PREFIX = 'close_out: '

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export async function closeOutPrivateBooking(input: CloseOutInput): Promise<CloseOutResult> {
  const deposit = input.deposit ?? null
  if (deposit?.outcome === 'kept') {
    if (!Number.isFinite(deposit.amount) || deposit.amount <= 0) {
      throw new CloseOutError('Enter the amount of the deposit that was kept')
    }
    if (!deposit.reason.trim()) throw new CloseOutError('Please record why the deposit was kept')
  }

  const db = createAdminClient()
  const { data, error } = await (db.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'close_out_private_booking',
    {
      p_booking_id: input.bookingId,
      p_balance_method: input.balanceSettledAtTill?.method ?? null,
      p_deposit_outcome: deposit?.outcome ?? null,
      p_deposit_method: deposit?.outcome === 'returned' ? deposit.method : deposit?.outcome === 'kept' ? deposit.restMethod ?? null : null,
      p_kept_amount: deposit?.outcome === 'kept' ? money(deposit.amount) : null,
      p_kept_reason: deposit?.outcome === 'kept' ? deposit.reason.trim() : null,
      p_performed_by: input.performedBy,
    },
  )
  if (error) {
    const at = error.message.indexOf(CLOSE_OUT_PREFIX)
    if (at >= 0) throw new CloseOutError(error.message.slice(at + CLOSE_OUT_PREFIX.length))
    logger.error('A private hire close-out failed, and nothing was recorded', {
      error: new Error(error.message),
      metadata: { bookingId: input.bookingId },
    })
    throw new Error(`Could not close out the hire, and nothing was recorded: ${error.message}`)
  }
  const row = (Array.isArray(data) ? data[0] : data) as { balance_recorded?: unknown; deposit_status?: unknown } | null
  if (!row) throw new Error('Could not close out the hire: no result came back')
  return {
    balanceRecorded: money(Number(row.balance_recorded) || 0),
    depositStatus: typeof row.deposit_status === 'string' ? row.deposit_status : null,
    completed: true,
  }
}
