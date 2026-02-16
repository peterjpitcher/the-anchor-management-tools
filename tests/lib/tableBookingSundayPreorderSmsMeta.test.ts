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

vi.mock('@/lib/table-bookings/sunday-preorder', () => ({
  createSundayPreorderToken: vi.fn().mockResolvedValue({ url: 'https://example.com/preorder' }),
}))

import { sendSMS } from '@/lib/twilio'
import { sendSundayPreorderLinkSmsIfAllowed } from '@/lib/table-bookings/bookings'

describe('Sunday pre-order SMS safety meta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    const result = await sendSundayPreorderLinkSmsIfAllowed(supabase as any, {
      customerId: 'customer-1',
      tableBookingId: 'table-booking-1',
      bookingStartIso: '2026-03-01T12:00:00.000Z',
      bookingReference: 'ABCD1234',
      appBaseUrl: 'https://example.com',
    })

    expect(result).toEqual({
      sent: true,
      scheduledFor: '2026-03-01T10:00:00.000Z',
      url: 'https://example.com/preorder',
      sms: {
        success: true,
        code: 'logging_failed',
        logFailure: true,
      },
    })
    expect(error).toHaveBeenCalledWith(
      'Sunday pre-order link SMS sent but outbound message logging failed',
      expect.any(Object)
    )
  })

  it('propagates thrown idempotency_conflict metadata from sendSMS', async () => {
    ;(sendSMS as unknown as vi.Mock).mockRejectedValueOnce({
      message: 'idempotency lock conflict',
      code: 'idempotency_conflict',
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

    const result = await sendSundayPreorderLinkSmsIfAllowed(supabase as any, {
      customerId: 'customer-1',
      tableBookingId: 'table-booking-1',
      bookingStartIso: '2026-03-01T12:00:00.000Z',
      bookingReference: 'ABCD1234',
      appBaseUrl: 'https://example.com',
    })

    expect(result).toEqual({
      sent: false,
      url: 'https://example.com/preorder',
      sms: {
        success: false,
        code: 'idempotency_conflict',
        logFailure: false,
      },
    })
    expect(warn).toHaveBeenCalledWith(
      'Sunday pre-order link SMS threw unexpectedly',
      expect.objectContaining({
        metadata: expect.objectContaining({
          code: 'idempotency_conflict',
          logFailure: false,
        }),
      })
    )
  })
})
