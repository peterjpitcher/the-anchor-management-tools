import { describe, expect, it } from 'vitest'
import { rightSizeMoveOptions, MOVE_OPTION_SLACK_SEATS } from '@/lib/table-bookings/move-table'

function option(name: string, capacity: number | null) {
  return { name, capacity }
}

describe('rightSizeMoveOptions', () => {
  it('drops options far larger than the party needs', () => {
    // The case from the floor: a table of 2 was being offered a four-table join
    // seating 22 alongside the sensible choices.
    const options = [
      option('Low 4a', 4),
      option('Big Bay', 6),
      option('Low 4a + Low 4b', 8),
      option('Dining Room 4a + 6a + 6b + 6c', 22),
    ]

    expect(rightSizeMoveOptions(options, 2).map((o) => o.name)).toEqual(['Low 4a', 'Big Bay'])
  })

  it('keeps the joins a large party actually needs, and drops tables too small to sit them', () => {
    const options = [option('Big Bay', 6), option('Low 4a + Low 4b', 8), option('4a + 6a', 10)]

    expect(rightSizeMoveOptions(options, 8).map((o) => o.name)).toEqual([
      'Low 4a + Low 4b',
      '4a + 6a',
    ])
  })

  it('falls back to the full list when nothing is big enough', () => {
    const options = [option('Low 4a', 4), option('Big Bay', 6)]

    expect(rightSizeMoveOptions(options, 12).map((o) => o.name)).toEqual(['Low 4a', 'Big Bay'])
  })

  it('still offers oversized tables when nothing smaller is free', () => {
    // Better an over-large table than telling staff there is nowhere to move to.
    const options = [option('Dining Room 6a + 6b + 6c', 18), option('Everything', 22)]

    expect(rightSizeMoveOptions(options, 2).map((o) => o.name)).toEqual([
      'Dining Room 6a + 6b + 6c',
    ])
  })

  it('allows exactly the slack, and no more', () => {
    const partySize = 4
    const atLimit = option('at limit', partySize + MOVE_OPTION_SLACK_SEATS)
    const overLimit = option('over limit', partySize + MOVE_OPTION_SLACK_SEATS + 1)

    const kept = rightSizeMoveOptions([option('exact', 4), atLimit, overLimit], partySize)
    expect(kept.map((o) => o.name)).toEqual(['exact', 'at limit'])
  })

  it('treats a missing capacity as zero, so it is not offered over a real table', () => {
    // Upstream already drops zero-capacity tables; this just pins the fallback
    // so an unknown capacity can never be suggested ahead of one that fits.
    const kept = rightSizeMoveOptions([option('unknown', null), option('big', 20)], 2)
    expect(kept.map((o) => o.name)).toEqual(['big'])
  })

  it('returns an empty list unchanged', () => {
    expect(rightSizeMoveOptions([], 4)).toEqual([])
  })
})
