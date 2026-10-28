import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ create: vi.fn(), customer: vi.fn(), paid: true, mixed: false, question: false, arrival: false, collect: null as boolean | null }))
// The route asks for an email when the number cannot take texts (BK-162). These tests use made-up
// numbers, so the rule is switched off here; tests/api/publicBookingNonMobile.test.ts covers it.
vi.mock('@/lib/phone/uk-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/phone/uk-mobile')>()),
  isUkMobile: () => true,
}))

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
      collect_guest_details: mocks.collect,
    } : null, error: null }),
  }; return chain
} }) }))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: mocks.customer }))
vi.mock('@/lib/utils', () => ({ formatPhoneForStorage: (phone: string) => phone }))
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger }))
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: async () => ({ success: true }), getClientIp: () => '127.0.0.1' }))
vi.mock('@/services/consent', () => ({ ConsentService: { applyBookingContactConsent: vi.fn(), recordConsent: vi.fn(), recordCommunicationConsent: vi.fn() } }))
vi.mock('@/services/event-bookings', () => ({ EventBookingService: { createBooking: mocks.create, normalizeBookingMode: () => 'general' } }))

import { POST } from '@/app/api/event-bookings/route'
const payload = { event_id: '11111111-1111-4111-8111-111111111111', seats: 1, first_name: 'Buyer', phone: '+447700900123' }
const attendee = { id: '22222222-2222-4222-8222-222222222222', name: 'Guest', answers: {} }
const request = (body: object) => new NextRequest('https://example.test/api/event-bookings', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks(); mocks.paid = true; mocks.mixed = false; mocks.question = false; mocks.arrival = false; mocks.collect = null
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
  // BK-014, owner decision D4: one setting on each event, defaulting to paid online in advance.
  it('asks every guest on a pay-on-arrival event once guest details are switched on', async () => {
    mocks.arrival = true; mocks.collect = true
    const response = await POST(request(payload))
    expect(response.status).toBe(400)
    expect(mocks.customer).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    await POST(request({ ...payload, attendees: [attendee] }))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ attendees: [attendee], requireGuestDetails: true }))
  })
  it('asks no guest details on a prepaid event once they are switched off', async () => {
    mocks.collect = false
    await POST(request(payload))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ requireGuestDetails: false }))
  })
  it('follows the switch, not the questions: a pay-on-arrival event with questions but the switch off asks nothing', async () => {
    mocks.arrival = true; mocks.question = true; mocks.collect = false
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
  // BK-013: each guest's own mobile, optional, normalised and kept on the guest.
  it('normalises a guest mobile to E.164 before booking', async () => {
    await POST(request({ ...payload, attendees: [{ ...attendee, phone: '07700 900456' }], expected_total: 40 }))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ attendees: [{ ...attendee, phone: '+447700900456' }] }))
  })
  it('drops a blank guest mobile rather than storing it', async () => {
    await POST(request({ ...payload, attendees: [{ ...attendee, phone: '  ' }], expected_total: 40 }))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ attendees: [attendee] }))
  })
  it('refuses a guest mobile that cannot be a phone number, before creating a customer', async () => {
    const response = await POST(request({ ...payload, attendees: [{ ...attendee, phone: '12' }] }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Please check the guest mobile numbers')
    expect(mocks.customer).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects missing required answers before creating a customer', async () => {
    mocks.question = true
    const response = await POST(request({ ...payload, attendees: [attendee] }))
    expect(response.status).toBe(400)
    expect(mocks.customer).not.toHaveBeenCalled()
  })
  // BK-134: a refusal is reported as what it is.
  it('reports a wrong guest count as a validation error, not as changed questions', async () => {
    mocks.question = true
    const response = await POST(request({ ...payload, seats: 2, attendees: [attendee] }))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('VALIDATION_ERROR')
  })
  it('still reports an answer to a question the event no longer asks as changed questions', async () => {
    mocks.question = true
    const stale = { ...attendee, answers: { '55555555-5555-4555-8555-555555555555': 'yes' } }
    const response = await POST(request({ ...payload, attendees: [stale] }))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('BOOKING_QUESTIONS_CHANGED')
  })
  it('turns guest details the database refuses as malformed into a logged 400, not a quiet 409', async () => {
    mocks.create.mockResolvedValue({ rpcFailed: true, rpcErrorCode: 'guest_details_invalid' })
    const response = await POST(request({ ...payload, attendees: [attendee], expected_total: 40 }))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('VALIDATION_ERROR')
    expect(logger.error).toHaveBeenCalledWith('Event booking refused guest details the website should have caught', expect.anything())
  })
  it('turns an unrecognised database error into a 500, not changed questions', async () => {
    mocks.create.mockResolvedValue({ rpcFailed: true, rpcErrorCode: null })
    const response = await POST(request({ ...payload, attendees: [attendee], expected_total: 40 }))
    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('DATABASE_ERROR')
  })
  // BK-098: the website added a pence price up in floating point, and the exact comparison in the
  // booking function refused it as "price changed" on every retry.
  it.each([
    ['12.95 x 3', 12.95 * 3, 38.85],
    ['4.95 x 3', 4.95 * 3, 14.85],
    ['19.99 x 5', 19.99 * 5, 99.95],
    ['13.00 less 10% x 3', 11.7 * 3, 35.1],
  ])('passes a pence total of %s to the booking function rounded to pence', async (_label, sent, expected) => {
    await POST(request({ ...payload, seats: 1, attendees: [attendee], expected_total: sent }))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ expectedTotal: expected }))
  })
})

