/**
 * The chase rule, and the one cutoff.
 *
 * The collision these pin down is the shipped default: `preorder_cutoff_days` defaults to 7 and the
 * booker reminder goes out 7 days ahead, so on the raw thresholds a guest was asked for their food
 * choices and a manager was told to ring them about not having given any, in the same sweep.
 */

import { describe, expect, it } from 'vitest'
import { decidePreorderChases, getPreorderCutoff } from './preorder'
import { getPreorderCutoff as getPreorderCutoffFromStaffScreen } from '@/components/features/table-bookings/preorder/cutoff'
import { resolvePreorderCutoff } from '@/app/g/[token]/table-manage/preorder-data'

const TODAY = '2026-12-17'

describe('decidePreorderChases', () => {
  it('asks the booker without also telling the manager, at the shipped default cutoff of 7', () => {
    expect(
      decidePreorderChases({
        daysUntilBooking: 7,
        cutoffDays: 7,
        bookerReminderSentOn: null,
        managerEscalationSent: false,
        todayIso: TODAY,
      }),
    ).toEqual(['booker_reminder'])
  })

  it('tells the manager on the next sweep, once the booker has had a day to act', () => {
    expect(
      decidePreorderChases({
        daysUntilBooking: 6,
        cutoffDays: 7,
        bookerReminderSentOn: '2026-12-16',
        managerEscalationSent: false,
        todayIso: TODAY,
      }),
    ).toEqual(['manager_escalation'])
  })

  it('does not escalate on a second run of the same day as the reminder', () => {
    expect(
      decidePreorderChases({
        daysUntilBooking: 7,
        cutoffDays: 7,
        bookerReminderSentOn: TODAY,
        managerEscalationSent: false,
        todayIso: TODAY,
      }),
    ).toEqual([])
  })

  it('reminds a booking taken inside the cutoff, and escalates it the following day', () => {
    // Booked two days out with a seven-day cutoff: the guest is asked today.
    expect(
      decidePreorderChases({
        daysUntilBooking: 2,
        cutoffDays: 7,
        bookerReminderSentOn: null,
        managerEscalationSent: false,
        todayIso: TODAY,
      }),
    ).toEqual(['booker_reminder'])

    // Tomorrow, still no choices, so the manager gets the call list entry.
    expect(
      decidePreorderChases({
        daysUntilBooking: 1,
        cutoffDays: 7,
        bookerReminderSentOn: TODAY,
        managerEscalationSent: false,
        todayIso: '2026-12-18',
      }),
    ).toEqual(['manager_escalation'])
  })

  it('sends both on the day of the booking, because there is no later sweep to wait for', () => {
    expect(
      decidePreorderChases({
        daysUntilBooking: 0,
        cutoffDays: 7,
        bookerReminderSentOn: null,
        managerEscalationSent: false,
        todayIso: TODAY,
      }),
    ).toEqual(['booker_reminder', 'manager_escalation'])
  })

  it('holds the escalation back when the cutoff is longer than the reminder window', () => {
    // A fourteen-day cutoff would otherwise reach the manager before the guest had been asked at all.
    expect(
      decidePreorderChases({
        daysUntilBooking: 12,
        cutoffDays: 14,
        bookerReminderSentOn: null,
        managerEscalationSent: false,
        todayIso: TODAY,
      }),
    ).toEqual([])
  })

  it('never escalates a booking with no seasonal period', () => {
    expect(
      decidePreorderChases({
        daysUntilBooking: 1,
        cutoffDays: null,
        bookerReminderSentOn: '2026-12-10',
        managerEscalationSent: false,
        todayIso: TODAY,
      }),
    ).toEqual([])
  })

  it('chases nothing once both have gone', () => {
    expect(
      decidePreorderChases({
        daysUntilBooking: 1,
        cutoffDays: 7,
        bookerReminderSentOn: '2026-12-10',
        managerEscalationSent: true,
        todayIso: TODAY,
      }),
    ).toEqual([])
  })

  it('stays quiet until the booking is inside the reminder window', () => {
    expect(
      decidePreorderChases({
        daysUntilBooking: 8,
        cutoffDays: 7,
        bookerReminderSentOn: null,
        managerEscalationSent: false,
        todayIso: TODAY,
      }),
    ).toEqual([])
  })
})

describe('one cutoff rule', () => {
  it('gives the staff screen and the booker page the identical answer', () => {
    const now = new Date('2026-12-17T11:59:00Z')
    const shared = getPreorderCutoff({ bookingDate: '2026-12-24', preorderCutoffDays: 7, now })
    const staff = getPreorderCutoffFromStaffScreen({
      bookingDate: '2026-12-24',
      preorderCutoffDays: 7,
      now,
    })
    const booker = resolvePreorderCutoff('2026-12-24', 7, now)

    expect(staff).toEqual(shared)
    expect(booker.at?.toISOString()).toBe(shared.closesAt?.toISOString())
    expect(booker.editable).toBe(!shared.closed)
  })
})
