import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/paypal', () => ({
  verifyPayPalWebhook: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

// Idempotency mock — default to 'claimed' (first-time processing) so happy-path tests pass
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  computeIdempotencyRequestHash: vi.fn().mockReturnValue('test-hash'),
  persistIdempotencyResponse: vi.fn().mockResolvedValue(undefined),
  releaseIdempotencyClaim: vi.fn().mockResolvedValue(undefined),
}))

// ── Supabase mock helpers ─────────────────────────────────────────────────────

/**
 * Build a chainable Supabase mock per test.
 * Only needs to handle webhook_logs inserts and table_bookings select/update —
 * idempotency is now handled by the @/lib/api/idempotency module mock above.
 */
function createSupabaseMock({
  existingBooking = null,
  bookingUpdateError = null,
}: {
  existingBooking?: {
    id: string
    status: string
    payment_status: string
    paypal_deposit_order_id: string
    paypal_deposit_capture_id: string | null
  } | null
  bookingUpdateError?: { message: string } | null
} = {}) {
  // webhook_logs — insert always succeeds
  const wlInsert = vi.fn().mockResolvedValue({ error: null })

  // table_bookings — select chain for booking lookup
  const tbMaybeSingle = vi.fn().mockResolvedValue({ data: existingBooking, error: null })
  const tbSelectEq = vi.fn().mockReturnValue({ maybeSingle: tbMaybeSingle })
  const tbSelect = vi.fn().mockReturnValue({ eq: tbSelectEq })

  // table_bookings — update chain
  const tbUpdateIs = vi.fn().mockResolvedValue({ error: bookingUpdateError })
  const tbUpdateEq = vi.fn().mockReturnValue({ is: tbUpdateIs })
  const tbUpdate = vi.fn().mockReturnValue({ eq: tbUpdateEq })

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'webhook_logs') {
      return { insert: wlInsert }
    }
    if (table === 'table_bookings') {
      return { select: tbSelect, update: tbUpdate }
    }
    return {}
  })

  return {
    from,
    _tbUpdate: tbUpdate,
    _wlInsert: wlInsert,
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

// ── Test data helpers ─────────────────────────────────────────────────────────

const VALID_EVENT_ID = 'WH-PAYPAL-EVENT-001'
const VALID_ORDER_ID = 'PAYPAL-ORDER-ABC123'
const VALID_CAPTURE_ID = 'PAYPAL-CAPTURE-XYZ789'
const VALID_BOOKING_ID = 'booking-uuid-0001'

const VALID_WEBHOOK_HEADERS = {
  'content-type': 'application/json',
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT-123',
  'paypal-transmission-id': 'tx-id-123',
  'paypal-transmission-time': '2026-03-15T00:00:00Z',
  'paypal-transmission-sig': 'signature-value',
}

function makeCaptureCompletedBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: VALID_EVENT_ID,
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: VALID_CAPTURE_ID,
      supplementary_data: {
        related_ids: {
          order_id: VALID_ORDER_ID,
        },
      },
      amount: { value: '5.00', currency_code: 'GBP' },
    },
    ...overrides,
  })
}

function makeRequest(body: string, headers = VALID_WEBHOOK_HEADERS): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/paypal/table-bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/paypal/table-bookings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID = 'test-webhook-id'
  })

  it('returns 401 when PayPal signature verification fails', async () => {
    const { verifyPayPalWebhook } = await import('@/lib/paypal')
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { POST } = await import('../route')

    vi.mocked(verifyPayPalWebhook).mockResolvedValueOnce(false)
    const mockSupabase = createSupabaseMock()
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as any)

    const response = await POST(makeRequest(makeCaptureCompletedBody()))

    expect(response.status).toBe(401)
    const json = await response.json()
    expect(json.error).toBe('Invalid signature')
  })

  it('marks booking paid when PAYMENT.CAPTURE.COMPLETED is valid and booking not yet captured', async () => {
    const { verifyPayPalWebhook } = await import('@/lib/paypal')
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { claimIdempotencyKey, persistIdempotencyResponse } = await import('@/lib/api/idempotency')
    const { POST } = await import('../route')

    vi.mocked(verifyPayPalWebhook).mockResolvedValueOnce(true)
    vi.mocked(claimIdempotencyKey).mockResolvedValueOnce({ state: 'claimed' })
    vi.mocked(persistIdempotencyResponse).mockResolvedValueOnce(undefined)

    const mockSupabase = createSupabaseMock({
      existingBooking: {
        id: VALID_BOOKING_ID,
        status: 'pending',
        payment_status: 'pending',
        paypal_deposit_order_id: VALID_ORDER_ID,
        paypal_deposit_capture_id: null, // not yet captured
      },
    })
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as any)

    const response = await POST(makeRequest(makeCaptureCompletedBody()))

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.received).toBe(true)

    // Verify the booking update was called with correct fields
    expect(mockSupabase._tbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_status: 'completed',
        status: 'confirmed',
        payment_method: 'paypal',
        paypal_deposit_capture_id: VALID_CAPTURE_ID,
      }),
    )
  })

  it('returns 200 without reprocessing when idempotency claim returns replay', async () => {
    const { verifyPayPalWebhook } = await import('@/lib/paypal')
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { claimIdempotencyKey } = await import('@/lib/api/idempotency')
    const { POST } = await import('../route')

    vi.mocked(verifyPayPalWebhook).mockResolvedValueOnce(true)
    vi.mocked(claimIdempotencyKey).mockResolvedValueOnce({ state: 'replay' })

    const mockSupabase = createSupabaseMock()
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as any)

    const response = await POST(makeRequest(makeCaptureCompletedBody()))

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.duplicate).toBe(true)

    // table_bookings should not be touched
    expect(mockSupabase._tbUpdate).not.toHaveBeenCalled()
  })

  it('returns 200 without update when booking already has a capture ID', async () => {
    const { verifyPayPalWebhook } = await import('@/lib/paypal')
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { claimIdempotencyKey, persistIdempotencyResponse } = await import('@/lib/api/idempotency')
    const { POST } = await import('../route')

    vi.mocked(verifyPayPalWebhook).mockResolvedValueOnce(true)
    vi.mocked(claimIdempotencyKey).mockResolvedValueOnce({ state: 'claimed' })
    vi.mocked(persistIdempotencyResponse).mockResolvedValueOnce(undefined)

    const mockSupabase = createSupabaseMock({
      existingBooking: {
        id: VALID_BOOKING_ID,
        status: 'confirmed',
        payment_status: 'completed',
        paypal_deposit_order_id: VALID_ORDER_ID,
        paypal_deposit_capture_id: 'ALREADY-CAPTURED-ID', // already processed
      },
    })
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as any)

    const response = await POST(makeRequest(makeCaptureCompletedBody()))

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.received).toBe(true)

    // table_bookings update should NOT be called
    expect(mockSupabase._tbUpdate).not.toHaveBeenCalled()
  })

  it('returns 200 and ignores non-CAPTURE.COMPLETED event types', async () => {
    const { verifyPayPalWebhook } = await import('@/lib/paypal')
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { POST } = await import('../route')

    vi.mocked(verifyPayPalWebhook).mockResolvedValueOnce(true)
    const mockSupabase = createSupabaseMock()
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as any)

    const body = JSON.stringify({
      id: 'WH-OTHER-EVENT',
      event_type: 'PAYMENT.CAPTURE.DENIED',
      resource: {},
    })

    const response = await POST(makeRequest(body))

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ignored).toBe(true)
    expect(mockSupabase._tbUpdate).not.toHaveBeenCalled()
  })
})
