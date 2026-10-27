import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * BK-046 (customer bookings review, 24 October 2026; owner decision D7): every staff cancel used
 * to apply the guest's own refund terms, so when the pub had to cancel the guest got half or
 * nothing back and was told so. Staff now say who is cancelling; the pub's cancellation refunds in
 * full, a manager may choose the amount, and the choice is stored on the booking.
 */

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  getTableBookingForFoh: vi.fn(),
  refundTableBookingDeposit: vi.fn(),
  sendCancelled: vi.fn(),
  checkUserPermission: vi.fn(),
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: mocks.permission,
  requireBohTableBookingPermission: mocks.permission,
}))
vi.mock('@/lib/foh/bookings', () => ({
  getTableBookingForFoh: mocks.getTableBookingForFoh,
  hasUnpaidRequiredDeposit: vi.fn(() => false),
}))
vi.mock('@/lib/table-bookings/refunds', () => ({ refundTableBookingDeposit: mocks.refundTableBookingDeposit }))
vi.mock('@/lib/table-bookings/bookings', () => ({ sendTableBookingCancelledSmsIfAllowed: mocks.sendCancelled }))
vi.mock('@/lib/table-bookings/deposit-alerts', () => ({ alertTableDepositNeedsAPerson: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/payments/stripe', () => ({ expireStripeCheckoutSession: vi.fn(), isStripeConfigured: vi.fn(() => false) }))

import { POST as postFohCancel } from '@/app/api/foh/bookings/[id]/cancel/route'
import { POST as postBohStatus } from '@/app/api/boh/table-bookings/[id]/status/route'
import { createRecordingSupabase } from '../mocks/recordingSupabase'

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

const BOOKING = {
  id: BOOKING_ID,
  customer_id: 'customer-1',
  booking_reference: 'TB-1',
  status: 'confirmed',
  payment_status: 'completed',
  booking_date: '2026-12-12',
  booking_time: '19:00:00',
  start_datetime: '2026-12-12T19:00:00.000Z',
  party_size: 16,
}

function setUp() {
  const db = createRecordingSupabase({
    tables: {
      table_bookings: () => ({ data: { id: BOOKING_ID, status: 'cancelled' }, error: null }),
    },
  })
  mocks.permission.mockResolvedValue({ ok: true, userId: 'user-1', supabase: db.client })
  mocks.getTableBookingForFoh.mockResolvedValue(BOOKING)
  mocks.refundTableBookingDeposit.mockResolvedValue({ refunded: true, amountPence: 16000, refundId: 'R-1', tier: 'full', cancelledBy: 'venue' })
  mocks.sendCancelled.mockResolvedValue({ status: 'sent', channel: 'email', fallbackUsed: false, error: null })
  mocks.logAuditEvent.mockResolvedValue(undefined)
  return db
}

function updatesTo(db: ReturnType<typeof createRecordingSupabase>) {
  return db.queries
    .filter((query) => query.table === 'table_bookings')
    .flatMap((query) => query.calls.filter((call) => call.method === 'update').map((call) => call.args[0] as Record<string, unknown>))
}

function fohCancel(body?: Record<string, unknown>) {
  return postFohCancel(
    new NextRequest(`http://localhost/api/foh/bookings/${BOOKING_ID}/cancel`, {
      method: 'POST',
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
  )
}

function bohCancel(body: Record<string, unknown>) {
  return postBohStatus(
    new NextRequest(`http://localhost/api/boh/table-bookings/${BOOKING_ID}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancelled', ...body }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
  )
}

describe('who is cancelling, on the FOH cancel and the BOH status routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkUserPermission.mockResolvedValue(false)
  })

  it.each([
    ['FOH', fohCancel],
    ['BOH', bohCancel],
  ] as const)('%s: a pub cancellation refunds in full and is stored on the booking', async (_label, send) => {
    const db = setUp()

    const response = await send({ cancelled_by: 'venue' })

    expect(response.status).toBe(200)
    expect(mocks.refundTableBookingDeposit).toHaveBeenCalledWith(BOOKING_ID, expect.any(Date), {
      cancelledBy: 'venue',
      managerAmountGbp: null,
    })
    expect(updatesTo(db)).toEqual([expect.objectContaining({ status: 'cancelled', cancellation_reason: 'The pub cancelled' })])
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        additional_info: expect.objectContaining({ cancelled_by: 'venue', cancelled_by_given: true }),
      }),
    )
    // The guest is told it was the pub, through the refund result the notice is built from.
    expect(mocks.sendCancelled).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ refundResult: expect.objectContaining({ cancelledBy: 'venue' }) }),
    )
  })

  it.each([
    ['FOH', fohCancel],
    ['BOH', bohCancel],
  ] as const)('%s: a guest request keeps the guest terms', async (_label, send) => {
    const db = setUp()

    await send({ cancelled_by: 'guest' })

    expect(mocks.refundTableBookingDeposit).toHaveBeenCalledWith(BOOKING_ID, expect.any(Date), {
      cancelledBy: 'guest',
      managerAmountGbp: null,
    })
    expect(updatesTo(db)).toEqual([expect.objectContaining({ cancellation_reason: 'Guest asked staff to cancel' })])
  })

  it.each([
    ['FOH', fohCancel],
    ['BOH', bohCancel],
  ] as const)('%s: only table_bookings manage may choose the amount', async (_label, send) => {
    const db = setUp()

    const refused = await send({ cancelled_by: 'venue', refund_amount_gbp: 50 })
    expect(refused.status).toBe(403)
    expect(mocks.checkUserPermission).toHaveBeenCalledWith('table_bookings', 'manage', 'user-1')
    expect(updatesTo(db)).toEqual([])
    expect(mocks.refundTableBookingDeposit).not.toHaveBeenCalled()

    mocks.checkUserPermission.mockResolvedValue(true)
    const allowed = await send({ cancelled_by: 'venue', refund_amount_gbp: 50 })
    expect(allowed.status).toBe(200)
    expect(mocks.refundTableBookingDeposit).toHaveBeenCalledWith(BOOKING_ID, expect.any(Date), {
      cancelledBy: 'venue',
      managerAmountGbp: 50,
    })
  })

  it('FOH: a screen that sends nothing keeps the guest terms, as before', async () => {
    setUp()

    const response = await fohCancel()

    expect(response.status).toBe(200)
    expect(mocks.refundTableBookingDeposit).toHaveBeenCalledWith(BOOKING_ID, expect.any(Date), {
      cancelledBy: 'guest',
      managerAmountGbp: null,
    })
  })

  it('BOH: a status change that is not a cancel ignores the choice', async () => {
    setUp()

    const response = await postBohStatus(
      new NextRequest(`http://localhost/api/boh/table-bookings/${BOOKING_ID}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'completed', refund_amount_gbp: 50 }),
      }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.checkUserPermission).not.toHaveBeenCalled()
    expect(mocks.refundTableBookingDeposit).not.toHaveBeenCalled()
  })
})
