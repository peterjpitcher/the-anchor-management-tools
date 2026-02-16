import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn(async () => ({ url: 'http://localhost/manage' })),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { acceptWaitlistOfferByRawToken } from '@/lib/events/waitlist-offers'
import { sendSMS } from '@/lib/twilio'
import { POST } from '@/app/g/[token]/waitlist-offer/confirm/route'

function buildSupabase(options: { eventError?: { message: string } | null; eventRow?: boolean }) {
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
            payment_mode: 'free',
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

describe('guest waitlist offer confirm route SMS guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    ;(acceptWaitlistOfferByRawToken as unknown as vi.Mock).mockResolvedValue({
      state: 'confirmed',
      booking_id: 'booking-1',
      event_id: 'event-1',
    })
  })

  it('does not send acceptance SMS when event lookup errors', async () => {
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(
      buildSupabase({ eventError: { message: 'events unavailable' } }) as any
    )

    const response = await POST(
      new Request('http://localhost/g/raw-token/waitlist-offer/confirm', { method: 'POST' }) as any,
      { params: Promise.resolve({ token: 'raw-token' }) } as any
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toContain('/g/raw-token/waitlist-offer')
    expect(response.headers.get('location')).toContain('state=confirmed')
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('does not send acceptance SMS when event lookup affects no rows', async () => {
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(
      buildSupabase({ eventRow: false }) as any
    )

    const response = await POST(
      new Request('http://localhost/g/raw-token/waitlist-offer/confirm', { method: 'POST' }) as any,
      { params: Promise.resolve({ token: 'raw-token' }) } as any
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toContain('/g/raw-token/waitlist-offer')
    expect(response.headers.get('location')).toContain('state=confirmed')
    expect(sendSMS).not.toHaveBeenCalled()
  })
})
