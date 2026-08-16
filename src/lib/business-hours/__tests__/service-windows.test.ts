import { describe, expect, it } from 'vitest'
import {
  applyServiceWindows,
  describeGaps,
  readServiceWindows,
  validateServiceWindows,
} from '@/lib/business-hours/service-windows'
import type { ScheduleConfigItem } from '@/types/business-hours'

// The September schedule: lunch, a deliberate hour off, then dinner.
const SEPTEMBER = [
  { name: 'lunch', starts_at: '12:00', ends_at: '15:00' },
  { name: 'dinner', starts_at: '16:00', ends_at: '21:00' },
]

describe('validateServiceWindows', () => {
  it('accepts the split day the pub is moving to', () => {
    expect(validateServiceWindows(SEPTEMBER, '12:00:00', '21:00:00')).toEqual([])
  })

  it('accepts a single service covering the whole kitchen window', () => {
    expect(
      validateServiceWindows([{ name: 'food service', starts_at: '12:00', ends_at: '19:00' }], '12:00', '19:00'),
    ).toEqual([])
  })

  it('accepts no services at all, meaning the whole window is bookable', () => {
    expect(validateServiceWindows([], '12:00', '21:00')).toEqual([])
  })

  it('rejects a service starting before the kitchen opens', () => {
    const problems = validateServiceWindows(
      [{ name: 'lunch', starts_at: '11:00', ends_at: '15:00' }], '12:00', '21:00',
    )
    expect(problems[0].message).toContain('outside kitchen hours')
  })

  it('rejects a service ending after the kitchen closes', () => {
    const problems = validateServiceWindows(
      [{ name: 'dinner', starts_at: '16:00', ends_at: '22:00' }], '12:00', '21:00',
    )
    expect(problems[0].message).toContain('outside kitchen hours')
  })

  it('rejects an end that is not after the start', () => {
    expect(
      validateServiceWindows([{ name: 'x', starts_at: '15:00', ends_at: '15:00' }], '12:00', '21:00')[0].message,
    ).toContain('after the start')
  })

  it('rejects overlapping services', () => {
    const problems = validateServiceWindows(
      [
        { name: 'lunch', starts_at: '12:00', ends_at: '16:30' },
        { name: 'dinner', starts_at: '16:00', ends_at: '21:00' },
      ],
      '12:00',
      '21:00',
    )
    expect(problems.some(p => p.message.includes('overlaps'))).toBe(true)
  })

  it('spots an overlap regardless of the order they are listed in', () => {
    const problems = validateServiceWindows(
      [
        { name: 'dinner', starts_at: '16:00', ends_at: '21:00' },
        { name: 'lunch', starts_at: '12:00', ends_at: '16:30' },
      ],
      '12:00',
      '21:00',
    )
    expect(problems.some(p => p.message.includes('overlaps'))).toBe(true)
  })

  // The engine refuses an arrival within 30 minutes of a service ending, so a
  // shorter service has no bookable times at all and is a trap.
  it('rejects a service too short to hold any booking', () => {
    expect(
      validateServiceWindows([{ name: 'x', starts_at: '12:00', ends_at: '12:20' }], '12:00', '21:00')[0].message,
    ).toContain('cannot be booked')
  })

  it('asks for kitchen hours first when they are missing', () => {
    const problems = validateServiceWindows(SEPTEMBER, null, null)
    expect(problems[0].index).toBeNull()
    expect(problems[0].message).toContain('kitchen opening')
  })

  it('rejects a malformed time', () => {
    expect(
      validateServiceWindows([{ name: 'x', starts_at: '25:00', ends_at: '26:00' }], '12:00', '21:00')[0].message,
    ).toContain('start and end time')
  })

  it('copes with stored HH:MM:SS kitchen hours', () => {
    expect(validateServiceWindows(SEPTEMBER, '12:00:00', '21:00:00')).toEqual([])
  })
})

describe('describeGaps', () => {
  it('names the deliberate gap so it is visible before saving', () => {
    expect(describeGaps(SEPTEMBER, '12:00', '21:00')).toEqual(['15:00 to 16:00'])
  })

  it('is empty when one service covers the window', () => {
    expect(describeGaps([{ name: 'a', starts_at: '12:00', ends_at: '19:00' }], '12:00', '19:00')).toEqual([])
  })

  it('reports a tail after the last service', () => {
    expect(describeGaps([{ name: 'a', starts_at: '12:00', ends_at: '15:00' }], '12:00', '19:00')).toEqual([
      '15:00 to 19:00',
    ])
  })
})

describe('readServiceWindows and applyServiceWindows', () => {
  const withSundayLunch: ScheduleConfigItem[] = [
    { name: 'Sunday Lunch', starts_at: '13:00', ends_at: '18:00', capacity: 50, booking_type: 'sunday_lunch' },
    { name: 'dinner', starts_at: '17:00', ends_at: '21:00', capacity: 50, booking_type: 'regular' },
  ]

  it('reads only the ordinary services, leaving sunday lunch to its own control', () => {
    expect(readServiceWindows(withSundayLunch)).toEqual([
      { name: 'dinner', starts_at: '17:00', ends_at: '21:00' },
    ])
  })

  it('returns them in time order regardless of stored order', () => {
    const jumbled: ScheduleConfigItem[] = [
      { name: 'dinner', starts_at: '16:00', ends_at: '21:00', capacity: 50, booking_type: 'regular' },
      { name: 'lunch', starts_at: '12:00', ends_at: '15:00', capacity: 50, booking_type: 'regular' },
    ]
    expect(readServiceWindows(jumbled).map(s => s.name)).toEqual(['lunch', 'dinner'])
  })

  it('preserves the sunday lunch slot when the ordinary services are rewritten', () => {
    const result = applyServiceWindows(withSundayLunch, SEPTEMBER)
    expect(result.filter(r => r.booking_type === 'sunday_lunch')).toHaveLength(1)
    expect(result.filter(r => r.booking_type === 'regular')).toHaveLength(2)
  })

  it('carries the existing capacity onto new services', () => {
    const result = applyServiceWindows(withSundayLunch, SEPTEMBER)
    expect(result.filter(r => r.booking_type === 'regular').every(r => r.capacity === 50)).toBe(true)
  })

  it('names an unnamed service rather than storing an empty string', () => {
    const result = applyServiceWindows(null, [{ name: '  ', starts_at: '12:00', ends_at: '15:00' }])
    expect(result[0].name).toBe('food service')
  })

  it('round-trips the September schedule unchanged', () => {
    expect(readServiceWindows(applyServiceWindows(null, SEPTEMBER))).toEqual(SEPTEMBER)
  })

  it('clearing every service leaves an empty list, not a stale one', () => {
    const cleared = applyServiceWindows(
      [{ name: 'dinner', starts_at: '17:00', ends_at: '21:00', capacity: 50, booking_type: 'regular' }],
      [],
    )
    expect(cleared).toEqual([])
  })
})
