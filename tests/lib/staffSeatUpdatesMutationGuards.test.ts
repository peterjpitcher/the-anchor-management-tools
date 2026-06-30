import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/events/manage-booking', () => ({
  updateEventBookingSeatsById: vi.fn(),
}))

vi.mock('@/lib/events/event-payments', () => ({
  sendEventBookingSeatUpdateSms: vi.fn(),
}))

vi.mock('@/lib/table-bookings/move-table', () => ({
  getMoveTableAvailability: vi.fn(),
  moveBookingAssignmentToTables: vi.fn(),
}))

import { updateEventBookingSeatsById } from '@/lib/events/manage-booking'
import { sendEventBookingSeatUpdateSms } from '@/lib/events/event-payments'
import {
  getMoveTableAvailability,
  moveBookingAssignmentToTables,
} from '@/lib/table-bookings/move-table'
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

    const assignmentEq = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const assignmentSelect = vi.fn().mockReturnValue({ eq: assignmentEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return {
            select: lookupSelect,
            update,
          }
        }
        if (table === 'booking_table_assignments') {
          return {
            select: assignmentSelect,
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

  it('blocks direct table-booking party-size increases that exceed assigned table capacity', async () => {
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

    const update = vi.fn()

    const assignmentEq = vi.fn().mockResolvedValue({
      data: [
        {
          table_id: 'table-1',
          tables: { capacity: 2 },
        },
      ],
      error: null,
    })
    const assignmentSelect = vi.fn().mockReturnValue({ eq: assignmentEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return {
            select: lookupSelect,
            update,
          }
        }
        if (table === 'booking_table_assignments') {
          return {
            select: assignmentSelect,
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

    expect(result).toMatchObject({
      state: 'blocked',
      reason: 'table_capacity_insufficient',
      old_party_size: 2,
      new_party_size: 2,
      delta: 0,
    })
    expect(update).not.toHaveBeenCalled()
    expect(sendEventBookingSeatUpdateSms).not.toHaveBeenCalled()
    expect(updateEventBookingSeatsById).not.toHaveBeenCalled()
  })

  it('auto-moves direct table-booking party-size increases to a joined table option', async () => {
    const lookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'table-booking-1',
        status: 'confirmed',
        party_size: 6,
        event_booking_id: null,
        event_id: null,
        booking_date: '2026-07-01',
        booking_time: '19:30:00',
        start_datetime: '2026-07-01T18:30:00.000Z',
        end_datetime: '2026-07-01T20:30:00.000Z',
        duration_minutes: 120,
      },
      error: null,
    })
    const lookupEq = vi.fn().mockReturnValue({ maybeSingle: lookupMaybeSingle })
    const lookupSelect = vi.fn().mockReturnValue({ eq: lookupEq })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'table-booking-1' },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const assignmentEq = vi.fn().mockResolvedValue({
      data: [
        {
          table_id: 'big-bay',
          tables: { capacity: 6 },
        },
      ],
      error: null,
    })
    const assignmentSelect = vi.fn().mockReturnValue({ eq: assignmentEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return {
            select: lookupSelect,
            update,
          }
        }
        if (table === 'booking_table_assignments') {
          return {
            select: assignmentSelect,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(getMoveTableAvailability as unknown as vi.Mock).mockResolvedValue({
      startIso: '2026-07-01T18:30:00.000Z',
      endIso: '2026-07-01T20:30:00.000Z',
      assignedTableIds: ['big-bay'],
      tables: [
        {
          id: 'joined-11-12',
          table_ids: ['dining-6b', 'dining-6c'],
          name: 'Dining Room 6b + Dining Room 6c',
          capacity: 11,
        },
      ],
    })
    ;(moveBookingAssignmentToTables as unknown as vi.Mock).mockResolvedValue({ ok: true })

    const result = await updateTableBookingPartySizeWithLinkedEventSeats(supabase as any, {
      tableBookingId: 'table-booking-1',
      partySize: 9,
      actor: 'foh',
      sendSms: true,
      autoMoveTable: true,
    })

    expect(getMoveTableAvailability).toHaveBeenCalledWith(supabase, expect.objectContaining({
      id: 'table-booking-1',
      party_size: 9,
    }))
    expect(moveBookingAssignmentToTables).toHaveBeenCalledWith(supabase, expect.objectContaining({
      bookingId: 'table-booking-1',
      targetTableIds: ['dining-6b', 'dining-6c'],
    }))
    expect(result).toMatchObject({
      state: 'updated',
      old_party_size: 6,
      new_party_size: 9,
      auto_moved_table_ids: ['dining-6b', 'dining-6c'],
      auto_moved_table_name: 'Dining Room 6b + Dining Room 6c',
    })
    expect(update).toHaveBeenCalled()
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
