import { describe, expect, it } from 'vitest'
import {
  canRecordAttendance,
  expectedDoorMoney,
  planEventAttendanceChange,
  resolveEventAttendance,
  statusAfterNoShowUndo,
  summariseEventAttendance,
} from './attendance'

const kiosk = { id: 'check-in-door', check_in_method: 'manual' }
const ticked = { id: 'check-in-list', check_in_method: 'staff_list' }

describe('event attendance (BK-130, D13)', () => {
  it('reads an unticked booking as not recorded, never as a no-show', () => {
    expect(resolveEventAttendance({ status: 'confirmed' }, null)).toBe('not_recorded')
    expect(resolveEventAttendance({ status: 'completed' }, null)).toBe('not_recorded')
    expect(resolveEventAttendance({ status: 'no_show' }, null)).toBe('did_not_come')
    expect(resolveEventAttendance({ status: 'confirmed' }, kiosk)).toBe('came')
  })

  it('records attendance only for live bookings', () => {
    for (const status of ['confirmed', 'visited_waiting_for_review', 'review_clicked', 'completed', 'no_show']) {
      expect(canRecordAttendance({ status })).toBe(true)
    }
    for (const status of ['pending_payment', 'cancelled', 'expired', null]) {
      expect(canRecordAttendance({ status })).toBe(false)
    }
    expect(canRecordAttendance({ status: 'confirmed', is_reminder_only: true })).toBe(false)
  })

  it('refuses before the event has started', () => {
    const plan = planEventAttendanceChange({ booking: { status: 'confirmed' }, checkIn: null, outcome: 'came', eventStarted: false })
    expect(plan).toEqual({ ok: false, error: 'You can record who came once the event has started.' })
  })

  it('refuses a cancelled booking', () => {
    const plan = planEventAttendanceChange({ booking: { status: 'cancelled' }, checkIn: null, outcome: 'did_not_come', eventStarted: true })
    expect(plan.ok).toBe(false)
  })

  it('ticks a guest as came with a check-in, and leaves the status alone', () => {
    expect(planEventAttendanceChange({ booking: { status: 'confirmed' }, checkIn: null, outcome: 'came', eventStarted: true })).toEqual({
      ok: true, changed: true, setStatus: null, insertCheckIn: true, deleteCheckInId: null,
    })
  })

  it('marks a guest who did not come as no_show, removing a mis-ticked staff-list check-in', () => {
    expect(planEventAttendanceChange({ booking: { status: 'confirmed' }, checkIn: null, outcome: 'did_not_come', eventStarted: true })).toEqual({
      ok: true, changed: true, setStatus: 'no_show', insertCheckIn: false, deleteCheckInId: null,
    })
    expect(planEventAttendanceChange({ booking: { status: 'confirmed' }, checkIn: ticked, outcome: 'did_not_come', eventStarted: true })).toEqual({
      ok: true, changed: true, setStatus: 'no_show', insertCheckIn: false, deleteCheckInId: 'check-in-list',
    })
  })

  it('never removes a check-in made at the door', () => {
    for (const outcome of ['did_not_come', 'not_recorded'] as const) {
      const plan = planEventAttendanceChange({ booking: { status: 'confirmed' }, checkIn: kiosk, outcome, eventStarted: true })
      expect(plan).toEqual({ ok: false, error: 'This guest was checked in at the door, so they came.' })
    }
  })

  it('undoes a no-show back to where the review job had it', () => {
    expect(statusAfterNoShowUndo({ status: 'no_show' })).toBe('confirmed')
    expect(statusAfterNoShowUndo({ status: 'no_show', review_sms_sent_at: '2026-10-01T10:00:00Z' })).toBe('visited_waiting_for_review')
    expect(statusAfterNoShowUndo({ status: 'no_show', review_sms_sent_at: 'x', review_clicked_at: 'y' })).toBe('review_clicked')
    expect(statusAfterNoShowUndo({ status: 'no_show', review_sms_sent_at: 'x', completed_at: 'z' })).toBe('completed')

    expect(planEventAttendanceChange({ booking: { status: 'no_show' }, checkIn: null, outcome: 'came', eventStarted: true })).toEqual({
      ok: true, changed: true, setStatus: 'confirmed', insertCheckIn: true, deleteCheckInId: null,
    })
    expect(planEventAttendanceChange({ booking: { status: 'no_show', review_sms_sent_at: 'x' }, checkIn: null, outcome: 'not_recorded', eventStarted: true })).toEqual({
      ok: true, changed: true, setStatus: 'visited_waiting_for_review', insertCheckIn: false, deleteCheckInId: null,
    })
  })

  it('clears a staff-list tick back to not recorded', () => {
    expect(planEventAttendanceChange({ booking: { status: 'confirmed' }, checkIn: ticked, outcome: 'not_recorded', eventStarted: true })).toEqual({
      ok: true, changed: true, setStatus: null, insertCheckIn: false, deleteCheckInId: 'check-in-list',
    })
  })

  it('writes nothing when the booking already reads as asked', () => {
    expect(planEventAttendanceChange({ booking: { status: 'no_show' }, checkIn: null, outcome: 'did_not_come', eventStarted: true })).toEqual({
      ok: true, changed: false, setStatus: null, insertCheckIn: false, deleteCheckInId: null,
    })
  })

  it('counts bookings and seats by attendance, leaving out bookings attendance does not apply to', () => {
    const summary = summariseEventAttendance([
      { booking: { status: 'confirmed', seats: 4 }, checkIn: kiosk },
      { booking: { status: 'completed', seats: 2 }, checkIn: ticked },
      { booking: { status: 'no_show', seats: 3 }, checkIn: null },
      { booking: { status: 'confirmed', seats: 5 }, checkIn: null },
      { booking: { status: 'cancelled', seats: 6 }, checkIn: null },
      { booking: { status: 'confirmed', seats: 1, is_reminder_only: true }, checkIn: null },
    ])
    expect(summary).toEqual({
      came: { bookings: 2, seats: 6 },
      did_not_come: { bookings: 1, seats: 3 },
      not_recorded: { bookings: 1, seats: 5 },
    })
  })

  it('works out the door money expected at the ticket price', () => {
    expect(expectedDoorMoney(14, 3)).toBe(42)
    expect(expectedDoorMoney(3, 2.5)).toBe(7.5)
    expect(expectedDoorMoney(0, 3)).toBe(0)
    expect(expectedDoorMoney(5, 0)).toBe(0)
    expect(expectedDoorMoney(Number.NaN, 3)).toBe(0)
  })
})
