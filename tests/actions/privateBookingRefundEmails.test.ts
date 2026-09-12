import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * What a private booking guest is told when their money goes back.
 *
 * Three defects from the 11 September email review are pinned here:
 *  - PB-4: a deposit refunded in two payments produced two emails claiming deductions that never
 *    happened, because each worked the deduction out as the deposit minus the payment in front of
 *    it. The guest who got the whole £250 back was told £150 and then £100 had been deducted.
 *  - PB-6: the reason staff type into the refund dialog is labelled "internal only" and was being
 *    emailed to the guest verbatim.
 *  - PB-BR-4: the cancellation email promises "we'll refund £150 within 10 working days and
 *    confirm once it's on the way", and nothing ever confirmed it.
 *  - PB-19: one PayPal refund sent two emails that disagreed, the second with no contact details
 *    and no booking attached.
 */

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  refundPayPalPayment: vi.fn(),
}))
vi.mock('@/lib/refund-notifications', () => ({ sendRefundNotification: vi.fn().mockResolvedValue('sent') }))
vi.mock('@/lib/email/private-booking-emails', () => ({
  sendDepositRefundEmail: vi.fn().mockResolvedValue(undefined),
  sendDepositPartRefundEmail: vi.fn().mockResolvedValue(undefined),
  sendPrivateBookingRefundSentEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/table-bookings/deposit-refund', () => ({ resolveSeasonalDepositRefund: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { processManualRefund, processPayPalRefund } from '@/app/actions/refundActions'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { refundPayPalPayment } from '@/lib/paypal'
import { checkUserPermission } from '@/app/actions/rbac'
import { sendRefundNotification } from '@/lib/refund-notifications'
import {
  sendDepositPartRefundEmail,
  sendDepositRefundEmail,
  sendPrivateBookingRefundSentEmail,
} from '@/lib/email/private-booking-emails'

const mockedCreateClient = createClient as unknown as Mock
const mockedAdmin = createAdminClient as unknown as Mock
const mockedRefund = refundPayPalPayment as unknown as Mock
const mockedPermission = checkUserPermission as unknown as Mock
const mockedNotification = sendRefundNotification as unknown as Mock

const INTERNAL_REASON = 'Chargeback risk, see the note from the GM'

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pb-1',
    status: 'completed',
    paypal_deposit_capture_id: 'CAPTURE-1',
    deposit_paid_date: new Date().toISOString(),
    deposit_amount: 250,
    customer_id: 'cust-1',
    customer_first_name: 'Alex',
    customer_name: 'Alex Doe',
    contact_email: 'alex@example.com',
    contact_phone: '+447700900000',
    event_date: '2026-08-15',
    event_type: 'Birthday party',
    date_tbd: false,
    internal_notes: null,
    ...overrides,
  }
}

/** A chain that answers the cumulative-refund read differently from the pending-refund read. */
function makeDb(options: { booking?: Record<string, unknown>; refundRows?: Array<{ amount: number }>; refundsError?: unknown } = {}) {
  const booking = options.booking ?? bookingRow()
  const refundRows = options.refundRows ?? []
  const rpc = vi.fn().mockResolvedValue({ data: [{ refund_id: 'refund-1' }], error: null })

  const chain = (result: any) => {
    const p: any = {}
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'update', 'insert', 'delete']) p[m] = vi.fn(() => p)
    p.maybeSingle = () => Promise.resolve(result)
    p.single = () => Promise.resolve(result)
    p.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej)
    return p
  }

  const refundsChain = () => {
    const p: any = {}
    let selected = ''
    for (const m of ['eq', 'is', 'in', 'order', 'limit', 'update', 'insert', 'delete']) p[m] = vi.fn(() => p)
    p.select = vi.fn((cols?: string) => {
      selected = cols ?? ''
      return p
    })
    const pending = { data: null, error: null }
    const answer = () =>
      selected === 'amount'
        ? { data: options.refundsError ? null : refundRows, error: options.refundsError ?? null }
        : pending
    p.maybeSingle = () => Promise.resolve(answer())
    p.single = () => Promise.resolve(answer())
    p.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej)
    return p
  }

  const from = vi.fn((table: string) => {
    if (table === 'private_bookings') return chain({ data: booking, error: null })
    if (table === 'payment_refunds') return refundsChain()
    return chain({ data: null, error: null })
  })

  return { from, rpc }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  })
  mockedPermission.mockResolvedValue(true)
  mockedRefund.mockResolvedValue({ status: 'COMPLETED', refundId: 'pp-refund-1', currency: 'GBP' })
  mockedNotification.mockResolvedValue('sent')
})

describe('a deposit refunded in two payments', () => {
  it('states the position across both refunds, not the deposit minus this one', async () => {
    // First payment: £100 of the £250 deposit is back, £150 is not.
    mockedAdmin.mockReturnValue(makeDb({ refundRows: [{ amount: 100 }] }))
    await processManualRefund('private_booking', 'pb-1', 100, INTERNAL_REASON, 'bank_transfer')

    expect(sendDepositPartRefundEmail).toHaveBeenCalledTimes(1)
    expect(sendDepositPartRefundEmail).toHaveBeenCalledWith(
      expect.objectContaining({ deposit_amount: 250, refund_amount: 100, total_refunded: 100 })
    )
    expect(sendDepositRefundEmail).not.toHaveBeenCalled()

    // Second payment: the other £150. The deposit is now fully refunded.
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedAdmin.mockReturnValue(makeDb({ refundRows: [{ amount: 100 }, { amount: 150 }] }))
    await processManualRefund('private_booking', 'pb-1', 150, INTERNAL_REASON, 'bank_transfer')

    expect(sendDepositPartRefundEmail).not.toHaveBeenCalled()
    expect(sendDepositRefundEmail).toHaveBeenCalledWith(
      expect.objectContaining({ refund_amount: 150, total_refunded: 250 })
    )
  })

  it('never passes the staff reason to the guest', async () => {
    mockedAdmin.mockReturnValue(makeDb({ refundRows: [{ amount: 100 }] }))
    await processManualRefund('private_booking', 'pb-1', 100, INTERNAL_REASON, 'cash')

    const payload = (sendDepositPartRefundEmail as unknown as Mock).mock.calls[0][0]
    expect(JSON.stringify(payload)).not.toContain('Chargeback')
    expect(payload).not.toHaveProperty('deduction_reason')
  })

  it('says nothing at all when the completed refunds cannot be read', async () => {
    // Guessing at the deductions is the bug this replaces, so an unreadable ledger sends nothing.
    mockedAdmin.mockReturnValue(makeDb({ refundsError: { message: 'schema cache stale' } }))
    await processManualRefund('private_booking', 'pb-1', 100, INTERNAL_REASON, 'cash')

    expect(sendDepositPartRefundEmail).not.toHaveBeenCalled()
    expect(sendDepositRefundEmail).not.toHaveBeenCalled()
  })
})

describe('a refund on a cancelled booking', () => {
  it('confirms the refund the cancellation email promised', async () => {
    mockedAdmin.mockReturnValue(
      makeDb({ booking: bookingRow({ status: 'cancelled' }), refundRows: [{ amount: 150 }] })
    )

    await processManualRefund('private_booking', 'pb-1', 150, INTERNAL_REASON, 'bank_transfer')

    expect(sendPrivateBookingRefundSentEmail).toHaveBeenCalledWith(
      expect.objectContaining({ refund_amount: 150, refund_method: 'bank_transfer' })
    )
    // Not the post-event deposit notice: there was no event.
    expect(sendDepositPartRefundEmail).not.toHaveBeenCalled()
    expect(sendDepositRefundEmail).not.toHaveBeenCalled()
  })

  it('sends nothing for a booking that is neither completed nor cancelled', async () => {
    mockedAdmin.mockReturnValue(makeDb({ booking: bookingRow({ status: 'confirmed' }), refundRows: [{ amount: 50 }] }))

    await processManualRefund('private_booking', 'pb-1', 50, INTERNAL_REASON, 'cash')

    expect(sendPrivateBookingRefundSentEmail).not.toHaveBeenCalled()
    expect(sendDepositRefundEmail).not.toHaveBeenCalled()
    expect(sendDepositPartRefundEmail).not.toHaveBeenCalled()
  })
})

describe('one refund, one email', () => {
  it('drops the generic refund notice when the booking email has gone', async () => {
    mockedAdmin.mockReturnValue(makeDb({ refundRows: [{ amount: 250 }] }))

    const result = await processPayPalRefund('private_booking', 'pb-1', 250, INTERNAL_REASON)

    expect(result.success).toBe(true)
    expect(sendDepositRefundEmail).toHaveBeenCalledTimes(1)
    expect(mockedNotification).not.toHaveBeenCalled()
  })

  it('still sends the generic notice for a table booking, which has no email of its own', async () => {
    const db = makeDb()
    db.from = vi.fn((table: string) => {
      const p: any = {}
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'update', 'insert', 'delete']) p[m] = vi.fn(() => p)
      const data =
        table === 'table_bookings'
          ? {
              id: 'tb-1',
              paypal_deposit_capture_id: 'CAPTURE-1',
              card_capture_completed_at: new Date().toISOString(),
              deposit_amount: 50,
              deposit_amount_locked: null,
              customer_id: 'cust-1',
              customers: { first_name: 'Alex', last_name: 'Doe', email: 'a@e.com', mobile_e164: '+447700900000' },
              deposit_refund_cutoff_days: null,
            }
          : null
      p.maybeSingle = () => Promise.resolve({ data, error: null })
      p.single = () => Promise.resolve({ data, error: null })
      p.then = (res: any, rej: any) => Promise.resolve({ data, error: null }).then(res, rej)
      return p
    }) as any
    mockedAdmin.mockReturnValue(db)

    await processPayPalRefund('table_booking', 'tb-1', 50, 'Guest cancelled')

    expect(mockedNotification).toHaveBeenCalledTimes(1)
  })
})
