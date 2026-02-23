import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/payments/stripe', () => ({
  computeStripeCheckoutExpiresAtUnix: vi.fn(() => 1_900_000_000),
  createStripeCheckoutSession: vi.fn(),
}))

vi.mock('@/lib/guest/tokens', () => ({
  createGuestToken: vi.fn().mockResolvedValue({
    rawToken: 'raw-token',
    hashedToken: 'hashed-token',
  }),
  hashGuestToken: vi.fn((raw: string) => `hash-${raw}`),
}))

vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn().mockResolvedValue({ url: 'https://example.com/manage' }),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((body: string) => body),
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

import { sendSMS } from '@/lib/twilio'
import { sendEventPaymentConfirmationSms, sendEventPaymentRetrySms } from '@/lib/events/event-payments'

function buildSupabaseForConfirmation() {
  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'booking-1',
      customer_id: 'customer-1',
      event_id: 'event-1',
    },
    error: null,
  })
  const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
  const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

  const customerMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'customer-1',
      first_name: 'Pat',
      mobile_number: '+447700900123',
      sms_status: 'active',
    },
    error: null,
  })
  const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
  const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

  const eventMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      start_datetime: '2026-03-01T12:00:00.000Z',
      date: '2026-03-01',
      time: '12:00:00',
    },
    error: null,
  })
  const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
  const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

  return {
    from: vi.fn((table: string) => {
      if (table === 'bookings') {
        return { select: bookingSelect }
      }
      if (table === 'customers') {
        return { select: customerSelect }
      }
      if (table === 'events') {
        return { select: eventSelect }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

function buildSupabaseForRetry() {
  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'booking-2',
      customer_id: 'customer-2',
      event_id: 'event-2',
      seats: 2,
      status: 'pending_payment',
      hold_expires_at: '2030-01-02T00:00:00.000Z',
    },
    error: null,
  })
  const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
  const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

  const customerMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'customer-2',
      first_name: 'Pat',
      mobile_number: '+447700900124',
      sms_status: 'active',
    },
    error: null,
  })
  const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
  const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

  const eventMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'event-2',
      name: 'Test Event',
    },
    error: null,
  })
  const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
  const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

  return {
    from: vi.fn((table: string) => {
      if (table === 'bookings') {
        return { select: bookingSelect }
      }
      if (table === 'customers') {
        return { select: customerSelect }
      }
      if (table === 'events') {
        return { select: eventSelect }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

describe('event payment SMS safety meta logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs an error when event payment confirmation SMS returns logging_failed', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: true,
      sid: 'SM1',
      code: 'logging_failed',
      logFailure: true,
    })

    const result = await sendEventPaymentConfirmationSms(buildSupabaseForConfirmation() as any, {
      bookingId: 'booking-1',
      eventName: 'Launch Night',
      seats: 2,
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    })

    expect(error).toHaveBeenCalledWith(
      'Event payment confirmation SMS sent but outbound message logging failed',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'booking-1',
          customerId: 'customer-1',
          code: 'logging_failed',
          logFailure: true,
        }),
      })
    )
  })

  it('logs an error when event payment retry SMS returns logging_failed', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: true,
      sid: 'SM2',
      code: 'logging_failed',
      logFailure: true,
    })

    const result = await sendEventPaymentRetrySms(buildSupabaseForRetry() as any, {
      bookingId: 'booking-2',
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    })

    expect(error).toHaveBeenCalledWith(
      'Event payment retry SMS sent but outbound message logging failed',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'booking-2',
          customerId: 'customer-2',
          code: 'logging_failed',
          logFailure: true,
        }),
      })
    )
  })

  it('propagates non-success safety metadata for event payment confirmation SMS', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: false,
      error: 'SMS sending paused by safety guard',
      code: 'safety_unavailable',
    })

    const result = await sendEventPaymentConfirmationSms(buildSupabaseForConfirmation() as any, {
      bookingId: 'booking-1',
      eventName: 'Launch Night',
      seats: 2,
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: false,
      code: 'safety_unavailable',
      logFailure: false,
    })
  })

  it('propagates logging_failed metadata when confirmation sendSMS throws', async () => {
    ;(sendSMS as unknown as vi.Mock).mockRejectedValueOnce({
      message: 'message persistence unavailable',
      code: 'logging_failed',
      logFailure: false,
    })

    const result = await sendEventPaymentConfirmationSms(buildSupabaseForConfirmation() as any, {
      bookingId: 'booking-1',
      eventName: 'Launch Night',
      seats: 2,
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: false,
      code: 'logging_failed',
      logFailure: true,
    })
  })

  it('fails closed with safety_unavailable when retry sendSMS throws unexpectedly', async () => {
    ;(sendSMS as unknown as vi.Mock).mockRejectedValueOnce(new Error('twilio pipeline failed'))

    const result = await sendEventPaymentRetrySms(buildSupabaseForRetry() as any, {
      bookingId: 'booking-2',
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: false,
      code: 'safety_unavailable',
      logFailure: false,
    })
  })

  it('fails closed with safety_unavailable when confirmation booking lookup errors', async () => {
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'booking read failed' },
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return { select: bookingSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await sendEventPaymentConfirmationSms(supabase as any, {
      bookingId: 'booking-1',
      eventName: 'Launch Night',
      seats: 2,
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: false,
      code: 'safety_unavailable',
      logFailure: false,
    })
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('fails closed with safety_unavailable when retry customer/event lookup errors', async () => {
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-2',
        customer_id: 'customer-2',
        event_id: 'event-2',
        seats: 2,
        status: 'pending_payment',
        hold_expires_at: '2030-01-02T00:00:00.000Z',
      },
      error: null,
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'customer read failed' },
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'event-2', name: 'Test Event' },
      error: null,
    })
    const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
    const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return { select: bookingSelect }
        }
        if (table === 'customers') {
          return { select: customerSelect }
        }
        if (table === 'events') {
          return { select: eventSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await sendEventPaymentRetrySms(supabase as any, {
      bookingId: 'booking-2',
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: false,
      code: 'safety_unavailable',
      logFailure: false,
    })
    expect(sendSMS).not.toHaveBeenCalled()
  })
})
