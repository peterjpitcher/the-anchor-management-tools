import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-063: a PAYMENT.CAPTURE.COMPLETED for a private booking that has been cancelled used to make
 * finalizeDepositPayment throw, so the webhook answered 500 and PayPal retried while the money
 * sat unrecorded. The capture is now recorded for refunding (finalizeDepositPayment says so with
 * paidAfterClose) and the webhook settles normally.
 */

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/services/private-bookings', () => ({ finalizeDepositPayment: vi.fn() }))

import { finalizeDepositPayment } from '@/services/private-bookings'
import { handleDepositCaptureCompleted } from '@/lib/paypal-domains/private-bookings'

const BOOKING_ID = 'b1d0f6cc-0c74-4f29-8e6b-2f2a3a1e2222'

function makeSupabase() {
  const auditRows: Record<string, unknown>[] = []
  const client = {
    from: vi.fn((table: string) => {
      if (table !== 'audit_logs') throw new Error(`Unexpected table ${table}`)
      return { insert: vi.fn(async (row: Record<string, unknown>) => { auditRows.push(row); return { error: null } }) }
    }),
  }
  return { client, auditRows }
}

const event = {
  id: 'WH-1',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: { id: 'CAPTURE-LATE', custom_id: `pb-deposit-${BOOKING_ID}`, amount: { value: '250.00', currency_code: 'GBP' } },
}

describe('a deposit capture webhook for a cancelled private booking', () => {
  beforeEach(() => vi.clearAllMocks())

  it('settles without throwing and records that the money came after the booking closed', async () => {
    vi.mocked(finalizeDepositPayment).mockResolvedValueOnce({ success: true, paidAfterClose: true } as never)
    const { client, auditRows } = makeSupabase()

    await expect(handleDepositCaptureCompleted(client as never, event)).resolves.toBeUndefined()

    expect(finalizeDepositPayment).toHaveBeenCalledWith(
      { bookingId: BOOKING_ID, amount: 250, method: 'paypal', paypalCaptureId: 'CAPTURE-LATE' },
      client,
    )
    expect(auditRows.map((row) => row.operation_type)).toEqual([
      'paypal_deposit_capture_attempted_via_webhook',
      'paypal_deposit_captured_after_close_via_webhook',
    ])
  })

  it('keeps the ordinary audit name for an open booking', async () => {
    vi.mocked(finalizeDepositPayment).mockResolvedValueOnce({ success: true } as never)
    const { client, auditRows } = makeSupabase()

    await handleDepositCaptureCompleted(client as never, event)

    expect(auditRows.map((row) => row.operation_type)).toEqual([
      'paypal_deposit_capture_attempted_via_webhook',
      'paypal_deposit_captured_via_webhook',
    ])
  })
})
