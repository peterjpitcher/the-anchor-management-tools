import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '../../../tests/helpers/fakeSupabase'
import {
  PreorderCourseLimitError,
  describeCoverMissingCourses,
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
  loadPreorderDishTotals,
  savePreorderCover,
  summariseChristmasTiers,
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

describe('snapshotted Christmas course completeness', () => {
  it('exempts one course but preserves old missing-tier records', () => {
    expect(isCoverComplete({ ...cover(1, []), courseCount: 1 })).toBe(true)
    expect(isCoverComplete({ ...cover(1, []), courseCount: null })).toBe(false)
  })
  it('requires the exact chosen number of courses, including a main', () => {
    const main = selection('main', 'Fixture main')
    const starter = selection('starter', 'Fixture starter')
    const dessert = selection('dessert', 'Fixture dessert')
    expect(isCoverComplete({ ...cover(1, [main]), courseCount: 2 })).toBe(false)
    expect(isCoverComplete({ ...cover(1, [main, starter]), courseCount: 2 })).toBe(true)
    expect(isCoverComplete({ ...cover(1, [starter, dessert]), courseCount: 2 })).toBe(false)
    expect(isCoverComplete({ ...cover(1, [main, starter]), courseCount: 3 })).toBe(false)
    expect(isCoverComplete({ ...cover(1, [main, starter, dessert]), courseCount: 3 })).toBe(true)
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
    // Was 'course choices incomplete for seat 2, 3.', which never said WHAT was missing (BK-055).
    // The manager escalation reads this sentence out on the telephone, so it now names the course.
    expect(describePreorderGaps(completeness)).toBe('Seat 2 needs a main. Seat 3 needs a main.')
  })

  it('is incomplete when there are fewer seats than the party size, even if every seat has a main', () => {
    const order = {
      partySize: 4,
      covers: [cover(1, [selection('main', 'Roast turkey')]), cover(2, [selection('main', 'Beef')])],
    }

    const completeness = getPreorderCompleteness(order)

    expect(completeness.complete).toBe(false)
    expect(completeness.coverCount).toBe(2)
    expect(completeness.seatsWithoutCover).toEqual([3, 4])
    // Was '2 of 4 seats have no order started.' A seat with no row owes every course its tier pays
    // for, so it is now named with what it needs, like any other incomplete seat (BK-055).
    expect(describePreorderGaps(completeness)).toBe('Seat 3 needs a main. Seat 4 needs a main.')
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
      // Added for BK-058 and BK-051: tiers, unpaid holds, late changes and withdrawn dishes, all empty.
      pendingPaymentBookingCount: 0,
      lateChangeCount: 0,
      christmasTiers: { oneCourse: 0, twoCourses: 0, threeCourses: 0, notRecorded: 0, guests: 0 },
      withdrawn: [],
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

/**
 * BK-055: the forms, the alerts and the save follow each guest's Christmas tier. 3 courses owes a
 * starter, a main and a dessert; 2 courses owes a main plus a starter or a dessert, and never both;
 * 1 course owes nothing. A booking with no tiers recorded keeps the old main-only rule.
 */
describe('Christmas course tiers', () => {
  const starter = selection('starter', 'Fixture starter')
  const main = selection('main', 'Fixture main')
  const dessert = selection('dessert', 'Fixture dessert')

  it('says what a 3 course seat still needs', () => {
    expect(describeCoverMissingCourses({ selections: [main], courseCount: 3 })).toBe('a starter and a dessert')
    expect(describeCoverMissingCourses({ selections: [starter, main], courseCount: 3 })).toBe('a dessert')
    expect(describeCoverMissingCourses({ selections: [], courseCount: 3 })).toBe('a starter, a main and a dessert')
    expect(describeCoverMissingCourses({ selections: [starter, main, dessert], courseCount: 3 })).toBeNull()
  })

  it('says what a 2 course seat still needs, and flags a starter and a dessert together', () => {
    expect(describeCoverMissingCourses({ selections: [main], courseCount: 2 })).toBe('a starter or a dessert')
    expect(describeCoverMissingCourses({ selections: [dessert], courseCount: 2 })).toBe('a main')
    expect(describeCoverMissingCourses({ selections: [], courseCount: 2 })).toBe('a main, plus a starter or a dessert')
    expect(describeCoverMissingCourses({ selections: [main, dessert], courseCount: 2 })).toBeNull()
    expect(describeCoverMissingCourses({ selections: [starter, main, dessert], courseCount: 2 })).toBe(
      'only one of the starter and the dessert',
    )
  })

  it('owes nothing on 1 course, and keeps the main-only rule with no tier', () => {
    expect(describeCoverMissingCourses({ selections: [], courseCount: 1 })).toBeNull()
    expect(describeCoverMissingCourses({ selections: [], courseCount: null })).toBe('a main')
    expect(describeCoverMissingCourses({ selections: [main], courseCount: null })).toBeNull()
  })

  it('names each seat, its tier and the missing course for the staff screen and the escalation', () => {
    const order = {
      partySize: 4,
      courseCounts: [3, 2, 1, 3] as Array<1 | 2 | 3>,
      covers: [cover(1, [main, starter]), cover(2, [main]), cover(3, [])],
    }

    const completeness = getPreorderCompleteness(order)

    expect(completeness.complete).toBe(false)
    expect(completeness.ordinalsMissingMain).toEqual([1, 2, 4])
    expect(completeness.seatsWithoutCover).toEqual([4])
    expect(describePreorderGaps(completeness)).toBe(
      'Seat 1 (3 courses) needs a dessert. Seat 2 (2 courses) needs a starter or a dessert. ' +
        'Seat 4 (3 courses) needs a starter, a main and a dessert.',
    )
  })

  it('treats a booking as complete when every seat has its tier, 1 course seats included', () => {
    const order = {
      partySize: 3,
      courseCounts: [3, 2, 1] as Array<1 | 2 | 3>,
      covers: [cover(1, [starter, main, dessert]), cover(2, [main, dessert])],
    }

    expect(getPreorderCompleteness(order).complete).toBe(true)
  })
})

describe('savePreorderCover follows the seat tier (BK-055)', () => {
  const BOOKING = 'booking-tiers'

  function db(courseCounts: number[] | null, existing: Array<{ course: string; menu_item_id: string }>) {
    return createFakeSupabase({
      table_bookings: [{ id: BOOKING, booking_period_id: 'period-1', christmas_course_counts: courseCounts }],
      booking_preorder_covers: [
        { id: 'cover-2', table_booking_id: BOOKING, ordinal: 2, guest_name: null, dietary_note: null, created_at: 'x', updated_at: 'x' },
      ],
      booking_preorder_selections: existing.map((row, index) => ({
        id: `existing-${index}`,
        cover_id: 'cover-2',
        item_name: row.menu_item_id,
        price_gbp: null,
        created_at: 'x',
        updated_at: 'x',
        ...row,
      })),
      booking_period_menu_items: [
        { id: 'starter-1', period_id: 'period-1', name: 'Fixture starter', course: 'starter', price_gbp: null, is_active: true },
        { id: 'main-1', period_id: 'period-1', name: 'Fixture main', course: 'main', price_gbp: null, is_active: true },
        { id: 'dessert-1', period_id: 'period-1', name: 'Fixture dessert', course: 'dessert', price_gbp: null, is_active: true },
      ],
    })
  }

  function heldCourses(fake: ReturnType<typeof db>): string[] {
    return fake.tables.booking_preorder_selections.map((row) => row.course).sort()
  }

  it('refuses a dessert on a 2 course seat that already has a main and a starter, and writes nothing', async () => {
    const fake = db([3, 2, 1, 1], [
      { course: 'main', menu_item_id: 'main-1' },
      { course: 'starter', menu_item_id: 'starter-1' },
    ])

    const save = savePreorderCover(fake as never, {
      coverId: 'cover-2',
      guestName: 'Changed name',
      selections: [{ course: 'dessert', menuItemId: 'dessert-1' }],
    })

    await expect(save).rejects.toBeInstanceOf(PreorderCourseLimitError)
    await expect(save).rejects.toThrow('Seat 2 is on 2 courses: choose a main, plus a starter or a dessert, not both.')
    expect(heldCourses(fake)).toEqual(['main', 'starter'])
    // Refused before anything was written, the name included.
    expect(fake.tables.booking_preorder_covers[0].guest_name).toBeNull()
  })

  it('lets a 2 course seat swap its starter for a dessert in one save', async () => {
    const fake = db([3, 2, 1, 1], [
      { course: 'main', menu_item_id: 'main-1' },
      { course: 'starter', menu_item_id: 'starter-1' },
    ])

    await savePreorderCover(fake as never, {
      coverId: 'cover-2',
      selections: [
        { course: 'starter', menuItemId: null },
        { course: 'dessert', menuItemId: 'dessert-1' },
      ],
    })

    expect(heldCourses(fake)).toEqual(['dessert', 'main'])
  })

  it('takes all three courses on a 3 course seat', async () => {
    const fake = db([1, 3, 1, 1], [])

    await savePreorderCover(fake as never, {
      coverId: 'cover-2',
      selections: [
        { course: 'starter', menuItemId: 'starter-1' },
        { course: 'main', menuItemId: 'main-1' },
        { course: 'dessert', menuItemId: 'dessert-1' },
      ],
    })

    expect(heldCourses(fake)).toEqual(['dessert', 'main', 'starter'])
  })

  it('refuses any course on a 1 course seat', async () => {
    const fake = db([3, 1, 3, 3], [])

    await expect(
      savePreorderCover(fake as never, { coverId: 'cover-2', selections: [{ course: 'main', menuItemId: 'main-1' }] }),
    ).rejects.toThrow('Seat 2 is on 1 course, so there is nothing to choose in advance.')
    expect(heldCourses(fake)).toEqual([])
  })

  it('keeps the old rule on a booking with no tiers: three courses are allowed', async () => {
    const fake = db(null, [{ course: 'main', menu_item_id: 'main-1' }])

    await savePreorderCover(fake as never, {
      coverId: 'cover-2',
      selections: [
        { course: 'starter', menuItemId: 'starter-1' },
        { course: 'dessert', menuItemId: 'dessert-1' },
      ],
    })

    expect(heldCourses(fake)).toEqual(['dessert', 'main', 'starter'])
  })
})

/**
 * BK-058: the kitchen totals keep withdrawn dishes out of the counts, list them apart, and count
 * Christmas guests by tier from the bookings themselves, because an all 1 course booking has no seats.
 */
describe('kitchen totals by tier', () => {
  it('lists a withdrawn dish apart and never counts it as a plate to cook', () => {
    const totals = summarisePreorderDishTotals({
      date: '2026-12-12',
      bookingCount: 1,
      coverCount: 2,
      selections: [
        { course: 'main', menuItemId: 'item-a', itemName: 'Fixture main' },
        { course: 'main', menuItemId: 'item-b', itemName: 'Withdrawn main', itemWithdrawn: true },
        { course: 'main', menuItemId: 'item-b', itemName: 'Withdrawn main', itemWithdrawn: true },
      ],
    })

    expect(totals.byCourse.main).toEqual([{ menuItemId: 'item-a', itemName: 'Fixture main', count: 1 }])
    expect(totals.withdrawn).toEqual([
      { course: 'main', menuItemId: 'item-b', itemName: 'Withdrawn main', count: 2 },
    ])
  })

  it('tallies guests by tier, and counts a booking with no tiers as not recorded', () => {
    expect(
      summariseChristmasTiers([
        { partySize: 4, courseCounts: [3, 3, 2, 1] },
        { partySize: 5, courseCounts: [1, 1, 1, 1, 1] },
        { partySize: 6, courseCounts: null },
      ]),
    ).toEqual({ oneCourse: 6, twoCourses: 1, threeCourses: 2, notRecorded: 6, guests: 15 })
  })

  it('loads a day: tiers from bookings with no seats, withdrawn dishes apart, unpaid holds counted', async () => {
    const fake = createFakeSupabase({
      table_bookings: [
        { id: 'b-1', booking_date: '2026-12-12', status: 'confirmed', booking_type: 'christmas', party_size: 4, christmas_course_counts: [3, 2, 1, 1] },
        { id: 'b-2', booking_date: '2026-12-12', status: 'confirmed', booking_type: 'christmas', party_size: 4, christmas_course_counts: [1, 1, 1, 1] },
        { id: 'b-3', booking_date: '2026-12-12', status: 'pending_payment', booking_type: 'christmas', party_size: 4, christmas_course_counts: [3, 3, 3, 3] },
        { id: 'b-4', booking_date: '2026-12-12', status: 'confirmed', booking_type: 'regular', party_size: 2, christmas_course_counts: null },
      ],
      booking_preorder_covers: [
        { id: 'c-1', table_booking_id: 'b-1', ordinal: 1 },
        { id: 'c-2', table_booking_id: 'b-1', ordinal: 2 },
        { id: 'c-3', table_booking_id: 'b-3', ordinal: 1 },
      ],
      booking_preorder_selections: [
        { cover_id: 'c-1', course: 'main', menu_item_id: 'item-a', item_name: 'Fixture main', price_gbp: null },
        { cover_id: 'c-2', course: 'main', menu_item_id: 'item-b', item_name: 'Withdrawn main', price_gbp: null },
        { cover_id: 'c-3', course: 'main', menu_item_id: 'item-a', item_name: 'Fixture main', price_gbp: null },
      ],
      booking_period_menu_items: [
        { id: 'item-a', is_active: true },
        { id: 'item-b', is_active: false },
      ],
    })

    const totals = await loadPreorderDishTotals(fake as never, '2026-12-12')

    expect(totals.christmasTiers).toEqual({ oneCourse: 6, twoCourses: 1, threeCourses: 5, notRecorded: 0, guests: 12 })
    expect(totals.byCourse.main).toEqual([{ menuItemId: 'item-a', itemName: 'Fixture main', count: 2 }])
    expect(totals.withdrawn).toEqual([{ course: 'main', menuItemId: 'item-b', itemName: 'Withdrawn main', count: 1 }])
    expect(totals.pendingPaymentBookingCount).toBe(1)
  })

  // BK-051: choices a manager recorded after the cutoff are counted, and the totals say how many.
  it('counts the choices recorded after the cutoff', async () => {
    const fake = createFakeSupabase({
      table_bookings: [
        { id: 'b-1', booking_date: '2026-12-12', status: 'confirmed', booking_type: 'christmas', party_size: 4, christmas_course_counts: [3, 3, 1, 1], booking_period_id: 'p-1' },
      ],
      booking_periods: [{ id: 'p-1', preorder_cutoff_days: 7 }],
      booking_preorder_covers: [
        { id: 'c-1', table_booking_id: 'b-1', ordinal: 1 },
        { id: 'c-2', table_booking_id: 'b-1', ordinal: 2 },
      ],
      booking_preorder_selections: [
        { cover_id: 'c-1', course: 'main', menu_item_id: 'item-a', item_name: 'Fixture main', price_gbp: null, created_at: '2026-12-05T11:00:00Z' },
        { cover_id: 'c-2', course: 'main', menu_item_id: 'item-a', item_name: 'Fixture main', price_gbp: null, created_at: '2026-12-05T12:30:00Z' },
      ],
      booking_period_menu_items: [{ id: 'item-a', is_active: true }],
    })

    const totals = await loadPreorderDishTotals(fake as never, '2026-12-12')

    expect(totals.byCourse.main).toEqual([{ menuItemId: 'item-a', itemName: 'Fixture main', count: 2 }])
    expect(totals.lateChangeCount).toBe(1)
  })

  it('still reports the tiers on a day where every Christmas guest is on 1 course', async () => {
    const fake = createFakeSupabase({
      table_bookings: [
        { id: 'b-1', booking_date: '2026-12-12', status: 'confirmed', booking_type: 'christmas', party_size: 4, christmas_course_counts: [1, 1, 1, 1] },
      ],
    })

    const totals = await loadPreorderDishTotals(fake as never, '2026-12-12')

    expect(totals.coverCount).toBe(0)
    expect(totals.christmasTiers.oneCourse).toBe(4)
  })
})
