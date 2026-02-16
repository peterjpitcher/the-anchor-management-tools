import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/events/manage-booking', () => ({
  updateEventBookingSeatsById: vi.fn(),
}))

vi.mock('@/lib/events/event-payments', () => ({
  sendEventBookingSeatUpdateSms: vi.fn(),
}))

import { updateEventBookingSeatsById } from '@/lib/events/manage-booking'
import { sendEventBookingSeatUpdateSms } from '@/lib/events/event-payments'
import { updateTableBookingPartySizeWithLinkedEventSeats } from '@/lib/events/staff-seat-updates'

describe('staff seat update mutation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns blocked when direct table-booking party-size update affects no rows', async () => {
    const lookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'table-booking-1',
        status: 'confirmed',
        party_size: 2,
        event_booking_id: null,
        event_id: 'event-1',
      },
      error: null,
    })
    const lookupEq = vi.fn().mockReturnValue({ maybeSingle: lookupMaybeSingle })
    const lookupSelect = vi.fn().mockReturnValue({ eq: lookupEq })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return {
            select: lookupSelect,
            update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await updateTableBookingPartySizeWithLinkedEventSeats(supabase as any, {
      tableBookingId: 'table-booking-1',
      partySize: 4,
      actor: 'foh',
      sendSms: true,
    })

    expect(result.state).toBe('blocked')
    expect(result.reason).toBe('booking_not_found')
    expect(sendEventBookingSeatUpdateSms).not.toHaveBeenCalled()
    expect(updateEventBookingSeatsById).not.toHaveBeenCalled()
  })

  it('throws when linked table-booking seat sync affects no rows after booking seat update', async () => {
    const lookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'table-booking-1',
        status: 'confirmed',
        party_size: 2,
        event_booking_id: 'event-booking-1',
        event_id: 'event-1',
      },
      error: null,
    })
    const lookupEq = vi.fn().mockReturnValue({ maybeSingle: lookupMaybeSingle })
    const lookupSelect = vi.fn().mockReturnValue({ eq: lookupEq })

    const syncSelect = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const syncNot = vi.fn().mockReturnValue({ select: syncSelect })
    const syncEq = vi.fn().mockReturnValue({ not: syncNot })
    const update = vi.fn().mockReturnValue({ eq: syncEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return {
            select: lookupSelect,
            update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(updateEventBookingSeatsById as unknown as vi.Mock).mockResolvedValue({
      state: 'updated',
      booking_id: 'event-booking-1',
      event_id: 'event-1',
      old_seats: 2,
      new_seats: 4,
      delta: 2,
      event_name: 'Launch Night',
    })

    await expect(
      updateTableBookingPartySizeWithLinkedEventSeats(supabase as any, {
        tableBookingId: 'table-booking-1',
        partySize: 4,
        actor: 'foh',
        sendSms: true,
      })
    ).rejects.toThrow('Linked table-booking seat sync affected no rows')

    expect(sendEventBookingSeatUpdateSms).not.toHaveBeenCalled()
  })

  it('propagates seat-update SMS safety meta', async () => {
    const lookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'table-booking-1',
        status: 'confirmed',
        party_size: 2,
        event_booking_id: 'event-booking-1',
        event_id: 'event-1',
      },
      error: null,
    })
    const lookupEq = vi.fn().mockReturnValue({ maybeSingle: lookupMaybeSingle })
    const lookupSelect = vi.fn().mockReturnValue({ eq: lookupEq })

    const syncSelect = vi.fn().mockResolvedValue({
      data: [{ id: 'table-booking-1' }],
      error: null,
    })
    const syncNot = vi.fn().mockReturnValue({ select: syncSelect })
    const syncEq = vi.fn().mockReturnValue({ not: syncNot })
    const update = vi.fn().mockReturnValue({ eq: syncEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return {
            select: lookupSelect,
            update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(updateEventBookingSeatsById as unknown as vi.Mock).mockResolvedValue({
      state: 'updated',
      booking_id: 'event-booking-1',
      event_id: 'event-1',
      old_seats: 2,
      new_seats: 4,
      delta: 2,
      event_name: 'Launch Night',
    })

    ;(sendEventBookingSeatUpdateSms as unknown as vi.Mock).mockResolvedValue({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    })

    const result = await updateTableBookingPartySizeWithLinkedEventSeats(supabase as any, {
      tableBookingId: 'table-booking-1',
      partySize: 4,
      actor: 'foh',
      sendSms: true,
    })

    expect(result.state).toBe('updated')
    expect(result.sms_sent).toBe(true)
    expect(result.sms).toEqual({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    })
  })

  it('propagates thrown idempotency_conflict metadata from seat update SMS send', async () => {
    const lookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'table-booking-1',
        status: 'confirmed',
        party_size: 2,
        event_booking_id: 'event-booking-1',
        event_id: 'event-1',
      },
      error: null,
    })
    const lookupEq = vi.fn().mockReturnValue({ maybeSingle: lookupMaybeSingle })
    const lookupSelect = vi.fn().mockReturnValue({ eq: lookupEq })

    const syncSelect = vi.fn().mockResolvedValue({
      data: [{ id: 'table-booking-1' }],
      error: null,
    })
    const syncNot = vi.fn().mockReturnValue({ select: syncSelect })
    const syncEq = vi.fn().mockReturnValue({ not: syncNot })
    const update = vi.fn().mockReturnValue({ eq: syncEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return {
            select: lookupSelect,
            update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(updateEventBookingSeatsById as unknown as vi.Mock).mockResolvedValue({
      state: 'updated',
      booking_id: 'event-booking-1',
      event_id: 'event-1',
      old_seats: 2,
      new_seats: 4,
      delta: 2,
      event_name: 'Launch Night',
    })

    ;(sendEventBookingSeatUpdateSms as unknown as vi.Mock).mockRejectedValue(
      Object.assign(new Error('idempotency claim conflict'), {
        code: 'idempotency_conflict',
        logFailure: false,
      })
    )

    const result = await updateTableBookingPartySizeWithLinkedEventSeats(supabase as any, {
      tableBookingId: 'table-booking-1',
      partySize: 4,
      actor: 'foh',
      sendSms: true,
    })

    expect(result.state).toBe('updated')
    expect(result.sms_sent).toBe(false)
    expect(result.sms).toEqual({
      success: false,
      code: 'idempotency_conflict',
      logFailure: false,
    })
  })
})
