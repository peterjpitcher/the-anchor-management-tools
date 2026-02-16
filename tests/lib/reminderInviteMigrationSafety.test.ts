import { describe, expect, it } from 'vitest'
import {
  assertInviteReminderMigrationCompletedWithoutFailures,
  buildInviteReminderDeletePlan
} from '@/lib/reminder-invite-migration-safety'

describe('reminder invite migration safety', () => {
  it('builds per-booking delete plan from valid rows', () => {
    const plan = buildInviteReminderDeletePlan([
      { id: 'reminder-1', booking_id: 'booking-a' },
      { id: 'reminder-2', booking_id: 'booking-a' },
      { id: 'reminder-3', booking_id: 'booking-b' }
    ])

    expect(plan).toEqual({
      bookingIds: ['booking-a', 'booking-b'],
      expectedDeletesByBooking: {
        'booking-a': 2,
        'booking-b': 1
      }
    })
  })

  it('fails closed when pending rows contain invalid ids', () => {
    expect(() =>
      buildInviteReminderDeletePlan([
        { id: 'reminder-1', booking_id: 'booking-a' },
        { id: null, booking_id: 'booking-a' }
      ])
    ).toThrow(
      'Cannot safely build invite-reminder migration plan because pending rows include invalid data: row#2:invalid-id'
    )
  })

  it('fails closed when pending rows contain invalid booking ids', () => {
    expect(() =>
      buildInviteReminderDeletePlan([
        { id: 'reminder-1', booking_id: '' }
      ])
    ).toThrow(
      'Cannot safely build invite-reminder migration plan because pending rows include invalid data: row#1:invalid-booking-id'
    )
  })

  it('fails closed when pending rows contain duplicate reminder ids', () => {
    expect(() =>
      buildInviteReminderDeletePlan([
        { id: 'reminder-1', booking_id: 'booking-a' },
        { id: 'reminder-1', booking_id: 'booking-b' }
      ])
    ).toThrow(
      'Cannot safely build invite-reminder migration plan because pending rows contain duplicate reminder ids: reminder-1'
    )
  })

  it('fails closed when migration finishes with failures', () => {
    expect(() =>
      assertInviteReminderMigrationCompletedWithoutFailures([
        'delete:booking-a:timeout',
        'schedule:booking-b:429'
      ])
    ).toThrow(
      'Invite-reminder migration finished with 2 failure(s): delete:booking-a:timeout | schedule:booking-b:429'
    )

    expect(() => assertInviteReminderMigrationCompletedWithoutFailures([])).not.toThrow()
  })
})
