import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The route asks for an email when the number cannot take texts (BK-162). These tests use made-up
// numbers, so the rule is switched off here; tests/api/publicBookingNonMobile.test.ts covers it.
vi.mock('@/lib/phone/uk-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/phone/uk-mobile')>()),
  isUkMobile: () => true,
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (
      handler: (request: Request) => Promise<Response>,
      _permissions: string[],
      request: Request
    ) => handler(request)
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json(data, { status })),
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
  createErrorResponse: vi.fn((error: string, code: string, status = 400) =>
    Response.json(
      {
        success: false,
        error,
        code,
      },
      { status }
    )
  ),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  computeIdempotencyRequestHash: vi.fn().mockReturnValue('request-hash'),
  getIdempotencyKey: vi.fn().mockReturnValue('idem-1'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((value: string) => value),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn().mockResolvedValue({ url: 'https://example.com/manage' }),
}))

vi.mock('@/lib/events/event-payments', () => ({
  createEventPaymentToken: vi.fn().mockResolvedValue({ url: 'https://example.com/pay' }),
  getEventAmountDueForBooking: vi.fn(),
}))

vi.mock('@/lib/events/sunday-lunch-only-policy', () => ({
  isSundayLunchOnlyEvent: vi.fn().mockReturnValue(false),
  SUNDAY_LUNCH_ONLY_EVENT_MESSAGE: 'Sunday lunch only',
}))

const { warn, error, info } = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn,
    error,
    info,
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { sendSMS } from '@/lib/twilio'
import { getEventAmountDueForBooking } from '@/lib/events/event-payments'
import { POST } from '@/app/api/event-bookings/route'

/**
 * Website ticket buyers with PayPal on screen (BK-084, BK-100, customer bookings review of
 * 24 October 2026): no "pay here" text while they pay, and the answer carries the hold deadline
 * and the amount so the website can show them.
 */
describe('event booking route: website checkout hold and text', () => {
  const eventId = '11111111-1111-4111-8111-111111111111'
  const customerId = '22222222-2222-4222-8222-222222222222'
  // 19:27 BST on Friday 3 July 2026, a summer date, so the London clock is an hour ahead of UTC.
  const now = new Date('2026-07-03T18:27:00Z')
  const holdExpiresAt = '2026-07-03T18:42:00Z'

  function arrange(): void {
    vi.mocked(ensureCustomerForPhone).mockResolvedValue({ customerId, resolutionError: undefined } as never)
    vi.mocked(getEventAmountDueForBooking).mockResolvedValue({ amount: 30, currency: 'GBP', holdExpiresAt })
    vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM1' } as never)

    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: eventId,
        // No payment_mode on the event row, so the guest-details rule (tested elsewhere) stays
        // out of the way; the booking function still answers pending_payment.
        booking_mode: 'general',
        name: 'Tinsel and Tipples',
        date: '2026-07-10',
        start_datetime: '2026-07-10T18:00:00Z',
      },
      error: null,
    })
    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: customerId, first_name: 'Pat', mobile_number: '+447700900123', sms_status: 'active' },
      error: null,
    })

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle }) }) }
        }
        if (table === 'customers') {
          return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle }) }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_event_booking_v06') {
          return {
            data: {
              state: 'pending_payment',
              booking_id: 'booking-1',
              payment_mode: 'prepaid',
              event_id: eventId,
              event_name: 'Tinsel and Tipples',
              event_start_datetime: '2026-07-10T18:00:00Z',
              hold_expires_at: holdExpiresAt,
              seats_remaining: 10,
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    } as never)
  }

  async function book(extra: Record<string, unknown> = {}): Promise<{ status: number; payload: any }> {
    const response = await POST(new NextRequest('http://localhost/api/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-hold' },
      body: JSON.stringify({ event_id: eventId, phone: '+447700900123', first_name: 'Pat', seats: 2, ...extra }),
    }) as any)
    return { status: response.status, payload: await response.json() }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    arrange()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends no text when the website shows PayPal on the page', async () => {
    const { status, payload } = await book({ skip_customer_sms: true })

    expect(payload.error ?? null).toBeNull()
    expect(status).toBe(201)
    expect(payload.data.state).toBe('pending_payment')
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('returns the hold deadline and the amount due', async () => {
    const { payload } = await book({ skip_customer_sms: true })

    expect(payload.data.hold_expires_at).toBe(holdExpiresAt)
    expect(payload.data.amount_due).toBe(30)
    expect(payload.data.currency).toBe('GBP')
  })

  it('still texts the pay link, with the hold time, when inline PayPal could not be set up', async () => {
    await book({ skip_customer_sms: false })

    expect(sendSMS).toHaveBeenCalledOnce()
    const [, body, options] = vi.mocked(sendSMS).mock.calls[0]
    expect(body).toContain("We'll hold them until 7:42pm.")
    expect(body).toContain('Pay here: https://example.com/pay')
    expect(body).not.toMatch(/undefined|NaN|Invalid Date/)
    expect(options?.metadata).toEqual(expect.objectContaining({
      event_booking_id: 'booking-1',
      expected_booking_status: 'pending_payment',
      hold_expires_at: holdExpiresAt,
    }))
  })

  it('texts as before when an older website sends no flag', async () => {
    await book()
    expect(sendSMS).toHaveBeenCalledOnce()
  })

  it('keeps the booking when the amount cannot be read, and leaves the amount out', async () => {
    vi.mocked(getEventAmountDueForBooking).mockRejectedValueOnce(new Error('db down'))

    const { status, payload } = await book({ skip_customer_sms: true })

    expect(status).toBe(201)
    expect(payload.data.amount_due).toBeNull()
    expect(payload.data.hold_expires_at).toBe(holdExpiresAt)
  })
})
