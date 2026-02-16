import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerError, loggerWarn } = vi.hoisted(() => ({
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: loggerError,
    warn: loggerWarn,
    info: vi.fn(),
  },
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

import { submitPrivateBookingFeedbackByRawToken } from '@/lib/private-bookings/feedback'

describe('private-booking feedback mutation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs rollback no-row drift when feedback insert fails after token consumption', async () => {
    const tokenLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'token-1',
        customer_id: 'customer-1',
        private_booking_id: 'private-booking-1',
        expires_at: '2099-01-01T00:00:00.000Z',
        consumed_at: null,
      },
      error: null,
    })
    const tokenLookupEqAction = vi.fn().mockReturnValue({ maybeSingle: tokenLookupMaybeSingle })
    const tokenLookupEqHash = vi.fn().mockReturnValue({ eq: tokenLookupEqAction })
    const tokenSelect = vi.fn().mockReturnValue({ eq: tokenLookupEqHash })

    const consumeMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'token-1' },
      error: null,
    })
    const consumeSelect = vi.fn().mockReturnValue({ maybeSingle: consumeMaybeSingle })
    const consumeIs = vi.fn().mockReturnValue({ select: consumeSelect })
    const consumeEq = vi.fn().mockReturnValue({ is: consumeIs })

    const rollbackMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const rollbackSelect = vi.fn().mockReturnValue({ maybeSingle: rollbackMaybeSingle })
    const rollbackEqConsumedAt = vi.fn().mockReturnValue({ select: rollbackSelect })
    const rollbackEqId = vi.fn().mockReturnValue({ eq: rollbackEqConsumedAt })

    const tokenUpdate = vi
      .fn()
      .mockReturnValueOnce({ eq: consumeEq })
      .mockReturnValueOnce({ eq: rollbackEqId })

    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'private-booking-1',
        customer_id: 'customer-1',
        customer_first_name: 'Alex',
        customer_last_name: 'Stone',
        customer_name: 'Alex Stone',
        event_date: '2099-01-10',
        start_time: '18:00:00',
        status: 'confirmed',
        guest_count: 8,
      },
      error: null,
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    const feedbackContextMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const feedbackContextLimit = vi.fn().mockReturnValue({ maybeSingle: feedbackContextMaybeSingle })
    const feedbackContextOrder = vi.fn().mockReturnValue({ limit: feedbackContextLimit })
    const feedbackContextEq = vi.fn().mockReturnValue({ order: feedbackContextOrder })
    const feedbackSelect = vi.fn().mockReturnValue({ eq: feedbackContextEq })

    const feedbackInsertMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'feedback insert failed' },
    })
    const feedbackInsertSelect = vi.fn().mockReturnValue({ maybeSingle: feedbackInsertMaybeSingle })
    const feedbackInsert = vi.fn().mockReturnValue({ select: feedbackInsertSelect })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'guest_tokens') {
          return {
            select: tokenSelect,
            update: tokenUpdate,
          }
        }

        if (table === 'private_bookings') {
          return { select: bookingSelect }
        }

        if (table === 'feedback') {
          return {
            select: feedbackSelect,
            insert: feedbackInsert,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await expect(
      submitPrivateBookingFeedbackByRawToken(supabase as any, {
        rawToken: 'raw-token',
        ratingOverall: 5,
      })
    ).rejects.toEqual(expect.objectContaining({ message: 'feedback insert failed' }))

    expect(loggerError).toHaveBeenCalledWith(
      'Private-feedback token rollback affected no rows after insert failure',
      expect.any(Object)
    )
  })
})

