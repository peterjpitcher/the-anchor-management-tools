import { describe, expect, it } from 'vitest'

import {
  applyCalendarFilters,
  entryGaps,
  EMPTY_CALENDAR_FILTERS,
  isFilterActive,
  type CalendarFilters,
} from '../filters'
import type { CalendarEntry, CalendarEntryContent, CalendarEntryKind } from '../types'

function entry(
  overrides: Partial<CalendarEntry> & { kind: CalendarEntryKind }
): CalendarEntry {
  return {
    id: overrides.id ?? 'e1',
    kind: overrides.kind,
    title: overrides.title ?? 'Entry',
    start: new Date('2026-08-11T19:00:00'),
    end: new Date('2026-08-11T21:00:00'),
    allDay: false,
    spansMultipleDays: false,
    endsNextDay: false,
    color: '#000000',
    subtitle: null,
    status: overrides.status ?? 'scheduled',
    statusLabel: overrides.statusLabel ?? null,
    content: overrides.content,
    tooltipData: {
      kind: 'event',
      name: 'Entry',
      time: '19:00',
      bookedSeats: 0,
      category: null,
      status: overrides.status ?? 'scheduled',
    },
    onClickHref: null,
  }
}

const complete: CalendarEntryContent = { hasImage: true, hasBrief: true, hasDescription: true }
const noArtwork: CalendarEntryContent = { hasImage: false, hasBrief: true, hasDescription: true }
const noBrief: CalendarEntryContent = { hasImage: true, hasBrief: false, hasDescription: true }

const filters = (patch: Partial<CalendarFilters> = {}): CalendarFilters => ({
  ...EMPTY_CALENDAR_FILTERS,
  ...patch,
})

describe('calendar filters', () => {
  it('returns everything when nothing is selected', () => {
    const entries = [entry({ kind: 'event' }), entry({ kind: 'private_booking', id: 'p1' })]
    expect(applyCalendarFilters(entries, EMPTY_CALENDAR_FILTERS)).toHaveLength(2)
    expect(isFilterActive(EMPTY_CALENDAR_FILTERS)).toBe(false)
  })

  it('narrows to the selected kinds, so private hire can be viewed on its own', () => {
    const entries = [
      entry({ kind: 'event', id: 'e1' }),
      entry({ kind: 'private_booking', id: 'p1' }),
      entry({ kind: 'parking', id: 'k1' }),
    ]
    const result = applyCalendarFilters(entries, filters({ kinds: ['private_booking'] }))
    expect(result.map((e) => e.id)).toEqual(['p1'])
  })

  it('hides cancelled entries only when asked', () => {
    const entries = [
      entry({ kind: 'event', id: 'live' }),
      entry({ kind: 'event', id: 'dead', status: 'cancelled' }),
    ]
    expect(applyCalendarFilters(entries, EMPTY_CALENDAR_FILTERS)).toHaveLength(2)
    expect(applyCalendarFilters(entries, filters({ hideCancelled: true })).map((e) => e.id)).toEqual([
      'live',
    ])
  })

  it('surfaces only events missing the selected content', () => {
    const entries = [
      entry({ kind: 'event', id: 'ready', content: complete }),
      entry({ kind: 'event', id: 'needs-art', content: noArtwork }),
      entry({ kind: 'event', id: 'needs-brief', content: noBrief }),
    ]
    expect(applyCalendarFilters(entries, filters({ missing: ['image'] })).map((e) => e.id)).toEqual([
      'needs-art',
    ])
    expect(applyCalendarFilters(entries, filters({ missing: ['brief'] })).map((e) => e.id)).toEqual([
      'needs-brief',
    ])
  })

  it('treats several content filters as "missing any of these"', () => {
    const entries = [
      entry({ kind: 'event', id: 'ready', content: complete }),
      entry({ kind: 'event', id: 'needs-art', content: noArtwork }),
      entry({ kind: 'event', id: 'needs-brief', content: noBrief }),
    ]
    const result = applyCalendarFilters(entries, filters({ missing: ['image', 'brief'] }))
    expect(result.map((e) => e.id).sort()).toEqual(['needs-art', 'needs-brief'])
  })

  it('drops entries that carry no content record when a content filter is on', () => {
    // A private booking has no artwork to be missing, so it must not appear in a
    // list of events that still need artwork.
    const entries = [
      entry({ kind: 'event', id: 'needs-art', content: noArtwork }),
      entry({ kind: 'private_booking', id: 'p1' }),
    ]
    expect(applyCalendarFilters(entries, filters({ missing: ['image'] })).map((e) => e.id)).toEqual([
      'needs-art',
    ])
  })

  it('combines kind and content filters', () => {
    const entries = [
      entry({ kind: 'event', id: 'needs-art', content: noArtwork }),
      entry({ kind: 'private_booking', id: 'p1' }),
    ]
    const result = applyCalendarFilters(
      entries,
      filters({ kinds: ['private_booking'], missing: ['image'] })
    )
    expect(result).toHaveLength(0)
  })

  it('reports the gaps an entry has, for the warning chips', () => {
    expect(entryGaps(entry({ kind: 'event', content: complete }))).toEqual([])
    expect(entryGaps(entry({ kind: 'event', content: noArtwork }))).toEqual(['image'])
    expect(
      entryGaps(
        entry({
          kind: 'event',
          content: { hasImage: false, hasBrief: false, hasDescription: false },
        })
      )
    ).toEqual(['image', 'brief', 'description'])
    expect(entryGaps(entry({ kind: 'private_booking' }))).toEqual([])
  })
})
