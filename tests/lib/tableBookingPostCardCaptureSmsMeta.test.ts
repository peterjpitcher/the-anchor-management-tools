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

vi.mock('@/lib/table-bookings/manage-booking', () => ({
  createTableManageToken: vi.fn().mockResolvedValue({ url: 'https://example.com/manage' }),
}))

vi.mock('@/lib/table-bookings/sunday-preorder', () => ({
  createSundayPreorderToken: vi.fn().mockResolvedValue({ url: 'https://example.com/preorder' }),
}))

import { sendSMS } from '@/lib/twilio'
import { sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed } from '@/lib/table-bookings/bookings'

describe('table booking post-card-capture SMS safety meta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('propagates thrown idempotency_conflict metadata from sendSMS', async () => {
    ;(sendSMS as unknown as vi.Mock).mockRejectedValueOnce({
      message: 'idempotency lock conflict',
      code: 'idempotency_conflict',
      logFailure: false,
    })

    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'table-booking-1',
        customer_id: 'customer-1',
        party_size: 2,
        booking_date: '2026-03-01',
        booking_time: '12:00',
        start_datetime: '2026-03-01T12:00:00.000Z',
        status: 'confirmed',
        booking_type: 'standard',
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

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: bookingSelect }
        }
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed(
      supabase as any,
      'table-booking-1'
    )

    expect(result).toEqual({
      success: false,
      code: 'idempotency_conflict',
      logFailure: false,
    })
    expect(warn).toHaveBeenCalledWith(
      'Table booking post-card-capture SMS threw unexpectedly',
      expect.objectContaining({
        metadata: expect.objectContaining({
          code: 'idempotency_conflict',
          logFailure: false,
        }),
      })
    )
  })
})
