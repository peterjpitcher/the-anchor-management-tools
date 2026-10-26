import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

/**
 * BK-130 and BK-118 (owner decision D13): staff tick who came from a list after the night, and a
 * pay-on-arrival night's door money is kept as one till total. Nothing is marked automatically.
 */

const state = vi.hoisted(() => ({ db: null as unknown, user: { id: 'manager-1', email: 'boss@example.test' }, canManage: true }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => state.canManage) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { recordEventBookingAttendance, saveEventDoorTakings } from '@/app/actions/event-outcomes'
import { logAuditEvent } from '@/app/actions/audit'

const EVENT = '3e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c03'
const BOOKING = '2e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c02'
const PAST_START = '2026-10-20T18:30:00.000Z'
const FUTURE_START = '2099-10-20T18:30:00.000Z'

function seed(options: {
  status?: string
  start?: string
  checkIn?: { check_in_method: string } | null
  event?: Record<string, unknown>
} = {}): FakeSupabase {
  const db = createFakeSupabase(
    {
      events: [{
        id: EVENT, name: 'Quiz night', start_datetime: options.start ?? PAST_START, date: '2026-10-20', time: '19:30',
        payment_mode: 'cash_only', price: 3, price_per_seat: null, is_free: false, ...options.event,
      }],
      bookings: [{
        id: BOOKING, event_id: EVENT, customer_id: 'customer-1', seats: 4, status: options.status ?? 'confirmed',
        is_reminder_only: false, review_sms_sent_at: null, review_clicked_at: null, completed_at: null,
      }],
      event_check_ins: options.checkIn
        ? [{ id: 'check-in-1', event_id: EVENT, customer_id: 'customer-1', booking_id: BOOKING, ...options.checkIn }]
        : [],
      event_door_takings: [],
    },
    { unique: { event_check_ins: (row) => `${row.event_id}:${row.customer_id}` } }
  )
  state.db = db
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
  state.canManage = true
  state.user = { id: 'manager-1', email: 'boss@example.test' }
})

describe('recordEventBookingAttendance', () => {
  it('needs the events manage permission', async () => {
    const db = seed()
    state.canManage = false
    const result = await recordEventBookingAttendance({ bookingId: BOOKING, outcome: 'did_not_come' })
    expect(result).toEqual({ error: 'You do not have permission to record event outcomes.' })
    expect(db.tables.bookings[0].status).toBe('confirmed')
  })

  it('ticks a guest as came with a staff-list check-in at the event start, leaving the status alone', async () => {
    const db = seed()
    const result = await recordEventBookingAttendance({ bookingId: BOOKING, outcome: 'came' })
    expect(result).toEqual({ success: true, data: { attendance: 'came' } })
    expect(db.tables.event_check_ins).toEqual([expect.objectContaining({
      event_id: EVENT, customer_id: 'customer-1', booking_id: BOOKING, check_in_method: 'staff_list',
      staff_id: 'manager-1', check_in_time: PAST_START,
    })])
    expect(db.tables.bookings[0].status).toBe('confirmed')
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'event_booking.attendance', resource_id: BOOKING,
      old_values: { attendance: 'not_recorded', status: 'confirmed' },
      new_values: { attendance: 'came', status: 'confirmed' },
    }))
  })

  it('marks a guest who did not come as no_show, so the review job skips them', async () => {
    const db = seed()
    const result = await recordEventBookingAttendance({ bookingId: BOOKING, outcome: 'did_not_come' })
    expect(result).toEqual({ success: true, data: { attendance: 'did_not_come' } })
    expect(db.tables.bookings[0].status).toBe('no_show')
  })

  it('corrects a mis-tick: removes the staff-list check-in and marks the no-show', async () => {
    const db = seed({ checkIn: { check_in_method: 'staff_list' } })
    const result = await recordEventBookingAttendance({ bookingId: BOOKING, outcome: 'did_not_come' })
    expect(result).toEqual({ success: true, data: { attendance: 'did_not_come' } })
    expect(db.tables.event_check_ins).toEqual([])
    expect(db.tables.bookings[0].status).toBe('no_show')
  })

  it('never removes a check-in made at the door', async () => {
    const db = seed({ checkIn: { check_in_method: 'manual' } })
    const result = await recordEventBookingAttendance({ bookingId: BOOKING, outcome: 'did_not_come' })
    expect(result).toEqual({ error: 'This guest was checked in at the door, so they came.' })
    expect(db.tables.event_check_ins).toHaveLength(1)
    expect(db.tables.bookings[0].status).toBe('confirmed')
  })

  it('undoes a no-show back to confirmed when staff tick the guest as came', async () => {
    const db = seed({ status: 'no_show' })
    const result = await recordEventBookingAttendance({ bookingId: BOOKING, outcome: 'came' })
    expect(result).toEqual({ success: true, data: { attendance: 'came' } })
    expect(db.tables.bookings[0].status).toBe('confirmed')
    expect(db.tables.event_check_ins).toHaveLength(1)
  })

  it('refuses before the event has started', async () => {
    const db = seed({ start: FUTURE_START })
    const result = await recordEventBookingAttendance({ bookingId: BOOKING, outcome: 'did_not_come' })
    expect(result).toEqual({ error: 'You can record who came once the event has started.' })
    expect(db.tables.bookings[0].status).toBe('confirmed')
  })

  it('refuses a booking that is not live', async () => {
    const db = seed({ status: 'cancelled' })
    const result = await recordEventBookingAttendance({ bookingId: BOOKING, outcome: 'did_not_come' })
    expect(result).toEqual({ error: 'Only a live booking can be marked as came or did not come.' })
    expect(db.tables.bookings[0].status).toBe('cancelled')
  })

  it('reports a failed write instead of claiming success', async () => {
    const db = seed()
    db.failures.push({ table: 'bookings', op: 'update', error: { message: 'boom' } })
    const result = await recordEventBookingAttendance({ bookingId: BOOKING, outcome: 'did_not_come' })
    expect(result).toEqual({ error: 'Failed to record who came. Please try again.' })
  })
})

describe('saveEventDoorTakings', () => {
  it('keeps a pay-on-arrival night\'s door money as one till total, and corrects it', async () => {
    const db = seed()
    const first = await saveEventDoorTakings({ eventId: EVENT, tillTotal: 36, freeEntries: 2, note: 'Quiz host and partner' })
    expect(first).toMatchObject({ success: true, data: { eventId: EVENT, tillTotal: 36, freeEntries: 2, note: 'Quiz host and partner' } })
    const second = await saveEventDoorTakings({ eventId: EVENT, tillTotal: 42, freeEntries: 0 })
    expect(second).toMatchObject({ success: true, data: { tillTotal: 42, freeEntries: 0, note: null } })
    expect(db.tables.event_door_takings).toHaveLength(1)
    expect(db.tables.event_door_takings[0]).toMatchObject({ till_total: 42, recorded_by: 'manager-1' })
  })

  it('needs a reason for a free entry', async () => {
    const db = seed()
    const result = await saveEventDoorTakings({ eventId: EVENT, tillTotal: 30, freeEntries: 1, note: '   ' })
    expect(result).toEqual({ error: 'Say why guests were let in free.' })
    expect(db.tables.event_door_takings).toEqual([])
  })

  it('records door money for pay-on-arrival events only', async () => {
    const db = seed({ event: { payment_mode: 'prepaid' } })
    const result = await saveEventDoorTakings({ eventId: EVENT, tillTotal: 30, freeEntries: 0 })
    expect(result).toEqual({ error: 'Door money is recorded for pay-on-arrival events only.' })
    expect(db.tables.event_door_takings).toEqual([])
  })

  it('refuses before the event has started', async () => {
    seed({ start: FUTURE_START })
    const result = await saveEventDoorTakings({ eventId: EVENT, tillTotal: 30, freeEntries: 0 })
    expect(result).toEqual({ error: 'You can record the door money once the event has started.' })
  })

  it('refuses a negative total or part pennies', async () => {
    seed()
    expect(await saveEventDoorTakings({ eventId: EVENT, tillTotal: -1, freeEntries: 0 })).toEqual({ error: 'The till total cannot be negative.' })
    expect(await saveEventDoorTakings({ eventId: EVENT, tillTotal: 10.005, freeEntries: 0 })).toEqual({ error: 'Use pounds and pence.' })
  })

  it('tells staff when the save fails', async () => {
    const db = seed()
    db.failures.push({ table: 'event_door_takings', op: 'select', error: { message: 'boom' } })
    const result = await saveEventDoorTakings({ eventId: EVENT, tillTotal: 30, freeEntries: 0 })
    expect(result).toEqual({ error: 'Failed to save the door money. Please try again.' })
  })
})
