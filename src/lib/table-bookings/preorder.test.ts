import { describe, expect, it } from 'vitest'
import {
  describePreorderGaps,
  emptyPreorderDishTotals,
  formatPreorderAddonPrice,
  formatPreorderMoney,
  getCoverAddons,
  getCoverCourse,
  getPreorderCompleteness,
  isCoverComplete,
  isPreorderCourse,
  isPreorderSelectionCourse,
  summariseCoverAddons,
  summariseOrderAddons,
  summarisePreorderDishTotals,
} from './preorder'
import type {
  PreorderCover,
  PreorderSelection,
  PreorderSelectionCourse,
} from '@/types/preorders'

/**
 * THE COMPLETENESS RULE IS THE WHOLE FEATURE, and it is one sentence: every cover must have a main.
 *
 * Two earlier designs modelled each course as "chosen / declined / not answered" so that an
 * unanswered starter could be chased. With only the main required, "not chosen" and "declined" mean
 * exactly the same thing for every optional course, and the distinction bought nothing while costing
 * a great deal. These tests pin the simple rule so nobody reintroduces the complicated one: a cover
 * with a main and nothing else is FINISHED, not half done.
 */

function selection(
  course: PreorderSelectionCourse,
  itemName: string,
  overrides: Partial<PreorderSelection> = {},
): PreorderSelection {
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

  // The cheeseboard is an EXTRA, not a pudding. Folding it into the dessert list would have the
  // kitchen make one pudding too few and would hide the money the pub is owed for it.
  it('counts add-ons on their own list, never inside a course', () => {
    const totals = summarisePreorderDishTotals({
      date: '2026-12-12',
      bookingCount: 1,
      coverCount: 2,
      selections: [
        { course: 'main', menuItemId: 'item-turkey', itemName: 'Roast turkey', priceGbp: null },
        { course: 'main', menuItemId: 'item-turkey', itemName: 'Roast turkey', priceGbp: null },
        {
          course: 'dessert',
          menuItemId: 'item-pudding',
          itemName: 'Christmas pudding',
          priceGbp: null,
        },
        {
          course: 'addon',
          menuItemId: 'item-cheese',
          itemName: 'Farmhouse cheeseboard',
          priceGbp: 8.5,
        },
        {
          course: 'addon',
          menuItemId: 'item-cheese',
          itemName: 'Farmhouse cheeseboard',
          priceGbp: 8.5,
        },
        { course: 'addon', menuItemId: 'item-port', itemName: 'Glass of port', priceGbp: 4.2 },
      ],
    })

    expect(totals.byCourse.dessert).toEqual([
      { menuItemId: 'item-pudding', itemName: 'Christmas pudding', count: 1 },
    ])
    expect(totals.addons).toEqual([
      {
        menuItemId: 'item-cheese',
        itemName: 'Farmhouse cheeseboard',
        count: 2,
        unitPriceGbp: 8.5,
        totalGbp: 17,
        hasUnpricedSelection: false,
      },
      {
        menuItemId: 'item-port',
        itemName: 'Glass of port',
        count: 1,
        unitPriceGbp: 4.2,
        totalGbp: 4.2,
        hasUnpricedSelection: false,
      },
    ])
    expect(totals.addonTotalGbp).toBe(21.2)
    expect(totals.addonHasUnpricedSelection).toBe(false)
  })

  // Every Christmas item is unpriced today, so this is the normal case rather than an edge one. The
  // total must not read as though the extras are free.
  it('flags an unpriced add-on rather than counting it as nothing', () => {
    const totals = summarisePreorderDishTotals({
      date: '2026-12-12',
      bookingCount: 1,
      coverCount: 1,
      selections: [
        {
          course: 'addon',
          menuItemId: 'item-cheese',
          itemName: 'Farmhouse cheeseboard',
          priceGbp: null,
        },
      ],
    })

    expect(totals.addons[0]).toEqual({
      menuItemId: 'item-cheese',
      itemName: 'Farmhouse cheeseboard',
      count: 1,
      unitPriceGbp: null,
      totalGbp: 0,
      hasUnpricedSelection: true,
    })
    expect(totals.addonHasUnpricedSelection).toBe(true)
  })

  // Prices are snapshots. If the owner puts the cheeseboard up mid-season, the two guests were owed
  // two different amounts and the day's total is the sum of both, not two times either one.
  it('totals a re-priced add-on from the individual snapshots', () => {
    const totals = summarisePreorderDishTotals({
      date: '2026-12-12',
      bookingCount: 2,
      coverCount: 3,
      selections: [
        {
          course: 'addon',
          menuItemId: 'item-cheese',
          itemName: 'Farmhouse cheeseboard',
          priceGbp: 8.5,
        },
        {
          course: 'addon',
          menuItemId: 'item-cheese',
          itemName: 'Farmhouse cheeseboard',
          priceGbp: 8.5,
        },
        {
          course: 'addon',
          menuItemId: 'item-cheese',
          itemName: 'Farmhouse cheeseboard',
          priceGbp: 9.5,
        },
      ],
    })

    expect(totals.addons[0].count).toBe(3)
    expect(totals.addons[0].totalGbp).toBe(26.5)
    // The label is what most guests were quoted, not an average nobody paid.
    expect(totals.addons[0].unitPriceGbp).toBe(8.5)
  })

  it('returns empty add-on totals for a date with nothing on it', () => {
    expect(emptyPreorderDishTotals('2026-12-12')).toEqual({
      date: '2026-12-12',
      bookingCount: 0,
      coverCount: 0,
      byCourse: { starter: [], main: [], dessert: [] },
      addons: [],
      addonTotalGbp: 0,
      addonHasUnpricedSelection: false,
    })
  })
})

/**
 * ADD-ONS ARE EXTRAS, AND THEY ARE NEVER REQUIRED.
 *
 * The farmhouse cheeseboard was listed as a dessert, so ticking it cost the guest their pudding. The
 * fix is a fourth kind of selection that sits alongside the three courses rather than inside them,
 * is multi-select, and is invisible to the completeness rule. These tests pin all three, because
 * every one of them is a thing a future change could plausibly get wrong in a way nobody sees until
 * a guest is short a pudding or the pub is short the money.
 */
describe('add-ons and completeness', () => {
  it('counts a seat with a main and no add-ons as complete', () => {
    expect(isCoverComplete(cover(1, [selection('main', 'Roast turkey')]))).toBe(true)
  })

  it('does not count a seat with an add-on and no main as complete', () => {
    expect(isCoverComplete(cover(1, [selection('addon', 'Farmhouse cheeseboard')]))).toBe(false)
  })

  it('leaves a whole booking complete when nobody has ticked an add-on', () => {
    const order = {
      partySize: 2,
      covers: [cover(1, [selection('main', 'Roast turkey')]), cover(2, [selection('main', 'Beef')])],
    }

    expect(getPreorderCompleteness(order).complete).toBe(true)
    expect(describePreorderGaps(getPreorderCompleteness(order))).toBe('All courses chosen.')
  })

  it('still reports the missing main on a seat that has ticked add-ons', () => {
    const order = {
      partySize: 2,
      covers: [
        cover(1, [selection('main', 'Roast turkey')]),
        cover(2, [selection('addon', 'Farmhouse cheeseboard'), selection('addon', 'Glass of port')]),
      ],
    }

    const completeness = getPreorderCompleteness(order)

    expect(completeness.complete).toBe(false)
    expect(completeness.ordinalsMissingMain).toEqual([2])
  })

  // A seat holds one dessert. It may hold any number of add-ons. That asymmetry is the feature.
  it('keeps several add-ons on one seat while the dessert stays a single answer', () => {
    const seat = cover(1, [
      selection('main', 'Roast turkey'),
      selection('dessert', 'Christmas pudding'),
      selection('addon', 'Farmhouse cheeseboard'),
      selection('addon', 'Glass of port'),
    ])

    expect(getCoverAddons(seat).map((entry) => entry.itemName)).toEqual([
      'Farmhouse cheeseboard',
      'Glass of port',
    ])
    expect(getCoverCourse(seat, 'dessert')?.itemName).toBe('Christmas pudding')
  })

  it('separates the single-choice courses from everything a selection may be', () => {
    expect(isPreorderCourse('dessert')).toBe(true)
    // The guard that stops an add-on being offered as a course a guest picks instead of a pudding.
    expect(isPreorderCourse('addon')).toBe(false)
    expect(isPreorderSelectionCourse('addon')).toBe(true)
    expect(isPreorderSelectionCourse('side')).toBe(false)
  })
})

describe('add-on money', () => {
  it('totals one seat from the snapshotted prices', () => {
    const seat = cover(1, [
      selection('main', 'Roast turkey', { priceGbp: 24.95 }),
      selection('addon', 'Farmhouse cheeseboard', { priceGbp: 8.5 }),
      selection('addon', 'Glass of port', { priceGbp: 4.2 }),
    ])

    const summary = summariseCoverAddons(seat)

    expect(summary.count).toBe(2)
    // The main is not an add-on and must never reach the extras bill.
    expect(summary.totalGbp).toBe(12.7)
    expect(summary.hasUnpricedAddon).toBe(false)
    expect(summary.items.map((item) => item.itemName)).toEqual([
      'Farmhouse cheeseboard',
      'Glass of port',
    ])
  })

  it('says so when a ticked add-on carries no price', () => {
    const seat = cover(1, [
      selection('addon', 'Farmhouse cheeseboard', { priceGbp: null }),
      selection('addon', 'Glass of port', { priceGbp: 4.2 }),
    ])

    const summary = summariseCoverAddons(seat)

    expect(summary.totalGbp).toBe(4.2)
    expect(summary.hasUnpricedAddon).toBe(true)
  })

  it('gives a per-seat and a per-booking total, keeping seats that ticked nothing', () => {
    const order = {
      covers: [
        cover(2, [selection('addon', 'Glass of port', { priceGbp: 4.2 })]),
        cover(1, [
          selection('main', 'Roast turkey'),
          selection('addon', 'Farmhouse cheeseboard', { priceGbp: 8.5 }),
        ]),
        cover(3, [selection('main', 'Beef')]),
      ],
    }

    const summary = summariseOrderAddons(order)

    expect(summary.count).toBe(2)
    expect(summary.totalGbp).toBe(12.7)
    expect(summary.perCover.map((entry) => entry.ordinal)).toEqual([1, 2, 3])
    expect(summary.perCover[0].totalGbp).toBe(8.5)
    expect(summary.perCover[2]).toMatchObject({ ordinal: 3, count: 0, totalGbp: 0 })
  })

  // Adding pounds as floating point makes 8.10 + 4.20 come out at 12.299999999999999, and a bill a
  // penny out is exactly what a guest notices at the till.
  it('adds money in pence so the total does not drift', () => {
    const seat = cover(1, [
      selection('addon', 'Cheeseboard', { priceGbp: 8.1 }),
      selection('addon', 'Port', { priceGbp: 4.2 }),
      selection('addon', 'Mince pies', { priceGbp: 3.7 }),
    ])

    expect(summariseCoverAddons(seat).totalGbp).toBe(16)
  })

  it('renders an unpriced add-on as a promise to price it, never as free', () => {
    expect(formatPreorderAddonPrice(8.5)).toBe('£8.50')
    expect(formatPreorderAddonPrice(null)).toBe('Price on the day')
    expect(formatPreorderMoney(12.7)).toBe('£12.70')
  })
})
