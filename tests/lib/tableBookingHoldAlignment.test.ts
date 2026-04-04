import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
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

import { alignTablePaymentHoldToScheduledSend } from '@/lib/table-bookings/bookings'

// Updated: function was renamed from alignTableCardCaptureHoldToScheduledSend
// and now only updates table_bookings + booking_holds (card_captures removed).
// It no longer logs warnings — it just throws with failure details.
describe('alignTablePaymentHoldToScheduledSend reliability guards', () => {
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

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const alignmentPromise = alignTablePaymentHoldToScheduledSend(supabase as any, {
      tableBookingId: 'booking-1',
      scheduledSendIso: '2026-02-14T12:00:00.000Z',
    })

    await expect(alignmentPromise).rejects.toThrow(
      'Failed to align table payment hold state to scheduled SMS send time'
    )
    const alignmentError = await alignmentPromise.catch((error: unknown) => error as Error)
    expect(alignmentError.message).toContain('table_bookings_update_failed')
    expect(alignmentError.message).toContain('booking_holds_update_failed')
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

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const alignmentPromise = alignTablePaymentHoldToScheduledSend(supabase as any, {
      tableBookingId: 'booking-1',
      scheduledSendIso: '2026-02-14T12:00:00.000Z',
    })

    await expect(alignmentPromise).rejects.toThrow(
      'Failed to align table payment hold state to scheduled SMS send time'
    )
    const alignmentError = await alignmentPromise.catch((error: unknown) => error as Error)
    expect(alignmentError.message).toContain('table_bookings_update_no_rows')
    expect(alignmentError.message).toContain('booking_holds_update_no_rows')
  })
})
