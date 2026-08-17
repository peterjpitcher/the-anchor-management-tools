import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Refunds move real money out of the business, and until now none of this file was
 * covered. These tests pin the invariants where a regression costs cash rather than
 * merely looking wrong:
 *
 *  - nothing reaches PayPal without auth and the refund permission
 *  - the seasonal refund promise is enforced, and fails CLOSED when unreadable
 *  - a retry reuses the existing PayPal-Request-Id instead of minting a new one,
 *    which is the only thing stopping a double refund
 *  - a refund that succeeded at PayPal is never recorded as failed just because
 *    local bookkeeping afterwards blew up
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
  sendDepositRefundWithDeductionsEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/table-bookings/deposit-refund', () => ({ resolveSeasonalDepositRefund: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { processPayPalRefund, processManualRefund } from '@/app/actions/refundActions'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { refundPayPalPayment } from '@/lib/paypal'
import { checkUserPermission } from '@/app/actions/rbac'
import { resolveSeasonalDepositRefund } from '@/lib/table-bookings/deposit-refund'

const mockedCreateClient = createClient as unknown as Mock
const mockedAdmin = createAdminClient as unknown as Mock
const mockedRefund = refundPayPalPayment as unknown as Mock
const mockedPermission = checkUserPermission as unknown as Mock
const mockedSeasonal = resolveSeasonalDepositRefund as unknown as Mock

/** A Supabase query chain that is awaitable at any depth and resolves to `result`. */
function chain(result: any) {
  const p: any = {}
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'update', 'insert', 'delete', 'contains']) {
    p[m] = vi.fn(() => p)
  }
  p.maybeSingle = vi.fn(() => Promise.resolve(result))
  p.single = vi.fn(() => Promise.resolve(result))
  p.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej)
  return p
}

function setAuth(userId: string | null) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }) },
  })
}

const PRIVATE_BOOKING_ROW = {
  id: 'pb-1',
  paypal_deposit_capture_id: 'CAPTURE-1',
  deposit_paid_date: new Date().toISOString(),
  deposit_amount: 250,
  customer_id: 'cust-1',
  customer_name: 'Alex Doe',
  contact_email: 'alex@example.com',
  contact_phone: '+447700900000',
  status: 'confirmed',
}

function makeDb(overrides: {
  pendingRefund?: any
  updates?: any[]
  rpcResult?: { data?: any; error?: any }
  tableBookingTerms?: any
  tableBookingTermsError?: any
} = {}) {
  const updates = overrides.updates ?? []
  let tableBookingCall = 0

  const rpc = vi.fn().mockResolvedValue(
    overrides.rpcResult ?? { data: [{ refund_id: 'refund-1' }], error: null }
  )

  const from = vi.fn((table: string) => {
    if (table === 'private_bookings') return chain({ data: PRIVATE_BOOKING_ROW, error: null })

    if (table === 'table_bookings') {
      tableBookingCall += 1
      // First read loads the booking, second reads the seasonal terms snapshot.
      if (tableBookingCall === 1) {
        return chain({
          data: {
            id: 'tb-1',
            paypal_deposit_capture_id: 'CAPTURE-1',
            card_capture_completed_at: new Date().toISOString(),
            deposit_amount: 50,
            deposit_amount_locked: null,
            customer_id: 'cust-1',
            customers: { first_name: 'Alex', last_name: 'Doe', email: 'a@e.com', mobile_e164: '+447700900000' },
          },
          error: null,
        })
      }
      return chain({
        data: overrides.tableBookingTerms ?? null,
        error: overrides.tableBookingTermsError ?? null,
      })
    }

    if (table === 'payment_refunds') {
      const c = chain({ data: overrides.pendingRefund ?? null, error: null })
      const originalUpdate = c.update
      c.update = vi.fn((payload: any) => {
        updates.push(payload)
        return originalUpdate(payload)
      })
      return c
    }

    return chain({ data: null, error: null })
  })

  return { from, rpc, updates }
}

beforeEach(() => {
  vi.clearAllMocks()
  setAuth('user-1')
  mockedPermission.mockResolvedValue(true)
  mockedSeasonal.mockReturnValue({ entitled: true, reason: '', cutoffDays: 14, daysBefore: 30 })
})

describe('processPayPalRefund: gates before any money moves', () => {
  it('refuses an unauthenticated caller and never contacts PayPal', async () => {
    setAuth(null)
    mockedAdmin.mockReturnValue(makeDb())

    const result = await processPayPalRefund('private_booking', 'pb-1', 50, 'Cancelled')

    expect(result).toEqual({ error: 'Not authenticated' })
    expect(mockedRefund).not.toHaveBeenCalled()
  })

  it('refuses a user without refund permission and never contacts PayPal', async () => {
    mockedPermission.mockResolvedValue(false)
    mockedAdmin.mockReturnValue(makeDb())

    const result = await processPayPalRefund('private_booking', 'pb-1', 50, 'Cancelled')

    expect(result.error).toMatch(/Insufficient permission/i)
    expect(mockedRefund).not.toHaveBeenCalled()
  })

  it('refuses once the 180 day PayPal window has passed', async () => {
    const db = makeDb()
    db.from = vi.fn(() =>
      chain({
        data: { ...PRIVATE_BOOKING_ROW, deposit_paid_date: '2020-01-01T00:00:00.000Z' },
        error: null,
      })
    ) as any
    mockedAdmin.mockReturnValue(db)

    const result = await processPayPalRefund('private_booking', 'pb-1', 50, 'Cancelled')

    expect(result.error).toMatch(/window expired/i)
    expect(mockedRefund).not.toHaveBeenCalled()
  })

  it('refuses when the amount exceeds the refundable balance', async () => {
    mockedAdmin.mockReturnValue(
      makeDb({ rpcResult: { data: null, error: { message: 'amount exceeds refundable balance' } } })
    )

    const result = await processPayPalRefund('private_booking', 'pb-1', 5000, 'Cancelled')

    expect(result).toEqual({ error: 'Amount exceeds refundable balance' })
    expect(mockedRefund).not.toHaveBeenCalled()
  })
})

describe('processPayPalRefund: the seasonal refund promise', () => {
  const TERMS = {
    booking_date: '2026-12-24',
    deposit_refund_cutoff_days: 14,
    deposit_refund_policy: 'Refundable up to 14 days before',
    booking_period_code: 'XMAS',
    booking_period_name: 'Christmas',
  }

  it('refuses a refund inside the cutoff the guest was shown', async () => {
    mockedSeasonal.mockReturnValue({
      entitled: false, reason: 'This booking is inside its 14 day refund cutoff.', cutoffDays: 14, daysBefore: 3,
    })
    mockedAdmin.mockReturnValue(makeDb({ tableBookingTerms: TERMS }))

    const result = await processPayPalRefund('table_booking', 'tb-1', 50, 'Guest cancelled')

    expect(result.error).toMatch(/inside its 14 day refund cutoff/i)
    expect(result.error).toMatch(/manager override/i)
    expect(mockedRefund).not.toHaveBeenCalled()
  })

  it('fails closed when the refund terms cannot be read', async () => {
    mockedAdmin.mockReturnValue(
      makeDb({ tableBookingTermsError: { message: 'schema cache stale' } })
    )

    const result = await processPayPalRefund('table_booking', 'tb-1', 50, 'Guest cancelled')

    expect(result.error).toMatch(/could not be read/i)
    expect(mockedRefund).not.toHaveBeenCalled()
  })

  it('still refuses a manager override that carries no reason', async () => {
    mockedSeasonal.mockReturnValue({ entitled: false, reason: 'Inside cutoff.', cutoffDays: 14, daysBefore: 3 })
    mockedAdmin.mockReturnValue(makeDb({ tableBookingTerms: TERMS }))

    const result = await processPayPalRefund('table_booking', 'tb-1', 50, 'Guest cancelled', {
      overrideRefundPolicy: true,
      overrideReason: '   ',
    })

    expect(result.error).toMatch(/needs a reason/i)
    expect(mockedRefund).not.toHaveBeenCalled()
  })

  it('allows the refund when a manager overrides with a reason', async () => {
    mockedSeasonal.mockReturnValue({ entitled: false, reason: 'Inside cutoff.', cutoffDays: 14, daysBefore: 3 })
    mockedAdmin.mockReturnValue(makeDb({ tableBookingTerms: TERMS }))
    mockedRefund.mockResolvedValue({ status: 'COMPLETED', refundId: 'pp-refund-1', currency: 'GBP' })

    const result = await processPayPalRefund('table_booking', 'tb-1', 50, 'Guest cancelled', {
      overrideRefundPolicy: true,
      overrideReason: 'Kitchen closed, our fault',
    })

    expect(result.success).toBe(true)
    expect(mockedRefund).toHaveBeenCalledTimes(1)
  })

  it('leaves non-seasonal bookings alone when there is no cutoff on the booking', async () => {
    mockedAdmin.mockReturnValue(makeDb({ tableBookingTerms: { booking_date: '2026-12-24', deposit_refund_cutoff_days: null } }))
    mockedRefund.mockResolvedValue({ status: 'COMPLETED', refundId: 'pp-refund-1', currency: 'GBP' })

    const result = await processPayPalRefund('table_booking', 'tb-1', 50, 'Guest cancelled')

    expect(result.success).toBe(true)
    expect(mockedSeasonal).not.toHaveBeenCalled()
  })
})

describe('processPayPalRefund: not refunding twice', () => {
  it('reuses the pending row and its request id rather than reserving a second refund', async () => {
    const db = makeDb({ pendingRefund: { id: 'refund-existing', paypal_request_id: 'REQ-EXISTING' } })
    mockedAdmin.mockReturnValue(db)
    mockedRefund.mockResolvedValue({ status: 'COMPLETED', refundId: 'pp-refund-1', currency: 'GBP' })

    const result = await processPayPalRefund('private_booking', 'pb-1', 50, 'Cancelled')

    expect(result.success).toBe(true)
    expect(result.refundId).toBe('refund-existing')
    // A second reservation would take a second amount off the refundable balance.
    expect(db.rpc).not.toHaveBeenCalled()
    // The same idempotency key must reach PayPal, or PayPal treats it as a new refund.
    expect(mockedRefund).toHaveBeenCalledWith('CAPTURE-1', 50, 'REQ-EXISTING', 'GBP')
  })

  it('reserves a fresh balance row when nothing is pending', async () => {
    const db = makeDb()
    mockedAdmin.mockReturnValue(db)
    mockedRefund.mockResolvedValue({ status: 'COMPLETED', refundId: 'pp-refund-1', currency: 'GBP' })

    await processPayPalRefund('private_booking', 'pb-1', 50, 'Cancelled')

    expect(db.rpc).toHaveBeenCalledWith('reserve_refund_balance', expect.objectContaining({
      p_source_type: 'private_booking',
      p_amount: 50,
      p_refund_method: 'paypal',
      p_initiated_by: 'user-1',
    }))
  })
})

describe('processPayPalRefund: money left the account', () => {
  it('marks the refund failed only when PayPal itself rejected it', async () => {
    const updates: any[] = []
    mockedAdmin.mockReturnValue(makeDb({ updates }))
    mockedRefund.mockRejectedValue(new Error('CAPTURE_NOT_REFUNDABLE'))

    const result = await processPayPalRefund('private_booking', 'pb-1', 50, 'Cancelled')

    expect(result.error).toMatch(/PayPal refund failed/i)
    expect(updates.some((u) => u.status === 'failed')).toBe(true)
  })

  it('does NOT mark a completed refund as failed when post-processing throws', async () => {
    const updates: any[] = []
    mockedAdmin.mockReturnValue(makeDb({ updates }))
    // A currency mismatch throws after PayPal has already returned COMPLETED.
    mockedRefund.mockResolvedValue({ status: 'COMPLETED', refundId: 'pp-refund-1', currency: 'USD' })

    const result = await processPayPalRefund('private_booking', 'pb-1', 50, 'Cancelled')

    // The money has moved. Recording it as failed would invite someone to refund again.
    expect(updates.some((u) => u.status === 'failed')).toBe(false)
    expect(updates.some((u) => u.status === 'completed')).toBe(true)
    expect(result.success).toBe(true)
    expect(result.warning).toMatch(/local updates may have failed/i)
  })

  it('keeps a pending PayPal refund pending when post-processing throws', async () => {
    const updates: any[] = []
    mockedAdmin.mockReturnValue(makeDb({ updates }))
    mockedRefund.mockResolvedValue({ status: 'PENDING', refundId: 'pp-refund-1', currency: 'USD' })

    const result = await processPayPalRefund('private_booking', 'pb-1', 50, 'Cancelled')

    expect(updates.some((u) => u.status === 'failed')).toBe(false)
    expect(result.pending).toBe(true)
  })
})

describe('processManualRefund', () => {
  it('refuses to be used as a back door for PayPal refunds', async () => {
    mockedAdmin.mockReturnValue(makeDb())

    const result = await processManualRefund('private_booking', 'pb-1', 50, 'Cancelled', 'paypal' as any)

    expect(result).toEqual({ error: 'Use PayPal refund for PayPal payments' })
  })

  it('refuses an unauthenticated caller', async () => {
    setAuth(null)
    mockedAdmin.mockReturnValue(makeDb())

    const result = await processManualRefund('private_booking', 'pb-1', 50, 'Cancelled', 'cash')

    expect(result).toEqual({ error: 'Not authenticated' })
  })

  it('applies the same seasonal cutoff to cash handed across the bar', async () => {
    mockedSeasonal.mockReturnValue({ entitled: false, reason: 'Inside cutoff.', cutoffDays: 14, daysBefore: 3 })
    const db = makeDb({ tableBookingTerms: { booking_date: '2026-12-24', deposit_refund_cutoff_days: 14 } })
    mockedAdmin.mockReturnValue(db)

    const result = await processManualRefund('table_booking', 'tb-1', 50, 'Guest cancelled', 'cash')

    expect(result.error).toMatch(/manager override/i)
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('records a completed refund when everything passes', async () => {
    const updates: any[] = []
    mockedAdmin.mockReturnValue(makeDb({ updates }))

    const result = await processManualRefund('private_booking', 'pb-1', 50, 'Cancelled', 'cash')

    expect(result.success).toBe(true)
    expect(result.refundId).toBe('refund-1')
    expect(updates.some((u) => u.status === 'completed')).toBe(true)
  })

  it('refuses when the amount exceeds the refundable balance', async () => {
    mockedAdmin.mockReturnValue(
      makeDb({ rpcResult: { data: null, error: { message: 'amount exceeds refundable balance' } } })
    )

    const result = await processManualRefund('private_booking', 'pb-1', 9999, 'Cancelled', 'cash')

    expect(result).toEqual({ error: 'Amount exceeds refundable balance' })
  })
})
