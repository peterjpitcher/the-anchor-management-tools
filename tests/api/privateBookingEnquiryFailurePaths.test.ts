import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The private hire enquiry route when something fails after, or before, the enquiry is saved
 * (BK-039, BK-115 and BK-108, customer bookings review of 24 October 2026). A saved enquiry is never
 * reported to the guest as failed, the pub is still emailed, and a failure is logged as an error.
 */

const ADMIN_CLIENT = { __brand: 'admin-client' }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ADMIN_CLIENT,
}))

const createBooking = vi.fn()

vi.mock('@/services/private-bookings', () => ({
  PrivateBookingService: {
    createBooking: (...args: unknown[]) => createBooking(...args),
  },
}))

vi.mock('@/lib/api/idempotency', () => ({
  getIdempotencyKey: () => 'test-idempotency-key',
  computeIdempotencyRequestHash: (payload: unknown) => JSON.stringify(payload),
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  persistIdempotencyResponse: vi.fn().mockResolvedValue(undefined),
  releaseIdempotencyClaim: vi.fn().mockResolvedValue(undefined),
  markIdempotencyClaimCommitted: vi.fn().mockResolvedValue(undefined),
}))

const limitBookingAttempt = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/booking-rate-limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/booking-rate-limits')>()),
  limitBookingAttempt,
}))

vi.mock('@/lib/money-alerts', () => ({
  alertMoneyNeedsAPerson: vi.fn().mockResolvedValue({ sent: true, duplicate: false }),
}))

vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: () => async () => null,
}))

// Authentication is proved in privateBookingEnquiryAuth.test.ts. Here the guard
// is passed straight through so the cases can look at what the handler does.
vi.mock('@/lib/api/auth', () => ({
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
  withApiAuth: vi.fn(
    async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request)
  ),
}))

vi.mock('@/lib/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  formatPhoneForStorage: (phone: string) => phone,
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/communications/web-enquiry', () => ({
  recordPrivateBookingWebEnquiryCommunication: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendManagerPrivateBookingCreatedEmail: vi.fn().mockResolvedValue({ sent: true }),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/consent', () => ({
  ConsentService: { applyBookingContactConsent: vi.fn().mockResolvedValue(undefined) },
}))

const { warn, error, info } = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn, error, info } }))

import { POST } from '@/app/api/private-booking-enquiry/route'
import { ConsentService } from '@/services/consent'
import { sendManagerPrivateBookingCreatedEmail } from '@/lib/private-bookings/manager-notifications'
import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { markIdempotencyClaimCommitted, releaseIdempotencyClaim } from '@/lib/api/idempotency'

function enquiry(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/private-booking-enquiry', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
    body: JSON.stringify(body),
  })
}

const VALID = {
  phone: '+447700900000',
  name: 'Alice Booker',
  date: '2026-09-10',
  time: '19:00',
  group_size: 30,
  communication_consent: { service_contact_notice_shown: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  limitBookingAttempt.mockResolvedValue(null)
  createBooking.mockResolvedValue({ id: 'pb-1', customer_id: 'cust-1', booking_reference: 'PB-1' })
})

describe('POST /api/private-booking-enquiry failure paths', () => {
  it('still answers 201 and emails the pub when the consent write throws after the enquiry is saved', async () => {
    vi.mocked(ConsentService.applyBookingContactConsent).mockRejectedValueOnce(new Error('consent insert failed'))

    const response = await POST(enquiry(VALID) as never)

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ success: true, state: 'enquiry_created', booking_id: 'pb-1' })
    expect(sendManagerPrivateBookingCreatedEmail).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith('Booking saved but the guest contact choices did not record', expect.anything())
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      domain: 'private_bookings', bookingId: 'pb-1', kind: 'consent_not_recorded',
    }))
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('notes the saved enquiry on the claim straight away, so a retry after a crash replays it', async () => {
    await POST(enquiry(VALID) as never)

    expect(markIdempotencyClaimCommitted).toHaveBeenCalledWith(
      expect.anything(), 'test-idempotency-key', expect.any(String),
      expect.objectContaining({ booking_id: 'pb-1', state: 'enquiry_created' })
    )
  })

  it('logs an error (not a silent warning) when the manager email fails, and still answers 201', async () => {
    vi.mocked(sendManagerPrivateBookingCreatedEmail).mockResolvedValueOnce({ sent: false, error: 'graph 503' } as never)

    const response = await POST(enquiry(VALID) as never)

    expect(response.status).toBe(201)
    expect(error).toHaveBeenCalledWith('Failed to send manager private booking created email (enquiry endpoint)', expect.anything())
  })

  it('answers 500 INTERNAL_ERROR, releases the claim and logs an error when the enquiry cannot be saved', async () => {
    createBooking.mockRejectedValueOnce(new Error('permission denied for function create_private_booking_transaction'))

    const response = await POST(enquiry(VALID) as never)

    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('INTERNAL_ERROR')
    expect(releaseIdempotencyClaim).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith('Error creating private booking enquiry', expect.anything())
  })

  it('counts enquiries per guest phone, not per website server, and refuses with 429 over the limit (BK-108)', async () => {
    limitBookingAttempt.mockImplementation(async (_request: unknown, options: { prefix: string }) =>
      options.prefix === 'private-booking-enquiry-contact'
        ? Response.json({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many' } }, { status: 429 })
        : null
    )

    const response = await POST(enquiry(VALID) as never)

    expect(response.status).toBe(429)
    expect(limitBookingAttempt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prefix: 'private-booking-enquiry-contact', subject: '+447700900000', max: 10,
    }))
    // An API-key caller is never put in the per-IP bucket the whole website used to share.
    expect(limitBookingAttempt).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prefix: 'private-booking-enquiry-ip',
    }))
    expect(createBooking).not.toHaveBeenCalled()
  })
})
