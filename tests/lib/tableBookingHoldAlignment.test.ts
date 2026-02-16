import { beforeEach, describe, expect, it, vi } from 'vitest'

const { warn } = vi.hoisted(() => ({
  warn: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn,
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/guest/tokens', () => ({
  createGuestToken: vi.fn(),
  hashGuestToken: vi.fn(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((value: string) => value),
}))

vi.mock('@/lib/table-bookings/manage-booking', () => ({
  createTableManageToken: vi.fn(),
}))

vi.mock('@/lib/table-bookings/sunday-preorder', () => ({
  createSundayPreorderToken: vi.fn(),
}))

import { alignTableCardCaptureHoldToScheduledSend } from '@/lib/table-bookings/bookings'

describe('alignTableCardCaptureHoldToScheduledSend reliability guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed when Supabase alignment updates resolve with errors', async () => {
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'booking write failed' },
    })
    const bookingSelect = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingEqStatus = vi.fn().mockReturnValue({ select: bookingSelect })
    const bookingEqId = vi.fn().mockReturnValue({ eq: bookingEqStatus })

    const holdSelect = vi.fn().mockResolvedValue({
      data: [],
      error: { message: 'hold write failed' },
    })
    const holdEqStatus = vi.fn().mockReturnValue({ select: holdSelect })
    const holdEqType = vi.fn().mockReturnValue({ eq: holdEqStatus })
    const holdEqBooking = vi.fn().mockReturnValue({ eq: holdEqType })

    const captureSelect = vi.fn().mockResolvedValue({
      data: [],
      error: { message: 'capture write failed' },
    })
    const captureEqStatus = vi.fn().mockReturnValue({ select: captureSelect })
    const captureEqBooking = vi.fn().mockReturnValue({ eq: captureEqStatus })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return {
            update: vi.fn().mockReturnValue({ eq: bookingEqId }),
          }
        }

        if (table === 'booking_holds') {
          return {
            update: vi.fn().mockReturnValue({ eq: holdEqBooking }),
          }
        }

        if (table === 'card_captures') {
          return {
            update: vi.fn().mockReturnValue({ eq: captureEqBooking }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const alignmentPromise = alignTableCardCaptureHoldToScheduledSend(supabase as any, {
      tableBookingId: 'booking-1',
      scheduledSendIso: '2026-02-14T12:00:00.000Z',
    })

    await expect(alignmentPromise).rejects.toThrow(
      'Failed to align table card-capture hold state to scheduled SMS send time'
    )
    const alignmentError = await alignmentPromise.catch((error: unknown) => error as Error)
    expect(alignmentError.message).toContain('table_bookings_update_failed')

    expect(warn).toHaveBeenCalledWith(
      'Failed to align table booking hold expiry to deferred card-capture SMS send time',
      expect.any(Object)
    )
    expect(warn).toHaveBeenCalledWith(
      'Failed to align booking-hold expiry to deferred card-capture SMS send time',
      expect.any(Object)
    )
    expect(warn).toHaveBeenCalledWith(
      'Failed to align card-capture expiry to deferred card-capture SMS send time',
      expect.any(Object)
    )
  })

  it('fails closed when alignment updates affect no rows', async () => {
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const bookingSelect = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingEqStatus = vi.fn().mockReturnValue({ select: bookingSelect })
    const bookingEqId = vi.fn().mockReturnValue({ eq: bookingEqStatus })

    const holdSelect = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const holdEqStatus = vi.fn().mockReturnValue({ select: holdSelect })
    const holdEqType = vi.fn().mockReturnValue({ eq: holdEqStatus })
    const holdEqBooking = vi.fn().mockReturnValue({ eq: holdEqType })

    const captureSelect = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const captureEqStatus = vi.fn().mockReturnValue({ select: captureSelect })
    const captureEqBooking = vi.fn().mockReturnValue({ eq: captureEqStatus })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return {
            update: vi.fn().mockReturnValue({ eq: bookingEqId }),
          }
        }

        if (table === 'booking_holds') {
          return {
            update: vi.fn().mockReturnValue({ eq: holdEqBooking }),
          }
        }

        if (table === 'card_captures') {
          return {
            update: vi.fn().mockReturnValue({ eq: captureEqBooking }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const alignmentPromise = alignTableCardCaptureHoldToScheduledSend(supabase as any, {
      tableBookingId: 'booking-1',
      scheduledSendIso: '2026-02-14T12:00:00.000Z',
    })

    await expect(alignmentPromise).rejects.toThrow(
      'Failed to align table card-capture hold state to scheduled SMS send time'
    )
    const alignmentError = await alignmentPromise.catch((error: unknown) => error as Error)
    expect(alignmentError.message).toContain('table_bookings_update_no_rows')

    expect(warn).toHaveBeenCalledWith(
      'Table booking hold-expiry alignment affected no rows',
      expect.any(Object)
    )
    expect(warn).toHaveBeenCalledWith(
      'Booking-hold expiry alignment affected no rows',
      expect.any(Object)
    )
    expect(warn).toHaveBeenCalledWith(
      'Card-capture expiry alignment affected no rows',
      expect.any(Object)
    )
  })
})
