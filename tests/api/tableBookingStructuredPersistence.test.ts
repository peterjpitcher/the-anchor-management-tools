import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A2 regression test — the public POST /api/table-bookings endpoint must
 * persist dietary/allergy arrays onto the booking row while ignoring retired
 * Sunday lunch pre-order payload fields.
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
  // The table-bookings route now checks whether the API key actually validates
  // before skipping the bot check, so the mock has to provide it.
  isApiKeyAuthenticated: vi.fn().mockResolvedValue(true),
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
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
  lookupIdempotencyKey: vi.fn(),
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
  // The route quotes the deposit the RPC actually charged rather than recomputing it from party
  // size, so this mirrors the real helper: prefer the RPC's figure, fall back only when there is
  // none. Omitting it made the whole file fail to import.
  chargedDepositAmount: (
    bookingResult: { deposit_amount?: number | null },
    fallback: () => number,
  ) => {
    const charged = Number(bookingResult.deposit_amount)
    return Number((Number.isFinite(charged) && charged > 0 ? charged : fallback()).toFixed(2))
  },
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

  const rpc = vi.fn(async (): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> => ({
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

  it('routes explicit Christmas course choices through the atomic snapshot RPC', async () => {
    const supabase = buildSupabase()
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
    const response = await POST(buildRequest({
      phone: '+447000000000', first_name: 'Fixture', last_name: 'Guest', date: '2026-12-05', time: '18:00',
      party_size: 6, purpose: 'food', booking_period_id: DISH_ID, booking_period_answer: true,
      christmas_course_counts: [1, 1, 1, 1, 1, 1],
    }) as Parameters<typeof POST>[0])
    expect(response.status).toBeLessThan(400)
    expect(supabase.rpc).toHaveBeenCalledWith('create_table_booking_christmas_v01', expect.objectContaining({
      p_course_counts: [1, 1, 1, 1, 1, 1],
      p_request: expect.objectContaining({ customer_id: 'cust-1', party_size: 6 }),
    }))
  })

  it('fails visibly if the course RPC cannot run, without silently using the legacy create path', async () => {
    const supabase = buildSupabase()
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Course capability unavailable' } })
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
    const response = await POST(buildRequest({
      phone: '+447000000000', first_name: 'Fixture', date: '2026-12-05', time: '18:00',
      party_size: 6, purpose: 'food', booking_period_id: DISH_ID, booking_period_answer: true,
      christmas_course_counts: [1, 1, 1, 1, 1, 1],
    }) as Parameters<typeof POST>[0])
    expect(response.status).toBe(500)
    expect((await response.json()).error).toBeTruthy()
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
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

  it('accepts an empty last name and bypasses kitchen pacing for drinks', async () => {
    const supabase = buildSupabase()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await POST(buildRequest({
      phone: '+447000000000',
      first_name: 'Sam',
      last_name: '',
      date: '2026-04-24',
      time: '19:00',
      party_size: 4,
      purpose: 'drinks',
    }) as any)

    expect(response.status).toBeLessThan(500)

    // The public path can no longer ask to bypass anything. It used to send
    // p_bypass_pacing: true for drinks; a public entry point that accepts a bypass
    // flag is a bypass anyone can use, which is the security hole the public/staff
    // split closed. Drinks are limited by their own arrivals ceiling inside the
    // function instead, so the outcome is the same and the lever is gone.
    const [rpcName, rpcArgs] = (supabase.rpc as any).mock.calls.at(-1)
    expect(rpcName).toBe('create_table_booking_public_v06')
    expect(rpcArgs).not.toHaveProperty('p_bypass_pacing')
    expect(rpcArgs).not.toHaveProperty('p_bypass_cutoff')
    expect(rpcArgs).toMatchObject({ p_booking_purpose: 'drinks' })
  })

  // Sunday pre-order fields are now legacy input. The public POST path no
  // longer persists or validates those line items, regardless of flag value.
  it('does NOT call saveSundayPreorderByBookingId from the public POST path even with sunday_lunch=true', async () => {
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

    // Public path no longer persists pre-orders.
    expect(saveSundayPreorderByBookingId).not.toHaveBeenCalled()
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

  it('ignores a stale sunday_preorder_items payload with a non-UUID menu_dish_id', async () => {
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

    expect(response.status).toBeLessThan(500)
    expect(saveSundayPreorderByBookingId).not.toHaveBeenCalled()
  })
})


describe('fixture replay-only booking recovery', () => {
  const fixtureId = '10000000-0000-4000-8000-000000000001'
  async function recover(state: unknown, fields = {}, replayHeader = true) {
    const { lookupIdempotencyKey } = await import('@/lib/api/idempotency')
    vi.mocked(lookupIdempotencyKey).mockResolvedValue(state as Awaited<ReturnType<typeof lookupIdempotencyKey>>)
    const request = buildRequest({ replay_request: { phone: '+447000000000', date: '2026-11-07', time: '12:00', party_size: 2, purpose: 'food', fixture_id: fixtureId, notes: `Nations Championship: [${fixtureId}]\nNear the screen`, ...fields } })
    if (replayHeader) request.headers.set('X-Idempotency-Replay-Only', 'true')
    const supabase = buildSupabase()
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
    const response = await POST(request as Parameters<typeof POST>[0])
    const { claimIdempotencyKey } = await import('@/lib/api/idempotency')
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
    expect(ensureCustomerForPhone).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
    return response
  }
  beforeEach(() => { vi.clearAllMocks() })
  it('rejects the envelope as a normal creation request with zero writes', async () => {
    expect((await recover({ state: 'new' }, {}, false)).status).toBe(400)
  })
  it('returns NOT_FOUND with zero claims or booking writes', async () => {
    expect((await recover({ state: 'new' })).status).toBe(404)
  })
  it.each(['confirmed', 'pending_payment'])('returns stored %s response without creating', async state => {
    const response = await recover({ state: 'replay', response: { success: true, data: { state, booking_reference: 'ORIGINAL' }, meta: { status_code: 201 } } })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ data: { state, booking_reference: 'ORIGINAL' } })
  })
  it('does not reclaim a processing request', async () => {
    expect((await recover({ state: 'replay', response: { state: 'processing' } })).status).toBe(409)
  })
  it('does not disclose a different intent', async () => {
    expect((await recover({ state: 'conflict' })).status).toBe(409)
  })
  it('requires an authenticated API key before replay', async () => {
    const { getApiKeyAuthState } = await import('@/lib/api/auth')
    vi.mocked(getApiKeyAuthState).mockResolvedValueOnce('anonymous')
    expect((await recover({ state: 'replay', response: { data: { state: 'confirmed' } } })).status).toBe(401)
  })
  it('rejects notes belonging to another fixture', async () => {
    expect((await recover({ state: 'new' }, { notes: 'Nations Championship: [10000000-0000-4000-8000-000000000002]' })).status).toBe(400)
  })
})
