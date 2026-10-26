import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * A guest who gives a landline or a non-UK number and no email got no confirmation, reminder or
 * payment link, and nobody was told (BK-162). The public routes now ask for an email instead, and
 * a booking whose email is not the one on the customer record keeps it for its own messages
 * (BK-078).
 */

vi.mock('@/lib/api/auth', () => ({
  isApiKeyAuthenticated: vi.fn().mockResolvedValue(true),
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
  withApiAuth: vi.fn(
    async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request)
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json(data, { status })),
  createErrorResponse: vi.fn((error: string, code: string, status = 400) =>
    Response.json({ success: false, error, code }, { status })
  ),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  computeIdempotencyRequestHash: vi.fn().mockReturnValue('request-hash'),
  getIdempotencyKey: vi.fn().mockReturnValue('idem-1'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/services/consent', () => ({ ConsentService: { applyBookingContactConsent: vi.fn() } }))
vi.mock('@/lib/bookings/contact-email', () => ({ recordBookingContactEmail: vi.fn() }))
vi.mock('@/lib/table-bookings/bookings', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/table-bookings/bookings')>()),
  alignTablePaymentHoldToScheduledSend: vi.fn(),
  createTablePaymentToken: vi.fn(),
  sendTableBookingCreatedSmsIfAllowed: vi.fn().mockResolvedValue({ sms: null, notificationSent: true }),
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { recordBookingContactEmail } from '@/lib/bookings/contact-email'
import { POST as postTableBooking } from '@/app/api/table-bookings/route'
import { POST as postEventBooking } from '@/app/api/event-bookings/route'
import { POST as postWaitlist } from '@/app/api/event-waitlist/route'

const LANDLINE = '01753 682707'
const UK_MOBILE = '07123 456789'

function tableRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/table-bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
    body: JSON.stringify({ first_name: 'Pat', date: '2026-12-05', time: '18:00', party_size: 2, purpose: 'food', ...body }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(ensureCustomerForPhone as unknown as Mock).mockResolvedValue({
    customerId: 'customer-1',
    bookingContactEmail: 'pat.new@example.com',
  })
  ;(createAdminClient as unknown as Mock).mockReturnValue({
    rpc: vi.fn(async (name: string) => {
      if (name === 'create_table_booking_public_v06') {
        return {
          data: { state: 'confirmed', table_booking_id: 'tb-1', booking_reference: 'TB-1', status: 'confirmed', party_size: 2 },
          error: null,
        }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    }),
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'update', 'insert', 'eq', 'in', 'order', 'limit']) builder[method] = vi.fn(() => builder)
      builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
      builder.single = vi.fn(async () => ({ data: null, error: null }))
      return builder
    }),
  })
})

describe('public booking routes: a number that cannot take texts', () => {
  it('table booking: asks for an email for a landline and resolves no customer', async () => {
    const response = await postTableBooking(tableRequest({ phone: LANDLINE }) as any)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({ success: false, code: 'EMAIL_REQUIRED_FOR_NON_MOBILE' })
    expect(ensureCustomerForPhone).not.toHaveBeenCalled()
  })

  it('event booking: asks for an email for a landline', async () => {
    const request = new NextRequest('http://localhost/api/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({ event_id: '11111111-1111-4111-8111-111111111111', phone: LANDLINE, first_name: 'Pat', seats: 2 }),
    })
    const response = await postEventBooking(request as any)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({ code: 'EMAIL_REQUIRED_FOR_NON_MOBILE' })
    expect(ensureCustomerForPhone).not.toHaveBeenCalled()
  })

  it('event waitlist: asks for an email for a landline', async () => {
    const request = new NextRequest('http://localhost/api/event-waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({ event_id: '11111111-1111-4111-8111-111111111111', phone: LANDLINE, first_name: 'Pat', requested_seats: 2 }),
    })
    const response = await postWaitlist(request as any)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({ code: 'EMAIL_REQUIRED_FOR_NON_MOBILE' })
    expect(ensureCustomerForPhone).not.toHaveBeenCalled()
  })

  it('table booking: takes a landline with an email, and keeps that email on the booking', async () => {
    const response = await postTableBooking(tableRequest({ phone: LANDLINE, email: 'pat.new@example.com' }) as any)

    expect(response.status).toBeLessThan(400)
    expect(ensureCustomerForPhone).toHaveBeenCalledTimes(1)
    // A website caller is never a trusted entry: no options are passed (BK-077).
    expect((ensureCustomerForPhone as unknown as Mock).mock.calls[0]).toHaveLength(3)
    expect(recordBookingContactEmail).toHaveBeenCalledWith('table_bookings', 'tb-1', 'pat.new@example.com')
  })

  it('table booking: keeps no typed email when the booking was refused', async () => {
    // An id on a refused answer is somebody's existing booking; a typed address must never land on it.
    ;(createAdminClient as unknown as Mock).mockReturnValue({
      rpc: vi.fn(async () => ({
        data: { state: 'blocked', reason: 'no_table', table_booking_id: 'tb-existing' },
        error: null,
      })),
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {}
        for (const method of ['select', 'update', 'insert', 'eq', 'in', 'order', 'limit']) builder[method] = vi.fn(() => builder)
        builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
        builder.single = vi.fn(async () => ({ data: null, error: null }))
        return builder
      }),
    })

    await postTableBooking(tableRequest({ phone: LANDLINE, email: 'pat.new@example.com' }) as any)

    expect(recordBookingContactEmail).not.toHaveBeenCalled()
  })

  it('table booking: takes a UK mobile with no email', async () => {
    const response = await postTableBooking(tableRequest({ phone: UK_MOBILE }) as any)
    expect(response.status).toBeLessThan(400)
    expect(ensureCustomerForPhone).toHaveBeenCalledTimes(1)
  })
})
