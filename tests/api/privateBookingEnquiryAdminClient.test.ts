import { beforeEach, describe, expect, it, vi } from 'vitest'

// The public private-hire enquiry endpoint must write with the service-role
// client.
//
// 20260811100100_revoke_anon_execute_and_public_reads.sql revoked anon EXECUTE
// on create_private_booking_transaction, stating that this route already
// reached it through createAdminClient. It did not: the admin client was used
// for idempotency and analytics only, and createBooking fell back to its
// default cookie-session client, which for an API-key caller is the anon role.
// From 11 August 2026 every enquiry from the brand site died on a permission
// error and was returned to the guest as a 500. This test fails if the admin
// client stops being passed.

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
}))

vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: () => async () => null,
}))

vi.mock('@/lib/api/auth', () => ({
  getApiKeyAuthState: vi.fn().mockResolvedValue('valid'),
}))

vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken: vi.fn().mockResolvedValue({ success: true }),
  getClientIp: () => '203.0.113.1',
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

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { POST } from '@/app/api/private-booking-enquiry/route'

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
  notes: 'Milestone birthday',
}

beforeEach(() => {
  vi.clearAllMocks()
  createBooking.mockResolvedValue({ id: 'pb-1', customer_id: 'cust-1' })
})

describe('POST /api/private-booking-enquiry', () => {
  it('creates the booking with the service-role client', async () => {
    const response = await POST(enquiry(VALID) as never)

    expect(response.status).toBe(201)
    expect(createBooking).toHaveBeenCalledTimes(1)

    const [, options] = createBooking.mock.calls[0]
    expect(options).toEqual({ client: ADMIN_CLIENT })
  })

  it('accepts a party larger than 50 guests', async () => {
    // The cap used to be 50, so the biggest and most valuable enquiries were
    // the only ones rejected. Private hire is advertised at 10 to 150 guests.
    const response = await POST(enquiry({ ...VALID, group_size: 150 }) as never)

    expect(response.status).toBe(201)
    expect(createBooking.mock.calls[0][0]).toMatchObject({ guest_count: 150 })
  })

  it('stores the email and event type as columns, not just notes', async () => {
    await POST(enquiry({
      ...VALID,
      email: 'alice@example.com',
      event_type: 'Milestone Birthday',
    }) as never)

    expect(createBooking.mock.calls[0][0]).toMatchObject({
      contact_email: 'alice@example.com',
      event_type: 'Milestone Birthday',
    })
  })

  it('rejects an absurd party size with wording a guest can act on', async () => {
    const response = await POST(enquiry({ ...VALID, group_size: 5000 }) as never)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('01753 682707')
    expect(createBooking).not.toHaveBeenCalled()
  })
})
