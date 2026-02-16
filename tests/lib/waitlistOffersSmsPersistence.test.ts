import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/guest/tokens', () => ({
  createGuestToken: vi.fn(),
  hashGuestToken: vi.fn((raw: string) => `hash:${raw}`),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/sms/quiet-hours', () => ({
  evaluateSmsQuietHours: vi.fn(() => ({
    nextAllowedSendAt: new Date('2026-02-14T12:00:00.000Z'),
  })),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((value: string) => value),
}))

import { sendSMS } from '@/lib/twilio'
import { createGuestToken } from '@/lib/guest/tokens'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { sendWaitlistOfferSms } from '@/lib/events/waitlist-offers'

function buildSupabase(options: {
  offerRow: boolean
  holdRows: Array<{ id: string }>
  tokenRow: boolean
  customerRow?: boolean
  customerError?: { message: string } | null
  eventRow?: boolean
  eventError?: { message: string } | null
}) {
  const customerMaybeSingle = vi.fn().mockResolvedValue({
    data:
      options.customerRow === false
        ? null
        : {
            id: 'customer-1',
            first_name: 'Alex',
            mobile_number: '+447700900123',
            sms_status: 'active',
          },
    error: options.customerError ?? null,
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
            start_datetime: '2026-02-16T19:00:00.000Z',
            date: null,
            time: null,
          },
    error: options.eventError ?? null,
  })
  const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
  const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

  const offerMaybeSingle = vi.fn().mockResolvedValue({
    data: options.offerRow ? { id: 'offer-1' } : null,
    error: null,
  })
  const offerSelect = vi.fn().mockReturnValue({ maybeSingle: offerMaybeSingle })
  const offerEq = vi.fn().mockReturnValue({ select: offerSelect })
  const offerUpdate = vi.fn().mockReturnValue({ eq: offerEq })

  const holdsSelect = vi.fn().mockResolvedValue({
    data: options.holdRows,
    error: null,
  })
  const holdsEqStatus = vi.fn().mockReturnValue({ select: holdsSelect })
  const holdsEqOffer = vi.fn().mockReturnValue({ eq: holdsEqStatus })
  const holdsUpdate = vi.fn().mockReturnValue({ eq: holdsEqOffer })

  const tokenMaybeSingle = vi.fn().mockResolvedValue({
    data: options.tokenRow ? { id: 'token-1' } : null,
    error: null,
  })
  const tokenSelect = vi.fn().mockReturnValue({ maybeSingle: tokenMaybeSingle })
  const tokenEq = vi.fn().mockReturnValue({ select: tokenSelect })
  const tokenUpdate = vi.fn().mockReturnValue({ eq: tokenEq })

  return {
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        return { select: customerSelect }
      }
      if (table === 'events') {
        return { select: eventSelect }
      }
      if (table === 'waitlist_offers') {
        return { update: offerUpdate }
      }
      if (table === 'booking_holds') {
        return { update: holdsUpdate }
      }
      if (table === 'guest_tokens') {
        return {
          update: tokenUpdate,
          delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

describe('waitlist offer SMS post-send persistence guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      scheduledFor: '2026-02-14T12:00:00.000Z',
      sid: 'SM123',
    })
    ;(createGuestToken as unknown as vi.Mock).mockResolvedValue({
      rawToken: 'raw-token',
      hashedToken: 'hashed-token',
    })
    ;(recordAnalyticsEvent as unknown as vi.Mock).mockResolvedValue(undefined)
  })

  it('returns logging_failed when waitlist offer update affects no rows after SMS send', async () => {
    const supabase = buildSupabase({
      offerRow: false,
      holdRows: [{ id: 'hold-1' }],
      tokenRow: true,
    })

    const result = await sendWaitlistOfferSms(
      supabase as any,
      {
        state: 'offered',
        waitlist_offer_id: 'offer-1',
        waitlist_entry_id: 'entry-1',
        event_id: 'event-1',
        customer_id: 'customer-1',
        requested_seats: 2,
      },
      'http://localhost:3000'
    )

    expect(result).toEqual({
      success: true,
      scheduledSendAt: '2026-02-14T12:00:00.000Z',
      reason: 'post_send_persistence_failed',
      code: 'logging_failed',
      logFailure: true,
    })
  })

  it('fails closed when event lookup errors before token creation', async () => {
    const supabase = buildSupabase({
      offerRow: true,
      holdRows: [{ id: 'hold-1' }],
      tokenRow: true,
      eventError: { message: 'events unavailable' },
    })

    const result = await sendWaitlistOfferSms(
      supabase as any,
      {
        state: 'offered',
        waitlist_offer_id: 'offer-1',
        waitlist_entry_id: 'entry-1',
        event_id: 'event-1',
        customer_id: 'customer-1',
        requested_seats: 2,
      },
      'http://localhost:3000'
    )

    expect(result).toEqual({
      success: false,
      reason: 'event_lookup_failed',
      code: 'safety_unavailable',
      logFailure: false,
    })
    expect(createGuestToken).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
    expect(recordAnalyticsEvent).not.toHaveBeenCalled()
  })

  it('fails closed with safety_unavailable when customer lookup errors before token creation', async () => {
    const supabase = buildSupabase({
      offerRow: true,
      holdRows: [{ id: 'hold-1' }],
      tokenRow: true,
      customerError: { message: 'customers unavailable' },
    })

    const result = await sendWaitlistOfferSms(
      supabase as any,
      {
        state: 'offered',
        waitlist_offer_id: 'offer-1',
        waitlist_entry_id: 'entry-1',
        event_id: 'event-1',
        customer_id: 'customer-1',
        requested_seats: 2,
      },
      'http://localhost:3000'
    )

    expect(result).toEqual({
      success: false,
      reason: 'customer_lookup_failed',
      code: 'safety_unavailable',
      logFailure: false,
    })
    expect(createGuestToken).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
    expect(recordAnalyticsEvent).not.toHaveBeenCalled()
  })

  it('fails closed when event lookup affects no rows before token creation', async () => {
    const supabase = buildSupabase({
      offerRow: true,
      holdRows: [{ id: 'hold-1' }],
      tokenRow: true,
      eventRow: false,
    })

    const result = await sendWaitlistOfferSms(
      supabase as any,
      {
        state: 'offered',
        waitlist_offer_id: 'offer-1',
        waitlist_entry_id: 'entry-1',
        event_id: 'event-1',
        customer_id: 'customer-1',
        requested_seats: 2,
      },
      'http://localhost:3000'
    )

    expect(result).toEqual({ success: false, reason: 'event_not_found' })
    expect(createGuestToken).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
    expect(recordAnalyticsEvent).not.toHaveBeenCalled()
  })

  it('returns logging_failed when guest token expiry update affects no rows after SMS send', async () => {
    const supabase = buildSupabase({
      offerRow: true,
      holdRows: [{ id: 'hold-1' }],
      tokenRow: false,
    })

    const result = await sendWaitlistOfferSms(
      supabase as any,
      {
        state: 'offered',
        waitlist_offer_id: 'offer-1',
        waitlist_entry_id: 'entry-1',
        event_id: 'event-1',
        customer_id: 'customer-1',
        requested_seats: 2,
      },
      'http://localhost:3000'
    )

    expect(result).toEqual({
      success: true,
      scheduledSendAt: '2026-02-14T12:00:00.000Z',
      reason: 'post_send_persistence_failed',
      code: 'logging_failed',
      logFailure: true,
    })
  })

  it('keeps send success when analytics logging fails but critical persistence succeeds', async () => {
    ;(recordAnalyticsEvent as unknown as vi.Mock).mockRejectedValue(
      new Error('analytics unavailable')
    )

    const supabase = buildSupabase({
      offerRow: true,
      holdRows: [{ id: 'hold-1' }],
      tokenRow: true,
    })

    const result = await sendWaitlistOfferSms(
      supabase as any,
      {
        state: 'offered',
        waitlist_offer_id: 'offer-1',
        waitlist_entry_id: 'entry-1',
        event_id: 'event-1',
        customer_id: 'customer-1',
        requested_seats: 2,
      },
      'http://localhost:3000'
    )

    expect(result).toEqual({
      success: true,
      scheduledSendAt: '2026-02-14T12:00:00.000Z',
    })
  })

  it('normalizes logging_failed into logFailure=true even when sendSMS returns logFailure=false', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      scheduledFor: '2026-02-14T12:00:00.000Z',
      sid: 'SM123',
      code: 'logging_failed',
      logFailure: false,
    })

    const supabase = buildSupabase({
      offerRow: true,
      holdRows: [{ id: 'hold-1' }],
      tokenRow: true,
    })

    const result = await sendWaitlistOfferSms(
      supabase as any,
      {
        state: 'offered',
        waitlist_offer_id: 'offer-1',
        waitlist_entry_id: 'entry-1',
        event_id: 'event-1',
        customer_id: 'customer-1',
        requested_seats: 2,
      },
      'http://localhost:3000'
    )

    expect(result).toEqual({
      success: true,
      scheduledSendAt: '2026-02-14T12:00:00.000Z',
      code: 'logging_failed',
      logFailure: true,
    })
  })

  it('fails closed with safety_unavailable metadata when sendSMS throws before persistence updates', async () => {
    ;(sendSMS as unknown as vi.Mock).mockRejectedValue(new Error('twilio transport threw'))

    const supabase = buildSupabase({
      offerRow: true,
      holdRows: [{ id: 'hold-1' }],
      tokenRow: true,
    })

    const result = await sendWaitlistOfferSms(
      supabase as any,
      {
        state: 'offered',
        waitlist_offer_id: 'offer-1',
        waitlist_entry_id: 'entry-1',
        event_id: 'event-1',
        customer_id: 'customer-1',
        requested_seats: 2,
      },
      'http://localhost:3000'
    )

    expect(result).toEqual({
      success: false,
      reason: 'sms_send_failed',
      code: 'safety_unavailable',
      logFailure: false,
    })
  })

  it('propagates thrown idempotency_conflict metadata when sendSMS throws', async () => {
    ;(sendSMS as unknown as vi.Mock).mockRejectedValue(
      Object.assign(new Error('sms blocked by idempotency lock'), {
        code: 'idempotency_conflict',
        logFailure: false,
      })
    )

    const supabase = buildSupabase({
      offerRow: true,
      holdRows: [{ id: 'hold-1' }],
      tokenRow: true,
    })

    const result = await sendWaitlistOfferSms(
      supabase as any,
      {
        state: 'offered',
        waitlist_offer_id: 'offer-1',
        waitlist_entry_id: 'entry-1',
        event_id: 'event-1',
        customer_id: 'customer-1',
        requested_seats: 2,
      },
      'http://localhost:3000'
    )

    expect(result).toEqual({
      success: false,
      reason: 'sms_send_failed',
      code: 'idempotency_conflict',
      logFailure: false,
    })
  })
})
