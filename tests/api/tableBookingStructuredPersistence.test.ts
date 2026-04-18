import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A2 regression test — the public POST /api/table-bookings endpoint must
 * persist dietary/allergy arrays onto the booking row and hand structured
 * Sunday lunch pre-order items to saveSundayPreorderByBookingId, rather than
 * losing them into a free-text notes blob.
 */

const {
  saveSundayPreorderByBookingId,
  ensureCustomerForPhone,
  logAuditEvent,
  warn,
  error,
  createTablePaymentToken,
  sendTableBookingCreatedSmsIfAllowed,
  sendManagerTableBookingCreatedEmailIfAllowed,
  alignTablePaymentHoldToScheduledSend,
  mapTableBookingBlockedReason,
  recordAnalyticsEvent,
  verifyTurnstileToken,
} = vi.hoisted(() => ({
  saveSundayPreorderByBookingId: vi.fn().mockResolvedValue({ state: 'saved', item_count: 2, booking_id: 'bk1' }),
  ensureCustomerForPhone: vi.fn(),
  logAuditEvent: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  createTablePaymentToken: vi.fn().mockResolvedValue({ url: 'https://example.com/pay' }),
  sendTableBookingCreatedSmsIfAllowed: vi.fn().mockResolvedValue({ sms: null }),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn().mockResolvedValue({ sent: true }),
  alignTablePaymentHoldToScheduledSend: vi.fn(async () => undefined),
  mapTableBookingBlockedReason: vi.fn((reason?: string) => (reason as any) ?? null),
  recordAnalyticsEvent: vi.fn(),
  verifyTurnstileToken: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: vi.fn(() => vi.fn().mockResolvedValue(null)),
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request),
  ),
  createApiResponse: (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  createErrorResponse: (message: string, _code: string, status: number) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  computeIdempotencyRequestHash: vi.fn(() => 'hash'),
  getIdempotencyKey: vi.fn(() => 'idem-1'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone,
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
}))

vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken,
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent,
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent,
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTablePaymentHoldToScheduledSend,
  createTablePaymentToken,
  mapTableBookingBlockedReason,
  sendManagerTableBookingCreatedEmailIfAllowed,
  sendTableBookingCreatedSmsIfAllowed,
}))

vi.mock('@/lib/table-bookings/sunday-preorder', () => ({
  saveSundayPreorderByBookingId,
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn, error, info: vi.fn() },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { POST } from '@/app/api/table-bookings/route'

const BOOKING_ID = '11111111-1111-4111-8111-111111111111'
const DISH_ID = '22222222-2222-4222-8222-222222222222'
const DISH_ID_2 = '33333333-3333-4333-8333-333333333333'

function buildSupabase() {
  const tableBookingsUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const tableBookingsUpdate = vi.fn(() => ({ eq: tableBookingsUpdateEq }))

  const rpc = vi.fn(async () => ({
    data: {
      state: 'pending_payment',
      table_booking_id: BOOKING_ID,
      booking_reference: 'TB-TEST',
      hold_expires_at: new Date(Date.now() + 60_000).toISOString(),
      deposit_amount: 20,
      table_name: 'T1',
    },
    error: null,
  }))

  return {
    from: vi.fn((table: string) => {
      if (table === 'table_bookings') {
        return { update: tableBookingsUpdate }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc,
    _tableBookingsUpdate: tableBookingsUpdate,
    _tableBookingsUpdateEq: tableBookingsUpdateEq,
  }
}

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/table-bookings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'test-key',
      'idempotency-key': 'idem-1',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/table-bookings — structured persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureCustomerForPhone.mockResolvedValue({ customerId: 'cust-1' })
    saveSundayPreorderByBookingId.mockResolvedValue({ state: 'saved', item_count: 2, booking_id: BOOKING_ID })
  })

  it('persists dietary_requirements and allergies arrays on the booking row', async () => {
    const supabase = buildSupabase()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const body = {
      phone: '+447000000000',
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice@example.com',
      date: '2026-04-26',
      time: '12:00',
      party_size: 2,
      purpose: 'food',
      sunday_lunch: true,
      dietary_requirements: ['vegetarian'],
      allergies: ['nuts', 'shellfish'],
    }

    const response = await POST(buildRequest(body) as any)
    expect(response.status).toBeLessThan(500)

    expect(supabase._tableBookingsUpdate).toHaveBeenCalledWith({
      dietary_requirements: ['vegetarian'],
      allergies: ['nuts', 'shellfish'],
    })
    expect(supabase._tableBookingsUpdateEq).toHaveBeenCalledWith('id', BOOKING_ID)
  })

  it('saves structured Sunday lunch pre-order items via saveSundayPreorderByBookingId', async () => {
    const supabase = buildSupabase()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const body = {
      phone: '+447000000000',
      date: '2026-04-26',
      time: '12:00',
      party_size: 2,
      purpose: 'food',
      sunday_lunch: true,
      sunday_preorder_items: [
        { menu_dish_id: DISH_ID, quantity: 1 },
        { menu_dish_id: DISH_ID_2, quantity: 1 },
      ],
    }

    await POST(buildRequest(body) as any)

    expect(saveSundayPreorderByBookingId).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        bookingId: BOOKING_ID,
        items: [
          { menu_dish_id: DISH_ID, quantity: 1 },
          { menu_dish_id: DISH_ID_2, quantity: 1 },
        ],
        staffOverride: true,
      }),
    )
  })

  it('does not call saveSundayPreorderByBookingId when booking is not sunday_lunch', async () => {
    const supabase = buildSupabase()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const body = {
      phone: '+447000000000',
      date: '2026-04-24',
      time: '19:00',
      party_size: 2,
      purpose: 'food',
      sunday_lunch: false,
      sunday_preorder_items: [{ menu_dish_id: DISH_ID, quantity: 1 }],
    }

    await POST(buildRequest(body) as any)

    expect(saveSundayPreorderByBookingId).not.toHaveBeenCalled()
  })

  it('logs a warning but does not fail the booking if pre-order persistence throws', async () => {
    const supabase = buildSupabase()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)
    saveSundayPreorderByBookingId.mockRejectedValueOnce(new Error('menu lookup failed'))

    const body = {
      phone: '+447000000000',
      date: '2026-04-26',
      time: '12:00',
      party_size: 2,
      purpose: 'food',
      sunday_lunch: true,
      sunday_preorder_items: [{ menu_dish_id: DISH_ID, quantity: 1 }],
    }

    const response = await POST(buildRequest(body) as any)

    expect(response.status).toBeLessThan(500)
    expect(warn).toHaveBeenCalledWith(
      'Failed to persist Sunday preorder items for website booking',
      expect.objectContaining({
        metadata: expect.objectContaining({ tableBookingId: BOOKING_ID, itemCount: 1 }),
      }),
    )
  })

  it('rejects a payload with sunday_preorder_items containing non-UUID menu_dish_id', async () => {
    const supabase = buildSupabase()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const body = {
      phone: '+447000000000',
      date: '2026-04-26',
      time: '12:00',
      party_size: 2,
      purpose: 'food',
      sunday_lunch: true,
      sunday_preorder_items: [{ menu_dish_id: 'not-a-uuid', quantity: 1 }],
    }

    const response = await POST(buildRequest(body) as any)

    expect(response.status).toBe(400)
    expect(saveSundayPreorderByBookingId).not.toHaveBeenCalled()
  })
})
