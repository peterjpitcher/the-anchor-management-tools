import { beforeEach, describe, expect, it, vi } from 'vitest'

const { warn, error } = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn,
    error,
  },
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((value: string) => value),
}))

import { sendSMS } from '@/lib/twilio'
import { sendTableBookingCreatedSmsIfAllowed } from '@/lib/table-bookings/bookings'

describe('table booking created SMS safety meta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns sms meta and logs error when Twilio logging fails', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: true,
      sid: 'SM1',
      code: 'logging_failed',
      logFailure: true,
      scheduledFor: '2026-03-01T10:00:00.000Z',
    })

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

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await sendTableBookingCreatedSmsIfAllowed(supabase as any, {
      customerId: 'customer-1',
      normalizedPhone: '+447700900123',
      bookingResult: {
        state: 'pending_card_capture',
        status: 'pending_card_capture',
        table_booking_id: 'table-booking-1',
        start_datetime: '2026-03-01T12:00:00.000Z',
        party_size: 2,
      } as any,
      nextStepUrl: 'https://example.com/card',
    })

    expect(result).toEqual({
      scheduledFor: '2026-03-01T10:00:00.000Z',
      sms: {
        success: true,
        code: 'logging_failed',
        logFailure: true,
      },
    })
    expect(error).toHaveBeenCalledWith(
      'Table booking created SMS sent but outbound message logging failed',
      expect.objectContaining({
        metadata: expect.objectContaining({
          code: 'logging_failed',
          logFailure: true,
        }),
      })
    )
  })

  it('treats success:false logging_failed as sent/unknown to avoid retry-driven duplicates', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: false,
      error: 'SMS sent but message persistence failed',
      code: 'logging_failed',
      logFailure: true,
      scheduledFor: '2026-03-01T10:00:00.000Z',
    })

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

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await sendTableBookingCreatedSmsIfAllowed(supabase as any, {
      customerId: 'customer-1',
      normalizedPhone: '+447700900123',
      bookingResult: {
        state: 'pending_card_capture',
        status: 'pending_card_capture',
        table_booking_id: 'table-booking-1',
        start_datetime: '2026-03-01T12:00:00.000Z',
        party_size: 2,
      } as any,
      nextStepUrl: 'https://example.com/card',
    })

    expect(result).toEqual({
      scheduledFor: '2026-03-01T10:00:00.000Z',
      sms: {
        success: true,
        code: 'logging_failed',
        logFailure: true,
      },
    })
  })

  it('propagates logging_failed metadata when sendSMS throws', async () => {
    ;(sendSMS as unknown as vi.Mock).mockRejectedValueOnce({
      message: 'message persistence unavailable',
      code: 'logging_failed',
      logFailure: false,
    })

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

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await sendTableBookingCreatedSmsIfAllowed(supabase as any, {
      customerId: 'customer-1',
      normalizedPhone: '+447700900123',
      bookingResult: {
        state: 'pending_card_capture',
        status: 'pending_card_capture',
        table_booking_id: 'table-booking-1',
        start_datetime: '2026-03-01T12:00:00.000Z',
        party_size: 2,
      } as any,
      nextStepUrl: 'https://example.com/card',
    })

    expect(result.sms).toEqual({
      success: false,
      code: 'logging_failed',
      logFailure: true,
    })
    expect(warn).toHaveBeenCalledWith(
      'Table booking created SMS threw unexpectedly',
      expect.objectContaining({
        metadata: expect.objectContaining({
          code: 'logging_failed',
          logFailure: true,
        }),
      })
    )
  })
})
