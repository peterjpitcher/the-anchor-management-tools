import { describe, expect, it } from 'vitest'
import {
  describeKitchenWindows,
  kitchenWindowAt,
  nextKitchenWindowAfter,
  resolveKitchenWindows,
} from '@/lib/business-hours/kitchen-windows'

/**
 * The September schedule: lunch, a deliberate hour off, then dinner. Stored as
 * kitchen bounds of 12:00-21:00 with two services, which is why reading the
 * bounds alone reported the kitchen open at half three.
 */
const SEPTEMBER_WEEKDAY = {
  is_closed: false,
  is_kitchen_closed: false,
  kitchen_opens: '12:00:00',
  kitchen_closes: '21:00:00',
  schedule_config: [
    { name: 'Lunch', starts_at: '12:00', ends_at: '15:00', capacity: 50, booking_type: 'regular' },
    { name: 'Dinner', starts_at: '16:00', ends_at: '21:00', capacity: 50, booking_type: 'regular' },
  ],
}

const SATURDAY = {
  is_closed: false,
  is_kitchen_closed: false,
  kitchen_opens: '12:00:00',
  kitchen_closes: '19:00:00',
  schedule_config: [
    { name: 'food service', starts_at: '12:00', ends_at: '19:00', capacity: 50, booking_type: 'regular' },
  ],
}

describe('resolveKitchenWindows', () => {
  it('returns both sittings on a split day', () => {
    expect(resolveKitchenWindows(SEPTEMBER_WEEKDAY)).toEqual([
      { opens: '12:00', closes: '15:00' },
      { opens: '16:00', closes: '21:00' },
    ])
  })

  it('returns one window on a day with a single service', () => {
    expect(resolveKitchenWindows(SATURDAY)).toEqual([{ opens: '12:00', closes: '19:00' }])
  })

  it('clips a service that overhangs the kitchen close', () => {
    // Live shape: special_hours 2026-05-09 keeps kitchen bounds 13:00-19:00 with
    // inherited 'regular' services running 12:00-14:30 and 17:00-21:00. Those
    // gate drinks too, so the database allows them, but they must not extend the
    // kitchen's advertised hours.
    const narrowedKitchen = {
      is_closed: false,
      is_kitchen_closed: false,
      kitchen_opens: '13:00:00',
      kitchen_closes: '19:00:00',
      schedule_config: [
        { name: 'lunch', starts_at: '12:00', ends_at: '14:30', capacity: 50, booking_type: 'regular' },
        { name: 'dinner', starts_at: '17:00', ends_at: '21:00', capacity: 50, booking_type: 'regular' },
      ],
    }
    expect(resolveKitchenWindows(narrowedKitchen)).toEqual([
      { opens: '13:00', closes: '14:30' },
      { opens: '17:00', closes: '19:00' },
    ])

    const windows = resolveKitchenWindows(narrowedKitchen)
    expect(kitchenWindowAt(windows, '12:15:00')).toBeNull()
    expect(kitchenWindowAt(windows, '20:30:00')).toBeNull()
  })

  it('drops a service lying entirely outside the kitchen hours', () => {
    const drinksOnlySlot = {
      is_closed: false,
      is_kitchen_closed: false,
      kitchen_opens: '13:00:00',
      kitchen_closes: '15:00:00',
      schedule_config: [
        { name: 'late drinks', starts_at: '20:00', ends_at: '22:00', capacity: 50, booking_type: 'regular' },
      ],
    }
    // Nothing bookable for food, which is what the availability engine concludes.
    expect(resolveKitchenWindows(drinksOnlySlot)).toEqual([])
  })

  it('treats absent kitchen bounds as closed even when a service is left behind', () => {
    // Staff use null bounds to mean "kitchen closed for the day" while an old
    // service can still be sitting on the row.
    const noBounds = {
      is_closed: false,
      is_kitchen_closed: false,
      kitchen_opens: null,
      kitchen_closes: null,
      schedule_config: [
        { name: 'dinner', starts_at: '17:00', ends_at: '21:00', capacity: 50, booking_type: 'regular' },
      ],
    }
    expect(resolveKitchenWindows(noBounds)).toEqual([])
  })

  it('falls back to the kitchen bounds when no services are listed', () => {
    expect(
      resolveKitchenWindows({ ...SATURDAY, schedule_config: [] }),
    ).toEqual([{ opens: '12:00:00', closes: '19:00:00' }])
  })

  it('reports nothing when the kitchen is flagged closed', () => {
    expect(resolveKitchenWindows({ ...SEPTEMBER_WEEKDAY, is_kitchen_closed: true })).toEqual([])
  })

  it('reports nothing when the venue is closed all day', () => {
    expect(resolveKitchenWindows({ ...SEPTEMBER_WEEKDAY, is_closed: true })).toEqual([])
  })

  it('merges services that run straight into each other', () => {
    const continuous = {
      ...SEPTEMBER_WEEKDAY,
      schedule_config: [
        { name: 'Lunch', starts_at: '12:00', ends_at: '15:00', capacity: 50, booking_type: 'regular' },
        { name: 'Dinner', starts_at: '15:00', ends_at: '21:00', capacity: 50, booking_type: 'regular' },
      ],
    }
    expect(resolveKitchenWindows(continuous)).toEqual([{ opens: '12:00', closes: '21:00' }])
  })

  it('keeps a late service that runs past midnight', () => {
    const halloween = {
      ...SEPTEMBER_WEEKDAY,
      kitchen_opens: '12:00:00',
      kitchen_closes: '00:00:00',
      schedule_config: [
        { name: 'Full menu', starts_at: '12:00', ends_at: '18:00', capacity: 50, booking_type: 'regular' },
        { name: 'Pizza only', starts_at: '21:00', ends_at: '00:00', capacity: 50, booking_type: 'regular' },
      ],
    }
    expect(resolveKitchenWindows(halloween)).toEqual([
      { opens: '12:00', closes: '18:00' },
      { opens: '21:00', closes: '00:00' },
    ])
  })

  it('rejects a service that ends before it starts at a daytime hour', () => {
    const broken = {
      ...SEPTEMBER_WEEKDAY,
      schedule_config: [
        { name: 'Nonsense', starts_at: '21:00', ends_at: '16:00', capacity: 50, booking_type: 'regular' },
      ],
    }
    // Nothing usable, so the stored bounds stand in rather than a 19-hour service.
    expect(resolveKitchenWindows(broken)).toEqual([{ opens: '12:00:00', closes: '21:00:00' }])
  })
})

describe('kitchenWindowAt', () => {
  const windows = resolveKitchenWindows(SEPTEMBER_WEEKDAY)

  it('reports the kitchen shut during the afternoon closure', () => {
    // The defect this module exists to prevent: 15:30 sits between services.
    expect(kitchenWindowAt(windows, '15:30:00')).toBeNull()
    expect(kitchenWindowAt(windows, '15:00:00')).toBeNull()
  })

  it('reports the lunch sitting while it is being served', () => {
    expect(kitchenWindowAt(windows, '13:00:00')).toEqual({ opens: '12:00', closes: '15:00' })
    expect(kitchenWindowAt(windows, '12:00:00')).toEqual({ opens: '12:00', closes: '15:00' })
  })

  it('reports the dinner sitting once it starts', () => {
    expect(kitchenWindowAt(windows, '16:00:00')).toEqual({ opens: '16:00', closes: '21:00' })
    expect(kitchenWindowAt(windows, '20:59:00')).toEqual({ opens: '16:00', closes: '21:00' })
  })

  it('reports the kitchen shut before and after the day', () => {
    expect(kitchenWindowAt(windows, '11:00:00')).toBeNull()
    expect(kitchenWindowAt(windows, '21:00:00')).toBeNull()
    expect(kitchenWindowAt(windows, '23:30:00')).toBeNull()
  })

  it('still serves in the small hours of a window that ran past midnight', () => {
    const late = [{ opens: '21:00', closes: '01:00' }]
    expect(kitchenWindowAt(late, '23:30:00')).toEqual(late[0])
    expect(kitchenWindowAt(late, '00:30:00')).toEqual(late[0])
    expect(kitchenWindowAt(late, '01:30:00')).toBeNull()
  })
})

describe('nextKitchenWindowAfter', () => {
  const windows = resolveKitchenWindows(SEPTEMBER_WEEKDAY)

  it('names the dinner sitting during the gap', () => {
    expect(nextKitchenWindowAfter(windows, '15:30:00')).toEqual({ opens: '16:00', closes: '21:00' })
  })

  it('names the lunch sitting before service starts', () => {
    expect(nextKitchenWindowAfter(windows, '09:00:00')).toEqual({ opens: '12:00', closes: '15:00' })
  })

  it('returns nothing once the last sitting has started', () => {
    expect(nextKitchenWindowAfter(windows, '17:00:00')).toBeNull()
  })
})

describe('describeKitchenWindows', () => {
  it('lists every sitting rather than one span', () => {
    expect(describeKitchenWindows(resolveKitchenWindows(SEPTEMBER_WEEKDAY))).toBe(
      '12:00 - 15:00, 16:00 - 21:00',
    )
  })

  it('is empty when the kitchen is closed', () => {
    expect(describeKitchenWindows([])).toBe('')
  })
})
