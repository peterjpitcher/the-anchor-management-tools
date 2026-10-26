import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

/**
 * BK-059: when a guest books online with food choices and the choices fail to save, the booking
 * still goes through, the response says `saved: false` with a reason the website can act on, and
 * the pub is told (an audit row and a manager email, through reportPreorderSaveFailure). Before
 * this the failure was a logger.warn, which is silent in production.
 *
 * Harness copied from tableBookingStructuredPersistence.test.ts, with the pre-order library mocked
 * so the save can be made to fail.
 */

const {
  saveSundayPreorderByBookingId,
  ensureCustomerForPhone,
  logAuditEvent,
  warn,
  error,
  createTablePaymentToken,
  sendTableBookingCreatedSmsIfAllowed,
  alignTablePaymentHoldToScheduledSend,
  mapTableBookingBlockedReason,
  recordAnalyticsEvent,
  verifyTurnstileToken,
  recordOneCourseInsideCutoff,
  savePreorderCover,
  syncPreorderCovers,
  reportPreorderSaveFailure,
} = vi.hoisted(() => ({
  saveSundayPreorderByBookingId: vi.fn().mockResolvedValue({ state: 'saved', item_count: 2, booking_id: 'bk1' }),
  ensureCustomerForPhone: vi.fn(),
  logAuditEvent: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  createTablePaymentToken: vi.fn().mockResolvedValue({ url: 'https://example.com/pay' }),
  sendTableBookingCreatedSmsIfAllowed: vi.fn().mockResolvedValue({ sms: null }),
  alignTablePaymentHoldToScheduledSend: vi.fn(async () => undefined),
  mapTableBookingBlockedReason: vi.fn((reason?: string) => (reason as any) ?? null),
  recordAnalyticsEvent: vi.fn(),
  verifyTurnstileToken: vi.fn().mockResolvedValue({ success: true }),
  recordOneCourseInsideCutoff: vi.fn().mockResolvedValue('not_needed'),
  savePreorderCover: vi.fn(),
  syncPreorderCovers: vi.fn().mockResolvedValue({ partySize: 2, coverCount: 2, added: 2, removed: [] }),
  reportPreorderSaveFailure: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/table-bookings/preorder', () => ({ savePreorderCover, syncPreorderCovers }))
vi.mock('@/lib/table-bookings/preorder-alerts', () => ({ reportPreorderSaveFailure }))

vi.mock('@/lib/table-bookings/christmas-one-course', () => ({
  recordOneCourseInsideCutoff,
  oneCourseForEveryone: (partySize: number) => Array.from({ length: partySize }, () => 1),
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
const PERIOD_ID = '22222222-2222-4222-8222-222222222222'
const DISH_ID = '33333333-3333-4333-8333-333333333333'

function buildSupabase() {
  const rpc = vi.fn(async () => ({
    data: {
      state: 'pending_payment',
      table_booking_id: BOOKING_ID,
      booking_reference: 'TB-FIXTURE',
      hold_expires_at: new Date(Date.now() + 60_000).toISOString(),
      deposit_amount: 20,
      table_name: 'T1',
    },
    error: null,
  }))
  const coverQuery = {
    select: () => coverQuery,
    eq: () => coverQuery,
    order: async () => ({
      data: [
        { id: 'cover-1', ordinal: 1 },
        { id: 'cover-2', ordinal: 2 },
      ],
      error: null,
    }),
  }
  return {
    from: vi.fn((table: string) => {
      if (table === 'table_bookings') return { update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) }
      if (table === 'booking_preorder_covers') return coverQuery
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc,
  }
}

function bookWithChoices() {
  return POST(
    new Request('http://localhost/api/table-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-key', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({
        phone: '+447000000000',
        first_name: 'Fixture',
        date: '2026-12-05',
        time: '18:00',
        party_size: 2,
        purpose: 'food',
        booking_period_id: PERIOD_ID,
        booking_period_answer: true,
        preorder: [{ main_menu_item_id: DISH_ID }, { main_menu_item_id: DISH_ID }],
      }),
    }) as Parameters<typeof POST>[0],
  )
}

describe('POST /api/table-bookings: food choices that fail to save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureCustomerForPhone.mockResolvedValue({ customerId: '44444444-4444-4444-8444-444444444444' })
    vi.mocked(createAdminClient).mockReturnValue(buildSupabase() as unknown as ReturnType<typeof createAdminClient>)
  })

  it('confirms the table, says the choices did not save, and tells the pub', async () => {
    savePreorderCover.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('connection reset'))

    const response = await bookWithChoices()

    expect(response.status).toBeLessThan(400)
    const body = await response.json()
    expect(body.data.state).toBe('pending_payment')
    expect(body.data.preorder).toEqual({
      requested_covers: 2,
      saved_covers: 1,
      saved: false,
      error: 'connection reset',
      reason: 'save_failed',
    })
    // Visible in production: an error, not a warning.
    expect(error).toHaveBeenCalledWith('Failed to persist pre-order on public table booking', expect.anything())
    expect(reportPreorderSaveFailure).toHaveBeenCalledWith({
      tableBookingId: BOOKING_ID,
      bookingReference: 'TB-FIXTURE',
      bookingDate: '2026-12-05',
      requestedCovers: 2,
      savedCovers: 1,
      error: 'connection reset',
    })
  })

  it('says nothing to the pub when every choice saved', async () => {
    savePreorderCover.mockResolvedValue({})

    const response = await bookWithChoices()

    const body = await response.json()
    expect(body.data.preorder).toMatchObject({ saved: true, saved_covers: 2, reason: 'saved' })
    expect(reportPreorderSaveFailure).not.toHaveBeenCalled()
  })

  it('does not treat a late Christmas booking on 1 course as a failure', async () => {
    recordOneCourseInsideCutoff.mockResolvedValueOnce('recorded')

    const response = await bookWithChoices()

    const body = await response.json()
    expect(body.data.preorder).toMatchObject({ saved: false, reason: 'late_one_course' })
    expect(reportPreorderSaveFailure).not.toHaveBeenCalled()
  })
})
