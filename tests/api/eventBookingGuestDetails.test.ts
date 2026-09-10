import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ create: vi.fn(), customer: vi.fn(), paid: true, mixed: false, question: false, arrival: false }))
vi.mock('@/lib/api/auth', () => ({
  withApiAuth: (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) => handler(request),
  getApiKeyAuthState: async () => 'authenticated',
  createApiResponse: (data: unknown, status = 200) => Response.json(data, { status }),
  createErrorResponse: (error: string, code: string, status = 400) => Response.json({ error, code }, { status }),
}))
vi.mock('@/lib/api/idempotency', () => ({
  getIdempotencyKey: () => 'fixture', computeIdempotencyRequestHash: () => 'fixture',
  claimIdempotencyKey: async () => ({ state: 'claimed' }), releaseIdempotencyClaim: vi.fn(), persistIdempotencyResponse: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => {
  const chain = {
    select: () => chain, eq: () => chain,
    then: (resolve: (result: unknown) => unknown) => resolve({ data: [{ base_price: 45 }], error: null }),
    maybeSingle: async () => ({ data: table === 'events' ? {
      id: '11111111-1111-4111-8111-111111111111', name: 'Fixture event', booking_mode: 'general',
      payment_mode: mocks.paid ? (mocks.arrival ? 'cash_only' : 'prepaid') : 'free', price: mocks.paid && !mocks.mixed ? 45 : 0,
      booking_questions: mocks.question ? [{ id: '44444444-4444-4444-8444-444444444444', label: 'Any allergies?', type: 'yes_no', required: true }] : [],
    } : null, error: null }),
  }; return chain
} }) }))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: mocks.customer }))
vi.mock('@/lib/utils', () => ({ formatPhoneForStorage: (phone: string) => phone }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: async () => ({ success: true }), getClientIp: () => '127.0.0.1' }))
vi.mock('@/services/consent', () => ({ ConsentService: { applyBookingContactConsent: vi.fn(), recordConsent: vi.fn(), recordCommunicationConsent: vi.fn() } }))
vi.mock('@/services/event-bookings', () => ({ EventBookingService: { createBooking: mocks.create, normalizeBookingMode: () => 'general' } }))

import { POST } from '@/app/api/event-bookings/route'
const payload = { event_id: '11111111-1111-4111-8111-111111111111', seats: 1, first_name: 'Buyer', phone: '+447700900123' }
const attendee = { id: '22222222-2222-4222-8222-222222222222', name: 'Guest', answers: {} }
const request = (body: object) => new NextRequest('https://example.test/api/event-bookings', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks(); mocks.paid = true; mocks.mixed = false; mocks.question = false; mocks.arrival = false
  mocks.customer.mockResolvedValue({ customerId: '33333333-3333-4333-8333-333333333333' })
  mocks.create.mockResolvedValue({ rpcFailed: true, rpcErrorCode: 'price_changed' })
})
describe('public paid guest boundary', () => {
  it('rejects absent guests before customer or booking mutations', async () => {
    const result = await POST(request(payload))
    expect(result.status).toBe(400)
    expect(mocks.customer).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('also rejects absent guests with a free default and paid ticket option', async () => {
    mocks.mixed = true
    expect((await POST(request(payload))).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('keeps ordinary pay-on-arrival reservations simple', async () => {
    mocks.arrival = true
    await POST(request(payload))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ requireGuestDetails: false }))
  })
  it('does not require guest details for free events', async () => {
    mocks.paid = false
    await POST(request(payload))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ requireGuestDetails: false }))
  })
  it('passes guest details and quote to the atomic booking service and exposes a price conflict', async () => {
    const response = await POST(request({ ...payload, attendees: [attendee], expected_total: 40 }))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ attendees: [attendee], expectedTotal: 40, requireGuestDetails: true }))
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('PRICE_CHANGED')
  })
  it('rejects missing required answers before creating a customer', async () => {
    mocks.question = true
    const response = await POST(request({ ...payload, attendees: [attendee] }))
    expect(response.status).toBe(400)
    expect(mocks.customer).not.toHaveBeenCalled()
  })
})
