import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/services/sms-queue', () => ({
  SmsQueueService: {
    queueAndSend: vi.fn(),
  },
}))

vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))

import { createClient } from '@/lib/supabase/server'
import { SmsQueueService } from '@/services/sms-queue'
import { PrivateBookingService } from '@/services/private-bookings'

const mockedCreateClient = createClient as unknown as Mock

describe('PrivateBookingService SMS side-effect meta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updateBooking aborts additional SMS side-effects after a fatal logging_failed safety signal', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        status: 'draft',
        contact_phone: '+447700900123',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        event_date: '2026-03-10',
        start_time: '18:00',
        setup_date: null,
        setup_time: null,
        end_time: '22:00',
        end_time_next_day: false,
        customer_id: null,
        internal_notes: null,
        balance_due_date: null,
        calendar_event_id: null,
        hold_expiry: null,
        deposit_paid_date: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })
    const fetchSelect = vi.fn().mockReturnValue({ eq: fetchEq })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        status: 'confirmed',
        contact_phone: '+447700900123',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        event_date: '2026-03-10',
        start_time: '18:00',
        setup_date: null,
        setup_time: '10:00',
        end_time: '22:00',
        end_time_next_day: false,
        customer_id: null,
        internal_notes: null,
        balance_due_date: null,
        calendar_event_id: null,
        hold_expiry: null,
        deposit_paid_date: null,
        event_type: 'party',
      },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: fetchSelect,
          update,
        }
      }),
    })

    ;(SmsQueueService.queueAndSend as unknown as Mock).mockResolvedValue({
      success: true,
      queueId: 'queue-setup-1',
      sent: true,
      code: 'logging_failed',
      logFailure: true,
    })

    const result: any = await PrivateBookingService.updateBooking(
      'booking-1',
      { status: 'confirmed', setup_time: '10:00' },
      'user-1'
    )

    expect(SmsQueueService.queueAndSend).toHaveBeenCalledTimes(1)
    expect((SmsQueueService.queueAndSend as unknown as Mock).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        trigger_type: 'setup_reminder',
        template_key: 'private_booking_setup_reminder',
      })
    )

    expect(result?.smsSideEffects).toEqual([
      expect.objectContaining({
        triggerType: 'setup_reminder',
        templateKey: 'private_booking_setup_reminder',
        queueId: 'queue-setup-1',
        sent: true,
        code: 'logging_failed',
        logFailure: true,
      }),
    ])
  })

  it('recordDeposit returns smsSideEffects when queueAndSend reports logging_failed', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        event_date: '2026-02-20',
        start_time: '18:00',
        end_time: '22:00',
        end_time_next_day: false,
        contact_phone: '+447700900123',
        customer_id: null,
        calendar_event_id: null,
        status: 'draft',
        guest_count: 30,
        event_type: 'party',
        deposit_paid_date: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })
    const fetchSelect = vi.fn().mockReturnValue({ eq: fetchEq })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'booking-1' },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: fetchSelect,
          update,
        }
      }),
    })

    ;(SmsQueueService.queueAndSend as unknown as Mock).mockResolvedValue({
      success: true,
      queueId: 'queue-1',
      sent: true,
      code: 'logging_failed',
      logFailure: true,
    })

    const result = await PrivateBookingService.recordDeposit('booking-1', 100, 'card', 'user-1')

    expect(result).toMatchObject({ success: true })
    expect((result as any).smsSideEffects).toEqual([
      expect.objectContaining({
        triggerType: 'deposit_received',
        templateKey: 'private_booking_deposit_received',
        queueId: 'queue-1',
        sent: true,
        code: 'logging_failed',
        logFailure: true,
      }),
    ])
  })

  it('recordFinalPayment returns smsSideEffects when queueAndSend returns an error result', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        event_date: '2026-02-20',
        start_time: '18:00',
        end_time: '22:00',
        end_time_next_day: false,
        contact_phone: '+447700900123',
        customer_id: null,
        calendar_event_id: null,
        status: 'confirmed',
        guest_count: 30,
        event_type: 'party',
        deposit_paid_date: '2026-01-10T12:00:00.000Z',
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })
    const fetchSelect = vi.fn().mockReturnValue({ eq: fetchEq })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'booking-1' },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: fetchSelect,
          update,
        }
      }),
    })

    ;(SmsQueueService.queueAndSend as unknown as Mock).mockResolvedValue({
      error: 'SMS blocked by idempotency safety guard',
      code: 'idempotency_conflict',
      logFailure: false,
    })

    const result = await PrivateBookingService.recordFinalPayment('booking-1', 'bank_transfer', 'user-1')

    expect(result).toMatchObject({ success: true })
    expect((result as any).smsSideEffects).toEqual([
      expect.objectContaining({
        triggerType: 'final_payment_received',
        templateKey: 'private_booking_final_payment',
        sent: false,
        code: 'idempotency_conflict',
        logFailure: false,
        error: 'SMS blocked by idempotency safety guard',
      }),
    ])
  })

  it('cancelBooking returns smsSideEffects when queueAndSend throws', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        status: 'confirmed',
        event_date: '2026-02-20',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        contact_phone: '+447700900123',
        calendar_event_id: null,
        customer_id: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })
    const fetchSelect = vi.fn().mockReturnValue({ eq: fetchEq })

    const cancelMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'booking-1' }, error: null })
    const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
    const cancelEq = vi.fn().mockReturnValue({ select: cancelSelect })
    const update = vi.fn().mockReturnValue({ eq: cancelEq })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: fetchSelect,
          update,
        }
      }),
    })

    ;(SmsQueueService.queueAndSend as unknown as Mock).mockRejectedValue(new Error('queue insert failed'))

    const result = await PrivateBookingService.cancelBooking('booking-1', 'Customer requested', 'user-1')

    expect(result).toMatchObject({ success: true })
    expect((result as any).smsSideEffects).toEqual([
      expect.objectContaining({
        triggerType: 'booking_cancelled',
        templateKey: 'private_booking_cancelled',
        error: 'queue insert failed',
      }),
    ])
  })
})
