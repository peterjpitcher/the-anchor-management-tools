/**
 * Walk-in launch (spec §6, §7.3, §7.4, §8.3): canonical deposit precedence
 * for the PayPal create-order endpoint.
 *
 * Precedence (locked > stored > computed):
 *   1. If deposit_amount_locked is set, use it (authoritative).
 *   2. Else if deposit_amount is set on the row, use it (e.g. an unpaid
 *      pending booking holding a stored amount).
 *   3. Else compute the standard 10+ rule * £10 per person.
 *   4. Waivers always result in 0 (covered by getCanonicalDeposit).
 *
 * Critically, the create-order path must NEVER overwrite a locked amount —
 * once a booking has been paid (or the cash deposit confirmed), the
 * deposit_amount_locked column is sealed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    (handler: any, _permissions: string[], request: Request) =>
      handler(request, { id: 'k', name: 'k', permissions: ['read:events'], rate_limit: 100, is_active: true })
  ),
}))

const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockUpdate = vi.fn()
const mockUpdateEq = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate,
    })),
  })),
}))

const mockCreatePayPalOrder = vi.fn()
vi.mock('@/lib/paypal', () => ({
  createInlinePayPalOrder: mockCreatePayPalOrder,
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

function buildBookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-canonical',
    party_size: 12,
    status: 'pending_payment',
    payment_status: 'pending',
    paypal_deposit_order_id: null,
    deposit_amount: null,
    deposit_amount_locked: null,
    deposit_waived: false,
    booking_type: 'regular',
    ...overrides,
  }
}

function mockFetchAndUpdate(booking: ReturnType<typeof buildBookingRow>) {
  mockSingle.mockResolvedValueOnce({ data: booking, error: null })
  mockEq.mockReturnValue({ single: mockSingle })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockUpdateEq.mockResolvedValueOnce({ error: null })
  mockUpdate.mockReturnValue({ eq: mockUpdateEq })
}

async function callRoute(id: string) {
  const { POST } = await import('@/app/api/external/table-bookings/[id]/paypal/create-order/route')
  const req = new NextRequest(
    `http://localhost/api/external/table-bookings/${id}/paypal/create-order`,
    { method: 'POST' }
  )
  return POST(req, { params: Promise.resolve({ id }) })
}

describe('paypal create-order canonical deposit precedence (walk-in launch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('locked amount wins: uses deposit_amount_locked even when deposit_amount differs', async () => {
    // Edge case: an admin set deposit_amount=120 but the previous capture
    // locked £80. The next order recreate (e.g. customer reopens the link)
    // must not silently bump the charge to £120.
    mockFetchAndUpdate(
      buildBookingRow({
        party_size: 12,
        deposit_amount: 120,
        deposit_amount_locked: 80,
      })
    )
    mockCreatePayPalOrder.mockResolvedValueOnce({ orderId: 'ORDER-LOCKED' })

    const res = await callRoute('booking-canonical')
    expect(res.status).toBe(200)

    expect(mockCreatePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 80 })
    )
  })

  it('stored amount used when locked is null: deposit_amount=50 wins over the £10*party_size compute', async () => {
    mockFetchAndUpdate(
      buildBookingRow({
        party_size: 12,
        deposit_amount: 50,
        deposit_amount_locked: null,
      })
    )
    mockCreatePayPalOrder.mockResolvedValueOnce({ orderId: 'ORDER-STORED' })

    const res = await callRoute('booking-canonical')
    expect(res.status).toBe(200)

    expect(mockCreatePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50 })
    )
  })

  it('falls back to fresh compute when neither locked nor stored is set', async () => {
    // 12 guests * £10 = £120
    mockFetchAndUpdate(
      buildBookingRow({
        party_size: 12,
        deposit_amount: null,
        deposit_amount_locked: null,
      })
    )
    mockCreatePayPalOrder.mockResolvedValueOnce({ orderId: 'ORDER-FRESH' })

    const res = await callRoute('booking-canonical')
    expect(res.status).toBe(200)

    expect(mockCreatePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 120 })
    )
  })

  it('NEVER persists deposit_amount on the create-order path, even when canonical resolves from stored', async () => {
    mockFetchAndUpdate(
      buildBookingRow({
        party_size: 12,
        deposit_amount: 50,
        deposit_amount_locked: null,
      })
    )
    mockCreatePayPalOrder.mockResolvedValueOnce({ orderId: 'ORDER-NO-OVERWRITE' })

    await callRoute('booking-canonical')

    // Spec §7.3, §7.4: the create-order path may only persist
    // paypal_deposit_order_id. It must never write deposit_amount or
    // deposit_amount_locked — those are owned by the capture/confirm path.
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const updatePayload = mockUpdate.mock.calls[0]?.[0]
    expect(updatePayload).toEqual({ paypal_deposit_order_id: 'ORDER-NO-OVERWRITE' })
    expect(updatePayload).not.toHaveProperty('deposit_amount')
    expect(updatePayload).not.toHaveProperty('deposit_amount_locked')
  })

  it('rejects with 400 when canonical resolves to 0 (no deposit required)', async () => {
    // party_size=4 is below 10+ threshold; locked/stored both null;
    // canonical compute = 0 → no order should be created.
    mockFetchAndUpdate(
      buildBookingRow({
        party_size: 4,
        deposit_amount: null,
        deposit_amount_locked: null,
      })
    )

    const res = await callRoute('booking-canonical')
    expect(res.status).toBe(400)
    expect(mockCreatePayPalOrder).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
