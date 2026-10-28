import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

/**
 * The guest waitlist confirm route when something fails (BK-128 and BK-115, customer bookings
 * review of 24 October 2026): the guest is sent to the error state, the failure is logged as an
 * error, and a payment link that could not be made reaches the manager instead of a promise.
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: vi.fn(async () => ({ allowed: true })),
}))

vi.mock('@/lib/events/waitlist-offers', () => ({
  acceptWaitlistOfferByRawToken: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/events/event-payments', () => ({
  createEventPaymentToken: vi.fn(async () => ({ url: 'http://localhost/pay' })),
}))

vi.mock('@/lib/money-alerts', () => ({
  alertMoneyNeedsAPerson: vi.fn(async () => ({ sent: true, duplicate: false })),
}))

const { warn, error, info } = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn, error, info } }))

vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn(async () => ({ url: 'http://localhost/manage' })),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { acceptWaitlistOfferByRawToken } from '@/lib/events/waitlist-offers'
import { sendSMS } from '@/lib/twilio'
import { createEventPaymentToken } from '@/lib/events/event-payments'
import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { POST } from '@/app/g/[token]/waitlist-offer/confirm/route'

function buildSupabase(options: { eventError?: { message: string } | null; eventRow?: boolean; paymentMode?: string }) {
  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'booking-1',
      customer_id: 'customer-1',
      event_id: 'event-1',
      seats: 2,
      hold_expires_at: '2026-02-20T12:00:00.000Z',
    },
    error: null,
  })

  const bookingMetaMaybeSingle = vi.fn().mockResolvedValue({
    data: { customer_id: 'customer-1', event_id: 'event-1' },
    error: null,
  })
  const bookingEq = vi.fn((field: string, value: string) => {
    if (field === 'id' && value === 'booking-1') {
      return { maybeSingle: bookingMaybeSingle }
    }
    return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
  })

  const bookingMetaEq = vi.fn((field: string, value: string) => {
    if (field === 'id' && value === 'booking-1') {
      return { maybeSingle: bookingMetaMaybeSingle }
    }
    return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
  })

  const customerMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'customer-1',
      first_name: 'Alex',
      mobile_number: '+447700900123',
      sms_status: 'active',
    },
    error: null,
  })
  const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
  const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

  const eventMaybeSingle = vi.fn().mockResolvedValue({
    data:
      options.eventRow === false
        ? null
        : {
            id: 'event-1',
            name: 'Live Music',
            start_datetime: '2026-02-20T19:00:00.000Z',
            payment_mode: options.paymentMode ?? 'free',
          },
    error: options.eventError ?? null,
  })
  const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
  const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

  const from = vi.fn((table: string) => {
    if (table === 'bookings') {
      return {
        select: vi.fn((fields: string) => {
          if (fields.includes('hold_expires_at')) return { eq: bookingEq }
          return { eq: bookingMetaEq }
        }),
      }
    }
    if (table === 'customers') return { select: customerSelect }
    if (table === 'events') return { select: eventSelect }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { from }
}

describe('guest waitlist offer confirm route failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(sendSMS as unknown as Mock).mockResolvedValue({ success: true, sid: 'SM1' })
  })

  it('sends the guest to the internal_error state and logs an error when accepting the offer throws', async () => {
    ;(createAdminClient as unknown as Mock).mockReturnValue(buildSupabase({}) as any)
    ;(acceptWaitlistOfferByRawToken as unknown as Mock).mockRejectedValue(new Error('accept_waitlist_offer_v05 timed out'))

    const response = await POST(
      new Request('http://localhost/g/raw-token/waitlist-offer/confirm', { method: 'POST' }) as any,
      { params: Promise.resolve({ token: 'raw-token' }) } as any
    )

    expect(response.status).toBe(303)
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('state=blocked')
    expect(location).toContain('internal_error')
    expect(error).toHaveBeenCalledWith('Failed to accept waitlist offer token', expect.anything())
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('tells the manager and does not promise a link when the payment link for a paid place fails', async () => {
    ;(createAdminClient as unknown as Mock).mockReturnValue(buildSupabase({ paymentMode: 'prepaid' }) as any)
    ;(acceptWaitlistOfferByRawToken as unknown as Mock).mockResolvedValue({
      state: 'pending_payment',
      booking_id: 'booking-1',
      event_id: 'event-1',
    })
    ;(createEventPaymentToken as unknown as Mock).mockRejectedValue(new Error('guest_tokens insert failed'))

    await POST(
      new Request('http://localhost/g/raw-token/waitlist-offer/confirm', { method: 'POST' }) as any,
      { params: Promise.resolve({ token: 'raw-token' }) } as any
    )

    expect(error).toHaveBeenCalledWith('Failed to create payment token for waitlist acceptance', expect.anything())
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      domain: 'event_bookings', bookingId: 'booking-1', kind: 'waitlist_payment_link_failed',
    }))
    const text = (sendSMS as unknown as Mock).mock.calls[0]?.[1] as string
    expect(text).not.toContain('shortly')
    expect(text).toContain("we'll be in touch")
    expect(text).toContain('01753 682707')
    expect(text).not.toMatch(/undefined|NaN|null|Invalid Date/)
  })
})
