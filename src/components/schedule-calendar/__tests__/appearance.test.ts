import { describe, expect, it } from 'vitest'
import {
  CALENDAR_KIND_APPEARANCE,
  calendarColourNeedsLightText,
  kindColor,
  kindLabel,
} from '../appearance'

describe('calendar appearance', () => {
  it('uses the agreed colour-blind-friendly colour for each item type', () => {
    expect(CALENDAR_KIND_APPEARANCE).toEqual({
      event: { color: '#1E3A8A', label: 'Events', shortLabel: 'Event' },
      private_booking: { color: '#9333EA', label: 'Private bookings', shortLabel: 'Private' },
      balance_due: { color: '#F97316', label: 'Balance due', shortLabel: 'Due' },
      birthday: { color: '#FACC15', label: 'Birthdays', shortLabel: 'Birthday' },
      special_hours: { color: '#111827', label: 'Special hours', shortLabel: 'Hours' },
      calendar_note: { color: '#7DD3FC', label: 'Calendar notes', shortLabel: 'Note' },
      parking: { color: '#16A34A', label: 'Parking', shortLabel: 'Parking' },
    })
  })

  it('provides labels and colours for the legend and filters', () => {
    expect(kindColor('calendar_note')).toBe('#7DD3FC')
    expect(kindLabel('private_booking')).toBe('Private bookings')
  })

  it('uses light text only on the darkest colours', () => {
    expect(calendarColourNeedsLightText('#1E3A8A')).toBe(true)
    expect(calendarColourNeedsLightText('#9333ea')).toBe(true)
    expect(calendarColourNeedsLightText('#111827')).toBe(true)
    expect(calendarColourNeedsLightText('#16A34A')).toBe(false)
    expect(calendarColourNeedsLightText('#FACC15')).toBe(false)
  })
})
