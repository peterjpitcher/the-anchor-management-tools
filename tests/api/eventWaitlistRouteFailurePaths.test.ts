import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

/**
 * Failure branches of the public event waitlist route (BK-128, BK-039 and BK-108, customer bookings
 * review of 24 October 2026): what the website reads, what happens to the idempotency claim, and
 * that the failure is logged as an error.
 */

vi.mock('@/lib/phone/uk-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/phone/uk-mobile')>()),
  isUkMobile: () => true,
}))

const limitBookingAttempt = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/booking-rate-limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/booking-rate-limits')>()),
  limitBookingAttempt,
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request)
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json(data, { status })),
  createErrorResponse: vi.fn((message: string, code: string, status = 400) =>
    Response.json({ success: false, error: { code, message } }, { status })
  ),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn().mockReturnValue('request-hash'),
  getIdempotencyKey: vi.fn().mockReturnValue('idem-1'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/utils', () => ({ formatPhoneForStorage: vi.fn((value: string) => value) }))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true, sid: 'SM1' }) }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: vi.fn((value: string) => value) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/services/consent', () => ({ ConsentService: { applyBookingContactConsent: vi.fn() } }))
vi.mock('@/lib/money-alerts', () => ({ alertMoneyNeedsAPerson: vi.fn().mockResolvedValue({ sent: true, duplicate: false }) }))

const { warn, error, info } = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn, error, info } }))

import { createAdminClient } from '@/lib/supabase/admin'
import { claimIdempotencyKey, persistIdempotencyResponse, releaseIdempotencyClaim } from '@/lib/api/idempotency'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { ConsentService } from '@/services/consent'
import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { POST } from '@/app/api/event-waitlist/route'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'

function mockAdminClient(rpcResult: { data: unknown; error: unknown }) {
  const customerMaybeSingle = vi.fn().mockResolvedValue({
    data: { id: CUSTOMER_ID, first_name: 'Pat', mobile_number: '+447700900123', sms_status: 'active' },
    error: null,
  })
  ;(createAdminClient as unknown as Mock).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle }) }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn(async () => rpcResult),
  })
}

function request() {
  return new Request('http://localhost/api/event-waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
    body: JSON.stringify({ event_id: EVENT_ID, phone: '+447700900123', first_name: 'Pat', requested_seats: 2 }),
  })
}

describe('POST /api/event-waitlist failure paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    limitBookingAttempt.mockResolvedValue(null)
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' })
    vi.mocked(ensureCustomerForPhone).mockResolvedValue({ customerId: CUSTOMER_ID } as Awaited<ReturnType<typeof ensureCustomerForPhone>>)
  })

  it('answers 500 DATABASE_ERROR, releases the claim and logs an error when the waitlist function fails', async () => {
    mockAdminClient({ data: null, error: { message: 'deadlock detected' } })

    const response = await POST(request() as never)

    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe('DATABASE_ERROR')
    expect(releaseIdempotencyClaim).toHaveBeenCalledOnce()
    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('create_event_waitlist_entry_v05 RPC failed', expect.anything())
  })

  it('answers 500 CUSTOMER_RESOLUTION_FAILED and logs an error when the customer cannot be made', async () => {
    mockAdminClient({ data: null, error: null })
    vi.mocked(ensureCustomerForPhone).mockResolvedValue({ customerId: null } as unknown as Awaited<ReturnType<typeof ensureCustomerForPhone>>)

    const response = await POST(request() as never)

    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe('CUSTOMER_RESOLUTION_FAILED')
    expect(releaseIdempotencyClaim).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith('Event waitlist could not find or create the customer', expect.anything())
  })

  it('still joins the guest to the waitlist and tells the manager when the consent write throws', async () => {
    mockAdminClient({ data: { state: 'queued', waitlist_entry_id: 'waitlist-1', seats_remaining: 0 }, error: null })
    vi.mocked(ConsentService.applyBookingContactConsent).mockRejectedValue(new Error('consent insert failed'))

    const response = await POST(request() as never)

    expect(response.status).toBe(201)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('Booking saved but the guest contact choices did not record', expect.anything())
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bookingId: 'waitlist-1', kind: 'consent_not_recorded',
    }))
  })

  it('refuses with 429 before any work when the guest is over the hourly limit (BK-108)', async () => {
    mockAdminClient({ data: null, error: null })
    limitBookingAttempt.mockResolvedValue(
      Response.json({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many' } }, { status: 429 })
    )

    const response = await POST(request() as never)

    expect(response.status).toBe(429)
    expect(limitBookingAttempt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prefix: 'event-waitlist-guest', subject: '+447700900123', max: 20,
    }))
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
  })
})
