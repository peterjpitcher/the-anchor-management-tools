import type { PreorderCover, PreorderOrder, PreorderSelection } from '@/types/preorders'
import type { BookingSheetBookingFacts } from '@/lib/table-bookings/booking-sheet'

/** Fixture data only: no real guests. */
const STAMP = '2026-11-20T10:00:00Z'

export function selection(
  coverId: string,
  course: PreorderSelection['course'],
  menuItemId: string,
  itemName: string,
  extra: Partial<PreorderSelection> = {},
): PreorderSelection {
  return {
    id: `${coverId}-${menuItemId}`,
    coverId,
    course,
    menuItemId,
    itemName,
    priceGbp: null,
    itemWithdrawn: false,
    isChildOption: false,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  }
}

export function cover(ordinal: number, extra: Partial<PreorderCover> = {}): PreorderCover {
  return {
    id: `c${ordinal}`,
    tableBookingId: 'b1',
    ordinal,
    guestName: null,
    dietaryNote: null,
    hasAllergies: null,
    allergyDetail: null,
    selections: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  }
}

/**
 * Six guests across every tier: seat 1 on 3 courses with an allergy and an extra, seats 2 and 3 on
 * 2 courses (seat 2's main since withdrawn, seat 3 with neither starter nor dessert), seat 4 on 1
 * course with a kids main, seat 5 on 1 course with nothing saved, seat 6 not chosen yet.
 */
export function christmasOrder(overrides: Partial<PreorderOrder> = {}): PreorderOrder {
  return {
    tableBookingId: 'b1',
    bookingReference: 'TB-FIXTURE',
    bookingDate: '2026-12-17',
    bookingTime: '19:00',
    partySize: 6,
    requiresPreorder: true,
    hasGuestSeats: true,
    bookingAllergies: [],
    periodId: 'period-1',
    periodName: 'Christmas',
    preorderCutoffDays: 7,
    courseCounts: [3, 2, 2, 1, 1, 0],
    menuItems: [],
    covers: [
      cover(1, {
        guestName: 'Guest One',
        hasAllergies: true,
        allergyDetail: 'Peanuts',
        selections: [
          selection('c1', 'starter', 'm-soup', 'Fixture soup'),
          selection('c1', 'main', 'm-turkey', 'Fixture turkey'),
          selection('c1', 'dessert', 'm-pud', 'Fixture pudding'),
          selection('c1', 'addon', 'm-cheese', 'Fixture cheeseboard'),
        ],
      }),
      cover(2, {
        guestName: 'Guest Two',
        hasAllergies: false,
        dietaryNote: 'No mushrooms',
        selections: [
          selection('c2', 'main', 'm-beef', 'Fixture beef', { itemWithdrawn: true }),
          selection('c2', 'dessert', 'm-pud', 'Fixture pudding'),
        ],
      }),
      cover(3, { guestName: 'Guest Three', selections: [selection('c3', 'main', 'm-turkey', 'Fixture turkey')] }),
      cover(4, {
        guestName: 'Guest Four',
        hasAllergies: false,
        selections: [selection('c4', 'main', 'm-kids', 'Fixture kids turkey', { isChildOption: true })],
      }),
      cover(6),
    ],
    ...overrides,
  }
}

export function bookingFacts(overrides: Partial<BookingSheetBookingFacts> = {}): BookingSheetBookingFacts {
  return {
    id: 'b1',
    reference: 'TB-FIXTURE',
    bookingDate: '2026-12-17',
    bookingTime: '19:00:00',
    partySize: 6,
    statusLabel: 'Booked',
    organiserName: 'Fixture Organiser',
    organiserMobile: '+447700900000',
    tableLabel: 'Dining Room 1, Dining Room 2',
    allergies: [],
    dietary: [],
    notes: null,
    deposit: { kind: 'paid', heldGbp: 60, refundsChecked: true },
    ...overrides,
  }
}
