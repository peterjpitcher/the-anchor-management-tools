import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreorderCover, PreorderOrder, PreorderSeatCourseCount, PreorderSelection } from '@/types/preorders'

const mocks = vi.hoisted(() => ({
  saveSeasonalPreorderCovers: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/features/table-bookings/preorder/actions', () => ({
  saveSeasonalPreorderCovers: mocks.saveSeasonalPreorderCovers,
  syncSeasonalPreorderCovers: vi.fn(async () => ({ success: true })),
  sendPreorderFoodLink: vi.fn(async () => ({ success: true })),
  copyPreorderFoodLink: vi.fn(async () => ({ success: true, url: 'https://example.test/l' })),
}))

import SeasonalPreorderSection, {
  applySeatTierChange,
  type DraftCover,
  type PreorderMenuOption,
} from '@/components/features/table-bookings/preorder/SeasonalPreorderSection'

/**
 * The staff seat editor for a Christmas booking on the food link (spec section 3.5, D8, D15): every
 * seat has a name, an allergy answer, a number of courses (0 to 3) and the dishes that tier pays for.
 * BK-055 history: the card used to say a main would do for everyone, so staff told a 3 course guest
 * that a main was enough.
 */

const STAMP = { createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z' }

function choice(course: PreorderSelection['course'], menuItemId: string, itemName: string): PreorderSelection {
  return { id: `sel-${menuItemId}`, coverId: 'x', course, menuItemId, itemName, priceGbp: null, itemWithdrawn: false, ...STAMP }
}

function seat(
  ordinal: number,
  courseCount: PreorderSeatCourseCount | null,
  selections: PreorderSelection[],
  extra: Partial<PreorderCover> = {},
): PreorderCover {
  return {
    id: `cover-${ordinal}`,
    tableBookingId: 'booking-1',
    ordinal,
    // Named, with the allergy question answered, so the badges are about courses alone.
    guestName: `Fixture guest ${ordinal}`,
    hasAllergies: false,
    allergyDetail: null,
    dietaryNote: null,
    courseCount,
    selections: selections.map((entry) => ({ ...entry, coverId: `cover-${ordinal}` })),
    ...STAMP,
    ...extra,
  }
}

const MENU: PreorderMenuOption[] = [
  { id: 'starter-1', course: 'starter', name: 'Fixture starter', priceGbp: null },
  { id: 'main-1', course: 'main', name: 'Fixture main', priceGbp: null },
  { id: 'kids-main-1', course: 'main', name: 'Fixture kids main', priceGbp: null },
  { id: 'dessert-1', course: 'dessert', name: 'Fixture dessert', priceGbp: null },
]

function order(courseCounts: PreorderSeatCourseCount[] | null, covers: PreorderCover[]): PreorderOrder {
  return {
    tableBookingId: 'booking-1',
    bookingReference: 'TB-FIXTURE',
    bookingDate: '2026-12-12',
    bookingTime: '19:00',
    partySize: covers.length,
    requiresPreorder: true,
    hasGuestSeats: true,
    bookingAllergies: [],
    periodId: 'period-1',
    periodName: 'Christmas dinner 2026',
    preorderCutoffDays: 7,
    courseCounts,
    menuItems: [
      { id: 'starter-1', course: 'starter', name: 'Fixture starter', isActive: true, isChildOption: false },
      { id: 'main-1', course: 'main', name: 'Fixture main', isActive: true, isChildOption: false },
      { id: 'kids-main-1', course: 'main', name: 'Fixture kids main', isActive: true, isChildOption: true },
      { id: 'dessert-1', course: 'dessert', name: 'Fixture dessert', isActive: true, isChildOption: false },
    ],
    covers,
  }
}

function renderCard(value: PreorderOrder, props: Partial<{ closed: boolean; canRecordLate: boolean }> = {}) {
  return render(
    <SeasonalPreorderSection
      order={value}
      menu={MENU}
      canEdit
      preorderEnabled
      closed={props.closed ?? false}
      closesAtIso={props.closed ? '2026-12-05T12:00:00.000Z' : null}
      canRecordLate={props.canRecordLate}
    />,
  )
}

/** The list item for one seat, so a test can reach that seat's own fields. */
function seatItem(ordinal: number): HTMLElement {
  const heading = screen.getByText(new RegExp(`^Seat ${ordinal}( ·|$)`))
  const item = heading.closest('li')
  if (!item) throw new Error(`no list item for seat ${ordinal}`)
  return item
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.saveSeasonalPreorderCovers.mockResolvedValue({ success: true })
})

describe('SeasonalPreorderSection with Christmas tiers', () => {
  it('states the tier rule and badges each seat with what it is missing', () => {
    renderCard(
      order([3, 2, 1], [
        seat(1, 3, [choice('main', 'main-1', 'Fixture main')]),
        seat(2, 2, [choice('main', 'main-1', 'Fixture main')]),
        seat(3, 1, []),
      ]),
    )

    expect(screen.queryByText(/Every guest needs a main\./)).not.toBeInTheDocument()
    expect(screen.getByText(/a main on 1 course, a main plus a starter or a dessert on 2, and all three on 3/)).toBeInTheDocument()

    expect(screen.getByText('Seat 1 · 3 courses')).toBeInTheDocument()
    expect(screen.getByText('Needs a starter and a dessert')).toBeInTheDocument()
    expect(screen.getByText('Seat 2 · 2 courses')).toBeInTheDocument()
    expect(screen.getByText('Needs a starter or a dessert')).toBeInTheDocument()
    // A 1 course seat owes its main (D4): nothing is "chosen on the day" any more.
    expect(screen.getByText('Seat 3 · 1 course')).toBeInTheDocument()
    expect(screen.getByText('Needs a main')).toBeInTheDocument()
    expect(screen.queryByText(/on the day/)).not.toBeInTheDocument()

    expect(screen.getAllByLabelText('Guest name')).toHaveLength(3)
    expect(screen.getAllByLabelText('Courses')).toHaveLength(3)
    expect(screen.getAllByLabelText('Other dietary needs (optional)')).toHaveLength(3)
  })

  it('badges a seat with nothing chosen yet, and one that is complete', () => {
    renderCard(
      order([0, 1], [
        seat(1, 0, [], { guestName: null, hasAllergies: null }),
        seat(2, 1, [choice('main', 'main-1', 'Fixture main')]),
      ]),
    )

    expect(screen.getByText('Needs a name, their allergies, their number of courses and a main')).toBeInTheDocument()
    expect(within(seatItem(2)).getByText('Complete')).toBeInTheDocument()
  })

  it('says which seats the guest filled in and which have been invited', () => {
    renderCard(
      order([1, 1, 1], [
        seat(1, 1, [], { lastSavedBy: 'guest', lastSavedAt: '2026-11-02T10:00:00.000Z' }),
        seat(2, 1, [], { inviteSentAt: '2026-11-02T10:00:00.000Z' }),
        seat(3, 1, []),
      ]),
    )

    expect(within(seatItem(1)).getByText('Chosen by guest')).toBeInTheDocument()
    expect(within(seatItem(2)).getByText('Invited')).toBeInTheDocument()
    expect(within(seatItem(3)).queryByText('Invited')).not.toBeInTheDocument()
    expect(within(seatItem(3)).queryByText('Chosen by guest')).not.toBeInTheDocument()
  })

  it('offers a main only on 1 course, and all three courses on 3', () => {
    renderCard(order([1, 3], [seat(1, 1, []), seat(2, 3, [])]))

    expect(within(seatItem(1)).getByLabelText('Main (required)')).toBeInTheDocument()
    expect(within(seatItem(1)).queryByLabelText(/Starter/)).not.toBeInTheDocument()
    expect(within(seatItem(1)).queryByLabelText(/Dessert/)).not.toBeInTheDocument()
    expect(within(seatItem(2)).getByLabelText('Starter (required)')).toBeInTheDocument()
    expect(within(seatItem(2)).getByLabelText('Dessert (required)')).toBeInTheDocument()
  })

  it('labels the other course as one-of-two on 2 courses', () => {
    renderCard(order([2], [seat(1, 2, [])]))

    expect(screen.getByLabelText('Starter (or a dessert)')).toBeInTheDocument()
    expect(screen.getByLabelText('Dessert (or a starter)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Starter (optional)')).not.toBeInTheDocument()
  })

  it('offers kids mains on 1 course only', () => {
    renderCard(order([1, 3], [seat(1, 1, []), seat(2, 3, [])]))

    const oneCourseMain = within(seatItem(1)).getByLabelText('Main (required)')
    expect(within(oneCourseMain).getByRole('option', { name: /Fixture kids main \(kids, 1 course only\)/ })).toBeInTheDocument()
    const threeCourseMain = within(seatItem(2)).getByLabelText('Main (required)')
    expect(within(threeCourseMain).queryByRole('option', { name: /Fixture kids main/ })).not.toBeInTheDocument()
  })

  it('asks for the allergy details when a seat has allergies', () => {
    renderCard(order([1], [seat(1, 1, [choice('main', 'main-1', 'Fixture main')])]))

    expect(screen.queryByLabelText('Their allergies')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Has allergies'))

    expect(screen.getByLabelText('Their allergies')).toBeInTheDocument()
    expect(screen.getByText('Needs details of their allergies')).toBeInTheDocument()
  })

  it('keeps the old main-only wording on a booking with no tiers', () => {
    renderCard(order(null, [seat(1, null, [])]))

    expect(screen.getByText(/Every guest needs a main\. A starter and a dessert are optional/)).toBeInTheDocument()
    expect(screen.getByText('Needs a main')).toBeInTheDocument()
    expect(screen.getByLabelText('Starter (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Guest name (optional)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Courses')).not.toBeInTheDocument()
  })
})

describe('changing a seat’s number of courses', () => {
  const kids = new Set(['kids-main-1'])
  const draft = (courseCount: PreorderSeatCourseCount, choices: Partial<DraftCover['choices']>): DraftCover => ({
    guestName: 'Fixture guest',
    dietaryNote: '',
    courseCount,
    hasAllergies: false,
    allergyDetail: '',
    choices: { starter: '', main: '', dessert: '', ...choices },
    addonMenuItemIds: ['addon-1'],
  })

  it('clears the starter and dessert going down to 1 course or to none, and keeps the main', () => {
    for (const next of [0, 1] as const) {
      const result = applySeatTierChange(draft(3, { starter: 'starter-1', main: 'main-1', dessert: 'dessert-1' }), next, kids)
      expect(result.courseCount).toBe(next)
      expect(result.choices).toEqual({ starter: '', main: 'main-1', dessert: '' })
      expect(result.addonMenuItemIds).toEqual(['addon-1'])
    }
  })

  it('clears a kids main going up to 2 or 3 courses, and keeps an adult main', () => {
    expect(applySeatTierChange(draft(1, { main: 'kids-main-1' }), 2, kids).choices.main).toBe('')
    expect(applySeatTierChange(draft(1, { main: 'kids-main-1' }), 3, kids).choices.main).toBe('')
    expect(applySeatTierChange(draft(1, { main: 'main-1' }), 3, kids).choices.main).toBe('main-1')
  })

  it('keeps a starter and a dessert going from 3 to 2, for staff to pick which one stays', () => {
    const result = applySeatTierChange(draft(3, { starter: 'starter-1', main: 'main-1', dessert: 'dessert-1' }), 2, kids)
    expect(result.choices).toEqual({ starter: 'starter-1', main: 'main-1', dessert: 'dessert-1' })
  })

  it('shows the starter and dessert once a seat goes up to 3, and saves the new tier with them', async () => {
    renderCard(order([1], [seat(1, 1, [choice('main', 'main-1', 'Fixture main')])]))

    fireEvent.change(screen.getByLabelText('Courses'), { target: { value: '3' } })
    expect(screen.getByText('Seat 1 · 3 courses')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Starter (required)'), { target: { value: 'starter-1' } })
    fireEvent.change(screen.getByLabelText('Dessert (required)'), { target: { value: 'dessert-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 Seat' }))

    await waitFor(() => expect(mocks.saveSeasonalPreorderCovers).toHaveBeenCalledTimes(1))
    const [bookingId, payload] = mocks.saveSeasonalPreorderCovers.mock.calls[0]
    expect(bookingId).toBe('booking-1')
    expect(payload).toEqual([
      expect.objectContaining({
        coverId: 'cover-1',
        courseCount: 3,
        hasAllergies: false,
        // Only the courses that moved: the main is left alone, so its price snapshot is not re-quoted.
        selections: [
          { course: 'starter', menuItemId: 'starter-1' },
          { course: 'dessert', menuItemId: 'dessert-1' },
        ],
      }),
    ])
  })

  it('refuses to save a 2 course seat holding a starter and a dessert', async () => {
    renderCard(
      order([3], [
        seat(1, 3, [
          choice('starter', 'starter-1', 'Fixture starter'),
          choice('main', 'main-1', 'Fixture main'),
          choice('dessert', 'dessert-1', 'Fixture dessert'),
        ]),
      ]),
    )

    fireEvent.change(screen.getByLabelText('Courses'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 Seat' }))

    await waitFor(() => expect(screen.getByText('Needs only one of the starter and the dessert')).toBeInTheDocument())
    expect(mocks.saveSeasonalPreorderCovers).not.toHaveBeenCalled()
  })
})

// BK-051, owner decision D21: after the cutoff a manager can still record a change, marked as late.
describe('SeasonalPreorderSection after the cutoff', () => {
  const closedOrder = () => order([3], [seat(1, 3, [])])

  it('stays read-only for staff who are not managers, and says a manager records changes', () => {
    renderCard(closedOrder(), { closed: true })

    expect(screen.getByLabelText('Main (required)')).toBeDisabled()
    expect(screen.getByLabelText('Courses')).toBeDisabled()
    expect(screen.getByText(/a manager has to record any change now/)).toBeInTheDocument()
  })

  it('lets a manager change any seat, its number of courses included, and says it will be marked', () => {
    renderCard(closedOrder(), { closed: true, canRecordLate: true })

    expect(screen.getByLabelText('Main (required)')).not.toBeDisabled()
    expect(screen.getByLabelText('Courses')).not.toBeDisabled()
    expect(screen.getByText(/As a manager you can still change any seat/)).toBeInTheDocument()
  })
})
