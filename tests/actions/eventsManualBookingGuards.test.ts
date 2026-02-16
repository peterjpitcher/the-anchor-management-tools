import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/services/events', () => ({
  EventService: {},
  eventSchema: {},
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn(),
  updateEventBookingSeatsById: vi.fn(),
}))

vi.mock('@/lib/events/event-payments', () => ({
  createEventPaymentToken: vi.fn(),
  sendEventBookingSeatUpdateSms: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
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

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { cancelEventManualBooking, createEventManualBooking, updateEventManualBookingSeats } from '@/app/actions/events'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { createEventManageToken, updateEventBookingSeatsById } from '@/lib/events/manage-booking'
import { sendEventBookingSeatUpdateSms } from '@/lib/events/event-payments'
import { sendSMS } from '@/lib/twilio'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedEnsureCustomerForPhone = ensureCustomerForPhone as unknown as Mock
const mockedCreateEventManageToken = createEventManageToken as unknown as Mock
const mockedUpdateEventBookingSeatsById = updateEventBookingSeatsById as unknown as Mock
const mockedSendEventBookingSeatUpdateSms = sendEventBookingSeatUpdateSms as unknown as Mock

describe('Event manual booking seat-update guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
  })

  it('surfaces table sync failures via meta and propagates SMS safety meta', async () => {
    const bookingId = '550e8400-e29b-41d4-a716-446655440200'

    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: bookingId, event_id: '550e8400-e29b-41d4-a716-446655440201' },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const tableSyncSelect = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'db_down' },
    })
    const tableSyncNot = vi.fn().mockReturnValue({ select: tableSyncSelect })
    const tableSyncEq = vi.fn().mockReturnValue({ not: tableSyncNot })
    const tableSyncUpdate = vi.fn().mockReturnValue({ eq: tableSyncEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return { select: loadSelect }
        }

        if (table === 'table_bookings') {
          return { update: tableSyncUpdate }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    mockedUpdateEventBookingSeatsById.mockResolvedValue({
      state: 'updated',
      reason: null,
      booking_id: bookingId,
      customer_id: 'customer-1',
      event_name: 'Test Event',
      old_seats: 2,
      new_seats: 3,
      delta: 1,
    })

    mockedSendEventBookingSeatUpdateSms.mockResolvedValue({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    })

    const result = await updateEventManualBookingSeats({
      bookingId,
      seats: 3,
      sendSms: true,
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        state: 'updated',
        booking_id: bookingId,
        old_seats: 2,
        new_seats: 3,
        delta: 1,
        sms_sent: true,
      },
      meta: {
        sms: {
          success: true,
          code: 'logging_failed',
          logFailure: true,
        },
        table_booking_sync: {
          success: false,
          error: 'db_down',
        },
      },
    })

    expect(error).toHaveBeenCalledWith(
      'Failed to sync linked table booking party size after event booking seat update',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId,
          error: 'db_down',
        }),
      })
    )
  })

  it('treats logging_failed as sent when seat-update SMS helper reports non-success', async () => {
    const bookingId = '550e8400-e29b-41d4-a716-446655440230'

    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: bookingId, event_id: '550e8400-e29b-41d4-a716-446655440231' },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const tableSyncSelect = vi.fn().mockResolvedValue({
      data: [{ id: 'tb-1' }],
      error: null,
    })
    const tableSyncNot = vi.fn().mockReturnValue({ select: tableSyncSelect })
    const tableSyncEq = vi.fn().mockReturnValue({ not: tableSyncNot })
    const tableSyncUpdate = vi.fn().mockReturnValue({ eq: tableSyncEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return { select: loadSelect }
        }

        if (table === 'table_bookings') {
          return { update: tableSyncUpdate }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    mockedUpdateEventBookingSeatsById.mockResolvedValue({
      state: 'updated',
      reason: null,
      booking_id: bookingId,
      customer_id: 'customer-1',
      event_name: 'Test Event',
      old_seats: 2,
      new_seats: 3,
      delta: 1,
    })

    mockedSendEventBookingSeatUpdateSms.mockResolvedValue({
      success: false,
      code: 'logging_failed',
      logFailure: true,
    })

    const result = await updateEventManualBookingSeats({
      bookingId,
      seats: 3,
      sendSms: true,
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        state: 'updated',
        booking_id: bookingId,
        sms_sent: true,
      },
      meta: {
        sms: {
          success: true,
          code: 'logging_failed',
          logFailure: true,
        },
      },
    })
  })

  it('surfaces table sync verification failures when zero-row updates leave active linked table bookings', async () => {
    const bookingId = '550e8400-e29b-41d4-a716-446655440260'

    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: bookingId, event_id: '550e8400-e29b-41d4-a716-446655440261' },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const tableSyncSelect = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const tableSyncNot = vi.fn().mockReturnValue({ select: tableSyncSelect })
    const tableSyncEq = vi.fn().mockReturnValue({ not: tableSyncNot })
    const tableSyncUpdate = vi.fn().mockReturnValue({ eq: tableSyncEq })

    const tableVerificationNot = vi.fn().mockResolvedValue({ data: [{ id: 'tb-stale' }], error: null })
    const tableVerificationEq = vi.fn().mockReturnValue({ not: tableVerificationNot })
    const tableVerificationSelect = vi.fn().mockReturnValue({ eq: tableVerificationEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return { select: loadSelect }
        }

        if (table === 'table_bookings') {
          return {
            update: tableSyncUpdate,
            select: tableVerificationSelect,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    mockedUpdateEventBookingSeatsById.mockResolvedValue({
      state: 'updated',
      reason: null,
      booking_id: bookingId,
      customer_id: 'customer-1',
      event_name: 'Test Event',
      old_seats: 2,
      new_seats: 3,
      delta: 1,
    })

    const result = await updateEventManualBookingSeats({
      bookingId,
      seats: 3,
      sendSms: false,
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        state: 'updated',
        booking_id: bookingId,
      },
      meta: {
        table_booking_sync: {
          success: false,
          error: 'active_rows_remaining:1',
        },
      },
    })
    expect(tableVerificationSelect).toHaveBeenCalledWith('id')
    expect(error).toHaveBeenCalledWith(
      'Failed to sync linked table booking party size after event booking seat update',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId,
          error: 'active_rows_remaining:1',
        }),
      })
    )
  })
})

describe('Event manual booking cancellation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
  })

  it('returns booking-not-found when cancellation update affects no rows', async () => {
    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440002',
        event_id: '550e8400-e29b-41d4-a716-446655440003',
        customer_id: null,
        seats: 4,
        status: 'confirmed',
        is_reminder_only: false,
        event: null,
        customer: null,
      },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })

    const cancelMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
    const cancelEq = vi.fn().mockReturnValue({ select: cancelSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: loadEq }),
          update: vi.fn().mockReturnValue({ eq: cancelEq }),
        }
      }),
    })

    const result = await cancelEventManualBooking({
      bookingId: '550e8400-e29b-41d4-a716-446655440002',
      sendSms: false,
    })

    expect(result).toEqual({ error: 'Booking not found.' })
  })

  it('fails closed when booking-hold release update errors', async () => {
    const bookingId = '550e8400-e29b-41d4-a716-446655440012'

    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: bookingId,
        event_id: '550e8400-e29b-41d4-a716-446655440013',
        customer_id: null,
        seats: 2,
        status: 'confirmed',
        is_reminder_only: false,
        event: null,
        customer: null,
      },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const cancelMaybeSingle = vi.fn().mockResolvedValue({ data: { id: bookingId }, error: null })
    const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
    const cancelEq = vi.fn().mockReturnValue({ select: cancelSelect })
    const cancelUpdate = vi.fn().mockReturnValue({ eq: cancelEq })

    const holdSelect = vi.fn().mockResolvedValue({ data: null, error: { message: 'db_down' } })
    const holdEq2 = vi.fn().mockReturnValue({ select: holdSelect })
    const holdEq1 = vi.fn().mockReturnValue({ eq: holdEq2 })
    const holdUpdate = vi.fn().mockReturnValue({ eq: holdEq1 })

    const tableSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    const tableNot = vi.fn().mockReturnValue({ select: tableSelect })
    const tableEq = vi.fn().mockReturnValue({ not: tableNot })
    const tableUpdate = vi.fn().mockReturnValue({ eq: tableEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return {
            select: loadSelect,
            update: cancelUpdate,
          }
        }

        if (table === 'booking_holds') {
          return { update: holdUpdate }
        }

        if (table === 'table_bookings') {
          return { update: tableUpdate }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await cancelEventManualBooking({
      bookingId,
      sendSms: false,
    })

    expect(result).toEqual({
      error:
        'Booking cancelled but failed to release booking holds. Please refresh and contact engineering.',
    })
  })

  it('fails closed when linked table booking cancellation update errors', async () => {
    const bookingId = '550e8400-e29b-41d4-a716-446655440014'

    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: bookingId,
        event_id: '550e8400-e29b-41d4-a716-446655440015',
        customer_id: null,
        seats: 2,
        status: 'confirmed',
        is_reminder_only: false,
        event: null,
        customer: null,
      },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const cancelMaybeSingle = vi.fn().mockResolvedValue({ data: { id: bookingId }, error: null })
    const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
    const cancelEq = vi.fn().mockReturnValue({ select: cancelSelect })
    const cancelUpdate = vi.fn().mockReturnValue({ eq: cancelEq })

    const holdSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    const holdEq2 = vi.fn().mockReturnValue({ select: holdSelect })
    const holdEq1 = vi.fn().mockReturnValue({ eq: holdEq2 })
    const holdUpdate = vi.fn().mockReturnValue({ eq: holdEq1 })

    const tableSelect = vi.fn().mockResolvedValue({ data: null, error: { message: 'db_down' } })
    const tableNot = vi.fn().mockReturnValue({ select: tableSelect })
    const tableEq = vi.fn().mockReturnValue({ not: tableNot })
    const tableUpdate = vi.fn().mockReturnValue({ eq: tableEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return {
            select: loadSelect,
            update: cancelUpdate,
          }
        }

        if (table === 'booking_holds') {
          return { update: holdUpdate }
        }

        if (table === 'table_bookings') {
          return { update: tableUpdate }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await cancelEventManualBooking({
      bookingId,
      sendSms: false,
    })

    expect(result).toEqual({
      error:
        'Booking cancelled but failed to cancel linked table bookings. Please refresh and contact engineering.',
    })
  })

  it('fails closed when linked table booking cancellation leaves active rows after a zero-row update', async () => {
    const bookingId = '550e8400-e29b-41d4-a716-446655440016'

    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: bookingId,
        event_id: '550e8400-e29b-41d4-a716-446655440017',
        customer_id: null,
        seats: 2,
        status: 'confirmed',
        is_reminder_only: false,
        event: null,
        customer: null,
      },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const cancelMaybeSingle = vi.fn().mockResolvedValue({ data: { id: bookingId }, error: null })
    const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
    const cancelEq = vi.fn().mockReturnValue({ select: cancelSelect })
    const cancelUpdate = vi.fn().mockReturnValue({ eq: cancelEq })

    const holdSelect = vi.fn().mockResolvedValue({ data: [{ id: 'hold-1' }], error: null })
    const holdEq2 = vi.fn().mockReturnValue({ select: holdSelect })
    const holdEq1 = vi.fn().mockReturnValue({ eq: holdEq2 })
    const holdUpdate = vi.fn().mockReturnValue({ eq: holdEq1 })

    const tableSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    const tableNot = vi.fn().mockReturnValue({ select: tableSelect })
    const tableEq = vi.fn().mockReturnValue({ not: tableNot })
    const tableUpdate = vi.fn().mockReturnValue({ eq: tableEq })

    const tableVerificationNot = vi.fn().mockResolvedValue({ data: [{ id: 'tb-stale' }], error: null })
    const tableVerificationEq = vi.fn().mockReturnValue({ not: tableVerificationNot })
    const tableVerificationSelect = vi.fn().mockReturnValue({ eq: tableVerificationEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return {
            select: loadSelect,
            update: cancelUpdate,
          }
        }

        if (table === 'booking_holds') {
          return { update: holdUpdate }
        }

        if (table === 'table_bookings') {
          return {
            update: tableUpdate,
            select: tableVerificationSelect,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await cancelEventManualBooking({
      bookingId,
      sendSms: false,
    })

    expect(result).toEqual({
      error:
        'Booking cancelled but failed to cancel linked table bookings. Please refresh and contact engineering.',
    })
    expect(warn).toHaveBeenCalledWith(
      'Event booking cancellation follow-up updates failed',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId,
          failures: ['table_bookings_cancel'],
          tableBookingCancelVerification: 'active_rows_remaining',
          tableBookingCancelRemainingCount: 1,
        }),
      })
    )
  })

  it('surfaces logging_failed SMS meta on successful cancellation without failing the action', async () => {
    const bookingId = '550e8400-e29b-41d4-a716-446655440020'
    const eventId = '550e8400-e29b-41d4-a716-446655440021'
    const customerId = '550e8400-e29b-41d4-a716-446655440022'

    ;(sendSMS as unknown as Mock).mockResolvedValueOnce({
      success: true,
      sid: 'SM1',
      code: 'logging_failed',
      logFailure: true,
    })

    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: bookingId,
        event_id: eventId,
        customer_id: customerId,
        seats: 2,
        status: 'confirmed',
        is_reminder_only: false,
        event: {
          id: eventId,
          name: 'Test Event',
          start_datetime: '2026-03-01T12:00:00.000Z',
          date: '2026-03-01',
          time: '12:00:00',
        },
        customer: {
          id: customerId,
          first_name: 'Pat',
          mobile_number: '+447700900123',
          sms_status: 'active',
        },
      },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const cancelMaybeSingle = vi.fn().mockResolvedValue({ data: { id: bookingId }, error: null })
    const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
    const cancelEq = vi.fn().mockReturnValue({ select: cancelSelect })
    const cancelUpdate = vi.fn().mockReturnValue({ eq: cancelEq })

    const holdSelect = vi.fn().mockResolvedValue({ data: [{ id: 'hold-1' }], error: null })
    const holdEq2 = vi.fn().mockReturnValue({ select: holdSelect })
    const holdEq1 = vi.fn().mockReturnValue({ eq: holdEq2 })
    const holdUpdate = vi.fn().mockReturnValue({ eq: holdEq1 })

    const tableSelect = vi.fn().mockResolvedValue({ data: [{ id: 'tb-1' }], error: null })
    const tableNot = vi.fn().mockReturnValue({ select: tableSelect })
    const tableEq = vi.fn().mockReturnValue({ not: tableNot })
    const tableUpdate = vi.fn().mockReturnValue({ eq: tableEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return {
            select: loadSelect,
            update: cancelUpdate,
          }
        }

        if (table === 'booking_holds') {
          return { update: holdUpdate }
        }

        if (table === 'table_bookings') {
          return { update: tableUpdate }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await cancelEventManualBooking({
      bookingId,
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        state: 'cancelled',
        booking_id: bookingId,
        sms_sent: true,
      },
      meta: {
        sms: {
          success: true,
          code: 'logging_failed',
          logFailure: true,
        },
      },
    })
    expect(error).toHaveBeenCalledWith(
      'Event booking cancellation SMS sent but outbound message logging failed',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId,
          customerId,
          code: 'logging_failed',
          logFailure: true,
        }),
      })
    )
  })

  it('treats logging_failed as sent when cancellation SMS returns non-success', async () => {
    const bookingId = '550e8400-e29b-41d4-a716-446655440240'
    const eventId = '550e8400-e29b-41d4-a716-446655440241'
    const customerId = '550e8400-e29b-41d4-a716-446655440242'

    ;(sendSMS as unknown as Mock).mockResolvedValueOnce({
      success: false,
      sid: 'SM2',
      code: 'logging_failed',
      logFailure: true,
      error: 'DB insert failed',
    })

    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: bookingId,
        event_id: eventId,
        customer_id: customerId,
        seats: 2,
        status: 'confirmed',
        is_reminder_only: false,
        event: {
          id: eventId,
          name: 'Test Event',
          start_datetime: '2026-03-01T12:00:00.000Z',
          date: '2026-03-01',
          time: '12:00:00',
        },
        customer: {
          id: customerId,
          first_name: 'Pat',
          mobile_number: '+447700900123',
          sms_status: 'active',
        },
      },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })
    const loadSelect = vi.fn().mockReturnValue({ eq: loadEq })

    const cancelMaybeSingle = vi.fn().mockResolvedValue({ data: { id: bookingId }, error: null })
    const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
    const cancelEq = vi.fn().mockReturnValue({ select: cancelSelect })
    const cancelUpdate = vi.fn().mockReturnValue({ eq: cancelEq })

    const holdSelect = vi.fn().mockResolvedValue({ data: [{ id: 'hold-1' }], error: null })
    const holdEq2 = vi.fn().mockReturnValue({ select: holdSelect })
    const holdEq1 = vi.fn().mockReturnValue({ eq: holdEq2 })
    const holdUpdate = vi.fn().mockReturnValue({ eq: holdEq1 })

    const tableSelect = vi.fn().mockResolvedValue({ data: [{ id: 'tb-1' }], error: null })
    const tableNot = vi.fn().mockReturnValue({ select: tableSelect })
    const tableEq = vi.fn().mockReturnValue({ not: tableNot })
    const tableUpdate = vi.fn().mockReturnValue({ eq: tableEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return {
            select: loadSelect,
            update: cancelUpdate,
          }
        }

        if (table === 'booking_holds') {
          return { update: holdUpdate }
        }

        if (table === 'table_bookings') {
          return { update: tableUpdate }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await cancelEventManualBooking({
      bookingId,
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        state: 'cancelled',
        booking_id: bookingId,
        sms_sent: true,
      },
      meta: {
        sms: {
          success: true,
          code: 'logging_failed',
          logFailure: true,
        },
      },
    })
  })
})

describe('Event manual booking creation SMS safety guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedEnsureCustomerForPhone.mockResolvedValue({
      customerId: '550e8400-e29b-41d4-a716-446655440251',
      resolutionError: undefined,
    })
  })

  it('treats logging_failed as sent when creation SMS returns non-success', async () => {
    const eventId = '550e8400-e29b-41d4-a716-446655440250'
    const bookingId = '550e8400-e29b-41d4-a716-446655440252'
    const customerId = '550e8400-e29b-41d4-a716-446655440251'

    ;(sendSMS as unknown as Mock).mockResolvedValueOnce({
      success: false,
      sid: 'SM3',
      code: 'logging_failed',
      logFailure: true,
      error: 'DB insert failed',
    })

    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: eventId, name: 'Test Event', booking_mode: 'general' },
      error: null,
    })
    const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
    const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

    const rpc = vi.fn(async (fnName: string) => {
      if (fnName === 'create_event_booking_v05') {
        return {
          data: {
            state: 'confirmed',
            booking_id: bookingId,
            event_start_datetime: null,
            payment_mode: 'free',
          },
          error: null,
        }
      }
      throw new Error(`Unexpected rpc: ${fnName}`)
    })

    mockedCreateAdminClient.mockReturnValue({
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return { select: eventSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await createEventManualBooking({
      eventId,
      phone: '+447700900250',
      seats: 2,
      firstName: 'Pat',
      lastName: 'Test',
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        state: 'confirmed',
        booking_id: bookingId,
      },
      meta: {
        sms: {
          success: true,
          code: 'logging_failed',
          logFailure: true,
        },
      },
    })

    expect(error).toHaveBeenCalledWith(
      'Event manual booking SMS sent but outbound message logging failed',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId,
          customerId,
          code: 'logging_failed',
          logFailure: true,
        }),
      })
    )
  })
})

describe('Event manual booking table-reservation rollback guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedEnsureCustomerForPhone.mockResolvedValue({
      customerId: '550e8400-e29b-41d4-a716-446655440011',
      resolutionError: undefined,
    })
    mockedCreateEventManageToken.mockResolvedValue({ url: 'https://example.test/manage' })
  })

  it('fails closed when rollback cancellation update affects no rows', async () => {
    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Test Event', booking_mode: 'table' },
      error: null,
    })
    const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
    const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

    const cancelMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
    const cancelEq = vi.fn().mockReturnValue({ select: cancelSelect })

    const holdReleaseSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    const holdReleaseEq3 = vi.fn().mockReturnValue({ select: holdReleaseSelect })
    const holdReleaseEq2 = vi.fn().mockReturnValue({ eq: holdReleaseEq3 })
    const holdReleaseEq1 = vi.fn().mockReturnValue({ eq: holdReleaseEq2 })

    const rpc = vi.fn(async (fnName: string) => {
      if (fnName === 'create_event_booking_v05') {
        return {
          data: {
            state: 'confirmed',
            booking_id: '550e8400-e29b-41d4-a716-446655440100',
            event_start_datetime: '2026-03-01T12:00:00.000Z',
          },
          error: null,
        }
      }

      if (fnName === 'create_event_table_reservation_v05') {
        return {
          data: {
            state: 'blocked',
            reason: 'no_table',
          },
          error: null,
        }
      }

      throw new Error(`Unexpected rpc: ${fnName}`)
    })

    mockedCreateAdminClient.mockReturnValue({
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return { select: eventSelect }
        }

        if (table === 'bookings') {
          return { update: vi.fn().mockReturnValue({ eq: cancelEq }) }
        }

        if (table === 'booking_holds') {
          return { update: vi.fn().mockReturnValue({ eq: holdReleaseEq1 }) }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await createEventManualBooking({
      eventId: '550e8400-e29b-41d4-a716-446655440001',
      phone: '+447700900001',
      seats: 2,
      firstName: 'Pat',
      lastName: 'Test',
    })

    expect(result).toEqual({ error: 'Failed to rollback booking after table reservation failure.' })
  })

  it('fails closed when rollback hold release update errors', async () => {
    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: '550e8400-e29b-41d4-a716-446655440002', name: 'Test Event', booking_mode: 'table' },
      error: null,
    })
    const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
    const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

    const cancelMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'booking-1' }, error: null })
    const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
    const cancelEq = vi.fn().mockReturnValue({ select: cancelSelect })

    const holdReleaseSelect = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'db_down' },
    })
    const holdReleaseEq3 = vi.fn().mockReturnValue({ select: holdReleaseSelect })
    const holdReleaseEq2 = vi.fn().mockReturnValue({ eq: holdReleaseEq3 })
    const holdReleaseEq1 = vi.fn().mockReturnValue({ eq: holdReleaseEq2 })

    const rpc = vi.fn(async (fnName: string) => {
      if (fnName === 'create_event_booking_v05') {
        return {
          data: {
            state: 'confirmed',
            booking_id: 'booking-1',
            event_start_datetime: '2026-03-02T12:00:00.000Z',
          },
          error: null,
        }
      }

      if (fnName === 'create_event_table_reservation_v05') {
        return {
          data: {
            state: 'blocked',
            reason: 'no_table',
          },
          error: null,
        }
      }

      throw new Error(`Unexpected rpc: ${fnName}`)
    })

    mockedCreateAdminClient.mockReturnValue({
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return { select: eventSelect }
        }

        if (table === 'bookings') {
          return { update: vi.fn().mockReturnValue({ eq: cancelEq }) }
        }

        if (table === 'booking_holds') {
          return { update: vi.fn().mockReturnValue({ eq: holdReleaseEq1 }) }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await createEventManualBooking({
      eventId: '550e8400-e29b-41d4-a716-446655440002',
      phone: '+447700900002',
      seats: 2,
      firstName: 'Pat',
      lastName: 'Test',
    })

    expect(result).toEqual({ error: 'Failed to rollback booking after table reservation failure.' })
  })

  it('fails closed when rollback hold release updates zero rows but active holds still remain', async () => {
    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: '550e8400-e29b-41d4-a716-446655440003', name: 'Test Event', booking_mode: 'table' },
      error: null,
    })
    const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
    const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

    const cancelMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'booking-2' }, error: null })
    const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
    const cancelEq = vi.fn().mockReturnValue({ select: cancelSelect })

    const holdReleaseSelect = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const holdReleaseEq3 = vi.fn().mockReturnValue({ select: holdReleaseSelect })
    const holdReleaseEq2 = vi.fn().mockReturnValue({ eq: holdReleaseEq3 })
    const holdReleaseEq1 = vi.fn().mockReturnValue({ eq: holdReleaseEq2 })

    const remainingHoldEq3 = vi.fn().mockResolvedValue({
      data: [{ id: 'hold-remaining-1' }],
      error: null,
    })
    const remainingHoldEq2 = vi.fn().mockReturnValue({ eq: remainingHoldEq3 })
    const remainingHoldEq1 = vi.fn().mockReturnValue({ eq: remainingHoldEq2 })
    const remainingHoldSelect = vi.fn().mockReturnValue({ eq: remainingHoldEq1 })

    const rpc = vi.fn(async (fnName: string) => {
      if (fnName === 'create_event_booking_v05') {
        return {
          data: {
            state: 'confirmed',
            booking_id: 'booking-2',
            event_start_datetime: '2026-03-03T12:00:00.000Z',
          },
          error: null,
        }
      }

      if (fnName === 'create_event_table_reservation_v05') {
        return {
          data: {
            state: 'blocked',
            reason: 'no_table',
          },
          error: null,
        }
      }

      throw new Error(`Unexpected rpc: ${fnName}`)
    })

    mockedCreateAdminClient.mockReturnValue({
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return { select: eventSelect }
        }

        if (table === 'bookings') {
          return { update: vi.fn().mockReturnValue({ eq: cancelEq }) }
        }

        if (table === 'booking_holds') {
          return {
            update: vi.fn().mockReturnValue({ eq: holdReleaseEq1 }),
            select: remainingHoldSelect,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await createEventManualBooking({
      eventId: '550e8400-e29b-41d4-a716-446655440003',
      phone: '+447700900003',
      seats: 2,
      firstName: 'Pat',
      lastName: 'Test',
    })

    expect(result).toEqual({ error: 'Failed to rollback booking after table reservation failure.' })
    expect(remainingHoldSelect).toHaveBeenCalledWith('id')
    expect(error).toHaveBeenCalledWith(
      'Failed rolling back event booking after table reservation failure',
      expect.objectContaining({
        error: expect.any(Error),
        metadata: expect.objectContaining({
          bookingId: 'booking-2',
        }),
      })
    )
  })
})
