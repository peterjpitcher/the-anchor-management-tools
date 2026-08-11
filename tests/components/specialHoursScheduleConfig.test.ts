import { describe, expect, it } from 'vitest'

import { reconcileScheduleConfig } from '@/app/(authenticated)/settings/business-hours/SpecialHoursModal'
import type { ScheduleConfigItem } from '@/types/business-hours'

/**
 * The exception form pre-fills service slots from the regular weekday, so an
 * exception that only changes the note keeps its seeded config. The trouble is
 * that an exception usually changes the hours too, and the database rejects any
 * slot that falls outside them.
 *
 * These mirror public.validate_schedule_config. If that function changes, these
 * must change with it, or the form will start allowing saves the database
 * refuses again.
 */
const slot = (over: Partial<ScheduleConfigItem> = {}): ScheduleConfigItem => ({
  name: 'dinner',
  starts_at: '17:00',
  ends_at: '21:00',
  capacity: 50,
  booking_type: 'regular',
  ...over,
})

const open = (over: Record<string, unknown> = {}) => ({
  isClosed: false,
  opens: '12:00:00',
  closes: '15:00:00',
  isKitchenClosed: true,
  kitchenOpens: '',
  kitchenCloses: '',
  ...over,
})

describe('reconcileScheduleConfig', () => {
  it('drops the Friday dinner slot inherited onto a 12:00-15:00 Christmas Day', () => {
    // The exact case that failed: Christmas Day 2026 is a Friday, Friday carries
    // a 17:00-21:00 dinner, and the venue opens 12:00-15:00 that day.
    const { kept, dropped } = reconcileScheduleConfig([slot()], open())
    expect(kept).toEqual([])
    expect(dropped).toEqual(['dinner'])
  })

  it('keeps a slot that fits inside the exception hours', () => {
    const lunch = slot({ name: 'lunch', starts_at: '12:30', ends_at: '14:30' })
    const { kept, dropped } = reconcileScheduleConfig([lunch], open())
    expect(kept).toEqual([lunch])
    expect(dropped).toEqual([])
  })

  it('drops everything when the venue is closed', () => {
    const { kept, dropped } = reconcileScheduleConfig([slot()], open({ isClosed: true }))
    expect(kept).toEqual([])
    expect(dropped).toEqual(['dinner'])
  })

  it('drops a food slot when the kitchen is closed, even inside venue hours', () => {
    const food = slot({ name: 'lunch', starts_at: '12:30', ends_at: '14:30', booking_type: 'food' })
    const { kept, dropped } = reconcileScheduleConfig([food], open({ isKitchenClosed: true }))
    expect(kept).toEqual([])
    expect(dropped).toEqual(['lunch'])
  })

  it('keeps a food slot inside the kitchen window', () => {
    const food = slot({ name: 'lunch', starts_at: '12:30', ends_at: '14:00', booking_type: 'food' })
    const { kept } = reconcileScheduleConfig(
      [food],
      open({ isKitchenClosed: false, kitchenOpens: '12:00:00', kitchenCloses: '14:30:00' })
    )
    expect(kept).toEqual([food])
  })

  it('drops a food slot that runs past the kitchen close', () => {
    const food = slot({ name: 'lunch', starts_at: '12:30', ends_at: '14:45', booking_type: 'food' })
    const { dropped } = reconcileScheduleConfig(
      [food],
      open({ isKitchenClosed: false, kitchenOpens: '12:00:00', kitchenCloses: '14:30:00' })
    )
    expect(dropped).toEqual(['lunch'])
  })

  it('lets a regular slot run past the kitchen close, since it gates drinks too', () => {
    const late = slot({ name: 'evening', starts_at: '12:30', ends_at: '14:55' })
    const { kept } = reconcileScheduleConfig(
      [late],
      open({ isKitchenClosed: false, kitchenOpens: '12:00:00', kitchenCloses: '13:00:00' })
    )
    expect(kept).toEqual([late])
  })

  it('handles a session running past midnight', () => {
    // New Year: open 12:00 to 01:00, so a 23:00-00:30 slot is inside it.
    const nye = slot({ name: 'late', starts_at: '23:00', ends_at: '00:30' })
    const { kept } = reconcileScheduleConfig([nye], open({ opens: '12:00:00', closes: '01:00:00' }))
    expect(kept).toEqual([nye])
  })

  it('keeps an early-clock slot on a past-midnight day at the far end of the session', () => {
    // Open 20:00 to 02:00; a 00:30-01:30 slot belongs to the small hours, not to
    // the morning before opening.
    const small = slot({ name: 'late', starts_at: '00:30', ends_at: '01:30' })
    const { kept } = reconcileScheduleConfig([small], open({ opens: '20:00:00', closes: '02:00:00' }))
    expect(kept).toEqual([small])
  })

  it('reports every dropped service by name', () => {
    const { dropped } = reconcileScheduleConfig(
      [slot({ name: 'dinner' }), slot({ name: 'late drinks', starts_at: '21:00', ends_at: '23:00' })],
      open()
    )
    expect(dropped).toEqual(['dinner', 'late drinks'])
  })

  it('passes an empty config straight through', () => {
    expect(reconcileScheduleConfig([], open())).toEqual({ kept: [], dropped: [] })
  })
})
