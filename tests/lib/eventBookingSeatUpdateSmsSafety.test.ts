import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/payments/stripe', () => ({
  computeStripeCheckoutExpiresAtUnix: vi.fn(() => 1_900_000_000),
  createStripeCheckoutSession: vi.fn(),
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

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { sendSMS } from '@/lib/twilio'
import { sendEventBookingSeatUpdateSms } from '@/lib/events/event-payments'
import { logger } from '@/lib/logger'

function buildSupabase() {
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
      mobile_number: '+447700900001',
      sms_status: 'active',
    },
    error: null,
  })
  const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
  const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

  const eventMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      start_datetime: '2026-03-01T12:00:00.000Z',
      date: null,
      time: null,
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

describe('sendEventBookingSeatUpdateSms safety signal propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns code/logFailure when sendSMS reports logging_failed', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM123',
      status: 'queued',
      code: 'logging_failed',
      logFailure: true,
    })

    const result = await sendEventBookingSeatUpdateSms(buildSupabase() as any, {
      bookingId: 'booking-1',
      eventName: 'Launch Night',
      oldSeats: 2,
      newSeats: 4,
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    })

    expect(logger.error).toHaveBeenCalledWith(
      'Event booking seat update SMS sent but outbound message logging failed',
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

  it('treats code=logging_failed as logFailure even when sendSMS omits logFailure', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM123',
      status: 'queued',
      code: 'logging_failed',
      logFailure: false,
    })

    const result = await sendEventBookingSeatUpdateSms(buildSupabase() as any, {
      bookingId: 'booking-1',
      eventName: 'Launch Night',
      oldSeats: 2,
      newSeats: 4,
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    })

    expect(logger.error).toHaveBeenCalledWith(
      'Event booking seat update SMS sent but outbound message logging failed',
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

  it('returns success=false when sendSMS returns non-success', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: false,
      error: 'blocked',
      code: 'safety_unavailable',
    })

    const result = await sendEventBookingSeatUpdateSms(buildSupabase() as any, {
      bookingId: 'booking-1',
      eventName: 'Launch Night',
      oldSeats: 2,
      newSeats: 4,
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result.success).toBe(false)
    expect(result.code).toBe('safety_unavailable')
    expect(logger.warn).toHaveBeenCalledWith(
      'Event booking seat update SMS send returned non-success',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'booking-1',
          customerId: 'customer-1',
          code: 'safety_unavailable',
          logFailure: false,
        }),
      })
    )
  })

  it('propagates idempotency_conflict when sendSMS throws fatal safety metadata', async () => {
    ;(sendSMS as unknown as vi.Mock).mockRejectedValueOnce({
      message: 'idempotency lock conflict',
      code: 'idempotency_conflict',
      logFailure: false,
    })

    const result = await sendEventBookingSeatUpdateSms(buildSupabase() as any, {
      bookingId: 'booking-1',
      eventName: 'Launch Night',
      oldSeats: 2,
      newSeats: 4,
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: false,
      code: 'idempotency_conflict',
      logFailure: false,
    })
  })

  it('returns safety_unavailable when booking lookup errors before send', async () => {
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'booking lookup unavailable' },
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

    const result = await sendEventBookingSeatUpdateSms(supabase as any, {
      bookingId: 'booking-1',
      eventName: 'Launch Night',
      oldSeats: 2,
      newSeats: 4,
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: false,
      code: 'safety_unavailable',
      logFailure: false,
    })
    expect(sendSMS).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to load booking for event seat update SMS',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'booking-1',
          error: 'booking lookup unavailable',
        }),
      })
    )
  })

  it('returns safety_unavailable when customer lookup errors before send', async () => {
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
      data: null,
      error: { message: 'customer lookup unavailable' },
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return { select: bookingSelect }
        }
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await sendEventBookingSeatUpdateSms(supabase as any, {
      bookingId: 'booking-1',
      eventName: 'Launch Night',
      oldSeats: 2,
      newSeats: 4,
      appBaseUrl: 'http://localhost:3000',
    })

    expect(result).toEqual({
      success: false,
      code: 'safety_unavailable',
      logFailure: false,
    })
    expect(sendSMS).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to load customer for event seat update SMS',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'booking-1',
          customerId: 'customer-1',
          error: 'customer lookup unavailable',
        }),
      })
    )
  })
})
