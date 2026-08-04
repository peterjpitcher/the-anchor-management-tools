import { describe, expect, it } from 'vitest'
import {
  describePreorderGaps,
  getPreorderCompleteness,
  isCoverComplete,
  summarisePreorderDishTotals,
} from './preorder'
import type { PreorderCover, PreorderCourse, PreorderSelection } from '@/types/preorders'

/**
 * THE COMPLETENESS RULE IS THE WHOLE FEATURE, and it is one sentence: every cover must have a main.
 *
 * Two earlier designs modelled each course as "chosen / declined / not answered" so that an
 * unanswered starter could be chased. With only the main required, "not chosen" and "declined" mean
 * exactly the same thing for every optional course, and the distinction bought nothing while costing
 * a great deal. These tests pin the simple rule so nobody reintroduces the complicated one: a cover
 * with a main and nothing else is FINISHED, not half done.
 */

function selection(course: PreorderCourse, itemName: string, overrides: Partial<PreorderSelection> = {}): PreorderSelection {
  return {
    id: `sel-${course}-${itemName}`,
    coverId: 'cover-1',
    course,
    menuItemId: `item-${itemName.toLowerCase().replace(/\s+/g, '-')}`,
    itemName,
    priceGbp: null,
    itemWithdrawn: false,
    createdAt: '2026-11-20T12:00:00Z',
    updatedAt: '2026-11-20T12:00:00Z',
    ...overrides,
  }
}

function cover(ordinal: number, selections: PreorderSelection[]): PreorderCover {
  return {
    id: `cover-${ordinal}`,
    tableBookingId: 'booking-1',
    ordinal,
    guestName: null,
    dietaryNote: null,
    selections: selections.map((entry) => ({ ...entry, coverId: `cover-${ordinal}` })),
    createdAt: '2026-11-20T12:00:00Z',
    updatedAt: '2026-11-20T12:00:00Z',
  }
}

describe('isCoverComplete', () => {
  it('counts a cover with only a main as complete', () => {
    expect(isCoverComplete(cover(1, [selection('main', 'Roast turkey')]))).toBe(true)
  })

  it('does not count a cover with a starter and no main as complete', () => {
    expect(isCoverComplete(cover(1, [selection('starter', 'Soup')]))).toBe(false)
  })

  it('does not count an empty cover as complete', () => {
    expect(isCoverComplete(cover(1, []))).toBe(false)
  })

  it('counts three courses as complete, same as one', () => {
    const threeCourses = cover(1, [
      selection('starter', 'Soup'),
      selection('main', 'Roast turkey'),
      selection('dessert', 'Christmas pudding'),
    ])
    expect(isCoverComplete(threeCourses)).toBe(true)
  })
})

describe('getPreorderCompleteness', () => {
  it('treats a party with mixed course counts as complete when every seat has a main', () => {
    const order = {
      partySize: 3,
      covers: [
        cover(1, [
          selection('starter', 'Soup'),
          selection('main', 'Roast turkey'),
          selection('dessert', 'Christmas pudding'),
        ]),
        cover(2, [selection('main', 'Nut roast')]),
        cover(3, [selection('main', 'Beef'), selection('dessert', 'Cheeseboard')]),
      ],
    }

    const completeness = getPreorderCompleteness(order)

    expect(completeness.complete).toBe(true)
    expect(completeness.ordinalsMissingMain).toEqual([])
    expect(describePreorderGaps(completeness)).toBe('All courses chosen.')
  })

  it('names the seats with no main', () => {
    const order = {
      partySize: 3,
      covers: [
        cover(1, [selection('main', 'Roast turkey')]),
        cover(2, [selection('starter', 'Soup')]),
        cover(3, []),
      ],
    }

    const completeness = getPreorderCompleteness(order)

    expect(completeness.complete).toBe(false)
    expect(completeness.ordinalsMissingMain).toEqual([2, 3])
    expect(describePreorderGaps(completeness)).toBe('no main chosen for seat 2, 3.')
  })

  it('is incomplete when there are fewer seats than the party size, even if every seat has a main', () => {
    const order = {
      partySize: 4,
      covers: [cover(1, [selection('main', 'Roast turkey')]), cover(2, [selection('main', 'Beef')])],
    }

    const completeness = getPreorderCompleteness(order)

    expect(completeness.complete).toBe(false)
    expect(completeness.coverCount).toBe(2)
    expect(describePreorderGaps(completeness)).toBe('2 of 4 seats have no order started.')
  })

  // A withdrawn dish is a phone call for a manager, not a chase message. If it flipped `complete`,
  // the reminder cron would message every affected booker the moment a dish went off, which the
  // spec rules out by name.
  it('reports a withdrawn dish without making the booking incomplete', () => {
    const order = {
      partySize: 2,
      covers: [
        cover(1, [selection('main', 'Roast turkey', { itemWithdrawn: true })]),
        cover(2, [selection('main', 'Beef')]),
      ],
    }

    const completeness = getPreorderCompleteness(order)

    expect(completeness.complete).toBe(true)
    expect(completeness.ordinalsWithWithdrawnChoice).toEqual([1])
  })
})

describe('summarisePreorderDishTotals', () => {
  it('groups by course and puts the busiest dish first', () => {
    const totals = summarisePreorderDishTotals({
      date: '2026-12-12',
      bookingCount: 2,
      coverCount: 5,
      selections: [
        { course: 'main', menuItemId: 'item-turkey', itemName: 'Roast turkey' },
        { course: 'main', menuItemId: 'item-turkey', itemName: 'Roast turkey' },
        { course: 'main', menuItemId: 'item-turkey', itemName: 'Roast turkey' },
        { course: 'main', menuItemId: 'item-beef', itemName: 'Beef' },
        { course: 'starter', menuItemId: 'item-soup', itemName: 'Soup' },
        { course: 'dessert', menuItemId: 'item-pudding', itemName: 'Christmas pudding' },
        { course: 'dessert', menuItemId: 'item-pudding', itemName: 'Christmas pudding' },
      ],
    })

    expect(totals.date).toBe('2026-12-12')
    expect(totals.coverCount).toBe(5)
    expect(totals.byCourse.main).toEqual([
      { menuItemId: 'item-turkey', itemName: 'Roast turkey', count: 3 },
      { menuItemId: 'item-beef', itemName: 'Beef', count: 1 },
    ])
    expect(totals.byCourse.starter).toEqual([
      { menuItemId: 'item-soup', itemName: 'Soup', count: 1 },
    ])
    expect(totals.byCourse.dessert).toEqual([
      { menuItemId: 'item-pudding', itemName: 'Christmas pudding', count: 2 },
    ])
  })

  it('returns an empty list per course when nothing has been chosen', () => {
    const totals = summarisePreorderDishTotals({
      date: '2026-12-12',
      bookingCount: 0,
      coverCount: 0,
      selections: [],
    })

    expect(totals.byCourse).toEqual({ starter: [], main: [], dessert: [] })
  })

  // Names are snapshots. A dish renamed mid-season would otherwise appear as two lines and the
  // kitchen would cook the wrong quantity of both.
  it('keeps a renamed dish as one line, labelled with the name most guests chose', () => {
    const totals = summarisePreorderDishTotals({
      date: '2026-12-12',
      bookingCount: 1,
      coverCount: 3,
      selections: [
        { course: 'main', menuItemId: 'item-turkey', itemName: 'Roast turkey' },
        { course: 'main', menuItemId: 'item-turkey', itemName: 'Roast turkey' },
        { course: 'main', menuItemId: 'item-turkey', itemName: 'Turkey dinner' },
      ],
    })

    expect(totals.byCourse.main).toEqual([
      { menuItemId: 'item-turkey', itemName: 'Roast turkey', count: 3 },
    ])
  })

  // The same dish sold as both a starter and a main is one dish to order but two lines to prep.
  it('keeps one dish appearing on two courses on separate lines', () => {
    const totals = summarisePreorderDishTotals({
      date: '2026-12-12',
      bookingCount: 1,
      coverCount: 2,
      selections: [
        { course: 'starter', menuItemId: 'item-prawns', itemName: 'Prawn cocktail' },
        { course: 'main', menuItemId: 'item-prawns', itemName: 'Prawn cocktail' },
      ],
    })

    expect(totals.byCourse.starter).toEqual([
      { menuItemId: 'item-prawns', itemName: 'Prawn cocktail', count: 1 },
    ])
    expect(totals.byCourse.main).toEqual([
      { menuItemId: 'item-prawns', itemName: 'Prawn cocktail', count: 1 },
    ])
  })
})
