import { describe, expect, it } from 'vitest'
import {
  bookingHasGuestSeats,
  buildBookingSheetModel,
  buildBookingSheetSeats,
  buildBookingSheetTally,
  canDownloadBookingSheet,
  canViewBookingSheet,
  describeChoicesStatus,
  describeChristmasTiers,
  describeSheetDeposit,
} from '@/lib/table-bookings/booking-sheet'
import { resolveSheetDeposit, type BookingSheetRow } from '@/lib/table-bookings/booking-sheet-load'
import type { UserPermission } from '@/types/rbac'
import { bookingFacts, christmasOrder, cover, selection } from './fixture'

function permission(module_name: string, action: string): UserPermission {
  return { module_name, action } as UserPermission
}

describe('buildBookingSheetTally', () => {
  const tally = buildBookingSheetTally(christmasOrder())
  const course = (name: 'starter' | 'main' | 'dessert') => tally.courses.find((entry) => entry.course === name)!

  it('counts guests on every tier, 0 included', () => {
    expect(tally.tiers).toEqual({ three: 1, two: 2, one: 2, notChosen: 1 })
  })

  it('counts each dish per course, keeping kids mains and withdrawn dishes apart', () => {
    expect(course('starter').dishes).toEqual([{ name: 'Fixture soup', count: 1 }])
    expect(course('main').dishes).toEqual([{ name: 'Fixture turkey', count: 2 }])
    expect(tally.kidsMains).toEqual([{ name: 'Fixture kids turkey', count: 1 }])
    expect(course('main').offMenu).toEqual([{ name: 'Fixture beef', count: 1 }])
    expect(course('dessert').dishes).toEqual([{ name: 'Fixture pudding', count: 2 }])
    expect(tally.extras).toEqual([{ name: 'Fixture cheeseboard', count: 1 }])
  })

  it('counts "not chosen" only where the tier needs that course', () => {
    // Seats 5 (1 course, nothing saved) and 6 (tier 0) have no main; every tier needs one.
    expect(course('main').notChosen).toBe(2)
    // Only seat 1 is on 3 courses, and it has both.
    expect(course('starter').notChosen).toBe(0)
    expect(course('dessert').notChosen).toBe(0)
    // Seat 3 is on 2 courses with neither a starter nor a dessert.
    expect(tally.starterOrDessertNotChosen).toBe(1)
  })

  it('counts a missing starter and dessert on 3 courses', () => {
    const order = christmasOrder({
      partySize: 1,
      courseCounts: [3],
      covers: [cover(1, { selections: [selection('c1', 'main', 'm-turkey', 'Fixture turkey')] })],
    })
    const result = buildBookingSheetTally(order)
    expect(result.courses.map((entry) => [entry.course, entry.notChosen])).toEqual([
      ['starter', 1],
      ['main', 0],
      ['dessert', 1],
    ])
  })

  it('has no tier tally on an older booking with no course list, and still needs a main', () => {
    const order = christmasOrder({ partySize: 2, courseCounts: null, covers: [cover(1)] })
    const result = buildBookingSheetTally(order)
    expect(result.tiers).toBeNull()
    expect(result.courses.find((entry) => entry.course === 'main')?.notChosen).toBe(2)
  })
})

describe('buildBookingSheetSeats', () => {
  const seats = buildBookingSheetSeats(christmasOrder())

  it('gives one row per guest, seats with no cover included', () => {
    expect(seats.map((seat) => seat.seat)).toEqual([1, 2, 3, 4, 5, 6])
    expect(seats[4]).toEqual(
      expect.objectContaining({
        name: 'No name yet',
        courses: '1 course',
        main: { text: 'Not chosen', state: 'missing' },
        starter: { text: 'Not included', state: 'not_included' },
        allergy: { state: 'not_answered', text: 'Not answered' },
      }),
    )
  })

  it('says what each course cell holds in words, not colour', () => {
    expect(seats[0].allergy).toEqual({ state: 'yes', text: 'Yes: Peanuts' })
    expect(seats[0].extras).toBe('Fixture cheeseboard')
    expect(seats[1].main).toEqual({ text: 'Fixture beef (off the menu, ring the guest)', state: 'off_menu' })
    expect(seats[1].starter).toEqual({ text: 'Not included', state: 'not_included' })
    expect(seats[1].dietary).toBe('No mushrooms')
    expect(seats[2].starter).toEqual({ text: 'Starter or dessert not chosen', state: 'missing' })
    expect(seats[2].dessert).toEqual({ text: 'Starter or dessert not chosen', state: 'missing' })
    expect(seats[3].main).toEqual({ text: 'Fixture kids turkey (kids main)', state: 'chosen' })
    expect(seats[5].courses).toBe('Not chosen yet')
    expect(seats[5].starter).toEqual({ text: 'Courses not chosen yet', state: 'missing' })
  })

  it('marks a seat a manager changed after the noon cutoff', () => {
    const order = christmasOrder({
      partySize: 1,
      courseCounts: [1],
      covers: [
        cover(1, {
          selections: [selection('c1', 'main', 'm-turkey', 'Fixture turkey', { createdAt: '2026-12-11T09:00:00Z' })],
        }),
      ],
    })
    expect(buildBookingSheetSeats(order)[0].lateChange).toBe(true)
  })
})

describe('describeChoicesStatus', () => {
  it('counts complete seats against the party', () => {
    expect(describeChoicesStatus(christmasOrder())).toBe('3 of 6 chosen, 3 missing')
  })

  it('says all chosen when every seat is complete', () => {
    const order = christmasOrder({
      partySize: 1,
      courseCounts: [1],
      covers: [
        cover(1, {
          guestName: 'Guest One',
          hasAllergies: false,
          selections: [selection('c1', 'main', 'm-turkey', 'Fixture turkey')],
        }),
      ],
    })
    expect(describeChoicesStatus(order)).toBe('All 1 chosen')
  })

  it('has its own line for a booking with no pre-order', () => {
    expect(describeChoicesStatus(null)).toBe('No food choices for this booking')
  })
})

describe('buildBookingSheetModel', () => {
  it('builds the header in London time with the deposit to take off', () => {
    const model = buildBookingSheetModel({ booking: bookingFacts(), order: christmasOrder() })
    expect(model.header).toEqual(
      expect.objectContaining({
        time: '7pm',
        reference: 'TB-FIXTURE',
        organiserName: 'Fixture Organiser',
        organiserMobile: '+447700900000',
        tables: 'Dining Room 1, Dining Room 2',
        guests: '6',
        deposit: '£60.00 paid, take it off the bill',
        choices: '3 of 6 chosen, 3 missing',
      }),
    )
    expect(model.header.dayDate).toMatch(/Thursday/)
    expect(model.header.dayDate).toMatch(/17 December 2026/)
  })

  it('puts every guest allergy and every unanswered seat in the allergy box', () => {
    const model = buildBookingSheetModel({
      booking: bookingFacts({ allergies: ['Shellfish'], dietary: ['Vegan'] }),
      order: christmasOrder(),
    })
    expect(model.allergy).toEqual({
      bookingAllergies: ['Shellfish'],
      bookingDietary: ['Vegan'],
      bookingNotes: null,
      seatAllergies: ['Seat 1, Guest One: Peanuts'],
      seatsNotAnswered: [3, 5, 6],
      noneRecorded: false,
    })
  })

  it('sends notes that mention an allergen to the allergy box and the rest to the header', () => {
    const withAllergy = buildBookingSheetModel({ booking: bookingFacts({ notes: 'One coeliac guest' }), order: null })
    expect(withAllergy.allergy.bookingNotes).toBe('One coeliac guest')
    expect(withAllergy.allergy.noneRecorded).toBe(false)
    expect(withAllergy.header.notes).toBeNull()

    const plain = buildBookingSheetModel({ booking: bookingFacts({ notes: 'Birthday, cake at 9' }), order: null })
    expect(plain.allergy.bookingNotes).toBeNull()
    expect(plain.header.notes).toBe('Birthday, cake at 9')
  })

  it('gives a minimal sheet for a booking with no pre-order', () => {
    const model = buildBookingSheetModel({ booking: bookingFacts({ deposit: { kind: 'none' } }), order: null })
    expect(model.preorder).toBeNull()
    expect(model.allergy.noneRecorded).toBe(true)
    expect(model.allergy.seatsNotAnswered).toEqual([])
    expect(model.header.choices).toBe('No food choices for this booking')
    expect(model.header.deposit).toBe('No deposit')
  })
})

describe('deposit wording', () => {
  function row(overrides: Partial<BookingSheetRow> = {}): BookingSheetRow {
    return {
      id: 'b1',
      booking_reference: 'TB-FIXTURE',
      booking_date: '2026-12-17',
      booking_time: '19:00',
      party_size: 8,
      status: 'confirmed',
      booking_type: 'christmas',
      payment_status: 'completed',
      payment_method: 'paypal',
      deposit_waived: false,
      deposit_amount: 80,
      deposit_amount_locked: 80,
      deposit_refund_status: null,
      paypal_deposit_capture_id: 'CAP-1',
      hold_expires_at: null,
      seated_at: null,
      left_at: null,
      no_show_at: null,
      is_outside_seating: false,
      allergies: null,
      dietary_requirements: null,
      special_requirements: null,
      booking_period_answer: true,
      booking_period_requires_preorder: true,
      christmas_course_counts: null,
      customer: null,
      table_booking_tables: null,
      ...overrides,
    }
  }

  it('takes off what was paid less any refund, from the payment data', () => {
    expect(resolveSheetDeposit(row(), 0)).toEqual({ kind: 'paid', heldGbp: 80, refundsChecked: true })
    expect(resolveSheetDeposit(row({ payment_status: 'partial_refund' }), 20)).toEqual({ kind: 'paid', heldGbp: 60, refundsChecked: true })
    expect(resolveSheetDeposit(row(), 80)).toEqual({ kind: 'refunded' })
  })

  it('says when the refunds could not be read rather than assuming none', () => {
    const deposit = resolveSheetDeposit(row(), null)
    expect(deposit).toEqual({ kind: 'paid', heldGbp: 80, refundsChecked: false })
    expect(describeSheetDeposit(deposit)).toContain('refunds could not be checked')
  })

  it('takes nothing off a waived, unpaid or absent deposit', () => {
    expect(resolveSheetDeposit(row({ payment_status: null, deposit_waived: true, paypal_deposit_capture_id: null }), 0)).toEqual({ kind: 'waived' })
    expect(resolveSheetDeposit(row({ payment_status: 'pending', status: 'pending_payment', paypal_deposit_capture_id: null }), 0)).toEqual({ kind: 'unpaid' })
    expect(
      resolveSheetDeposit(row({ payment_status: null, booking_type: 'regular', party_size: 4, deposit_amount: null, deposit_amount_locked: null, paypal_deposit_capture_id: null }), 0),
    ).toEqual({ kind: 'none' })
    expect(describeSheetDeposit({ kind: 'waived' })).toBe('Deposit waived, nothing to take off')
    expect(describeSheetDeposit({ kind: 'unpaid' })).toBe('Deposit not paid, nothing to take off')
  })
})

describe('describeChristmasTiers', () => {
  it('says how many guests have not chosen their courses yet', () => {
    expect(describeChristmasTiers([3, 3, 2, 1, 0, 0])).toBe('2 x 3 courses, 1 x 2 courses, 1 x 1 course, 2 not chosen yet')
    expect(describeChristmasTiers([0, 0])).toBe('2 not chosen yet')
    expect(describeChristmasTiers(null)).toBe('')
  })
})

describe('bookingHasGuestSeats', () => {
  it('follows the booking snapshot: accepted, and a pre-order or a course list', () => {
    expect(bookingHasGuestSeats({ booking_period_answer: true, booking_period_requires_preorder: true, christmas_course_counts: null })).toBe(true)
    expect(bookingHasGuestSeats({ booking_period_answer: true, booking_period_requires_preorder: false, christmas_course_counts: [0, 0] })).toBe(true)
    expect(bookingHasGuestSeats({ booking_period_answer: false, booking_period_requires_preorder: true, christmas_course_counts: [1] })).toBe(false)
    expect(bookingHasGuestSeats({ booking_period_answer: true, booking_period_requires_preorder: false, christmas_course_counts: null })).toBe(false)
  })
})

// Owner decision D14: front of house views on screen; only BOH and managers download.
describe('sheet permissions', () => {
  const fohLogin = [permission('table_bookings', 'view'), permission('table_bookings', 'edit'), permission('checklists', 'view')]
  const bohStaff = [permission('table_bookings', 'view'), permission('events', 'view')]
  const manager = [permission('table_bookings', 'view'), permission('table_bookings', 'manage'), permission('customers', 'manage')]

  it('lets the shared FOH login view but not download', () => {
    expect(canViewBookingSheet(fohLogin)).toBe(true)
    expect(canDownloadBookingSheet(fohLogin)).toBe(false)
  })

  it('lets BOH staff and managers view and download', () => {
    expect(canDownloadBookingSheet(bohStaff)).toBe(true)
    expect(canDownloadBookingSheet(manager)).toBe(true)
  })

  it('refuses both without table_bookings view', () => {
    expect(canViewBookingSheet([permission('events', 'view')])).toBe(false)
    expect(canDownloadBookingSheet([permission('events', 'view')])).toBe(false)
    expect(canDownloadBookingSheet([])).toBe(false)
  })
})
