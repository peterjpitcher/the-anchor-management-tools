import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PreorderCover, PreorderOrder, PreorderSelection } from '@/types/preorders'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/features/table-bookings/preorder/actions', () => ({
  saveSeasonalPreorderCovers: vi.fn(async () => ({ success: true })),
  syncSeasonalPreorderCovers: vi.fn(async () => ({ success: true })),
}))

import SeasonalPreorderSection, {
  type PreorderMenuOption,
} from '@/components/features/table-bookings/preorder/SeasonalPreorderSection'

/**
 * BK-055: the staff pre-order card follows each guest's Christmas tier. It used to say "Every guest
 * needs a main. A starter and a dessert are optional" and badge only "Needs a main", so staff on the
 * telephone told a 3 course guest that a main would do.
 */

const STAMP = { createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z' }

function choice(course: PreorderSelection['course'], menuItemId: string, itemName: string): PreorderSelection {
  return { id: `sel-${menuItemId}`, coverId: 'x', course, menuItemId, itemName, priceGbp: null, itemWithdrawn: false, ...STAMP }
}

function seat(ordinal: number, courseCount: 1 | 2 | 3 | null, selections: PreorderSelection[]): PreorderCover {
  return {
    id: `cover-${ordinal}`,
    tableBookingId: 'booking-1',
    ordinal,
    guestName: null,
    dietaryNote: null,
    courseCount,
    selections: selections.map((entry) => ({ ...entry, coverId: `cover-${ordinal}` })),
    ...STAMP,
  }
}

const MENU: PreorderMenuOption[] = [
  { id: 'starter-1', course: 'starter', name: 'Fixture starter', priceGbp: null },
  { id: 'main-1', course: 'main', name: 'Fixture main', priceGbp: null },
  { id: 'dessert-1', course: 'dessert', name: 'Fixture dessert', priceGbp: null },
]

function order(courseCounts: Array<1 | 2 | 3> | null, covers: PreorderCover[]): PreorderOrder {
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
    covers,
  }
}

function renderCard(value: PreorderOrder) {
  return render(
    <SeasonalPreorderSection order={value} menu={MENU} canEdit preorderEnabled closed={false} closesAtIso={null} />,
  )
}

describe('SeasonalPreorderSection with Christmas tiers', () => {
  it('states the tier rule and badges each seat with the course it is missing', () => {
    renderCard(
      order([3, 2, 1], [
        seat(1, 3, [choice('main', 'main-1', 'Fixture main')]),
        seat(2, 2, [choice('main', 'main-1', 'Fixture main')]),
        seat(3, 1, []),
      ]),
    )

    expect(screen.queryByText(/Every guest needs a main/)).not.toBeInTheDocument()
    expect(screen.getByText(/a starter, a main and a dessert on 3 courses/)).toBeInTheDocument()

    expect(screen.getByText('Seat 1 · 3 courses')).toBeInTheDocument()
    expect(screen.getByText('Needs a starter and a dessert')).toBeInTheDocument()
    expect(screen.getByText('Seat 2 · 2 courses')).toBeInTheDocument()
    expect(screen.getByText('Needs a starter or a dessert')).toBeInTheDocument()
    expect(screen.queryByText('Needs a main')).not.toBeInTheDocument()
    // BK-148: the 1 course guest has nothing to choose, but a name and a dietary note (D23).
    expect(screen.getByText('Seat 3 · 1 course')).toBeInTheDocument()
    expect(screen.getByText('Chosen on the day, nothing to pre-order.')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Guest name (optional)')).toHaveLength(3)
    expect(screen.getAllByLabelText('Dietary requirement (optional)')).toHaveLength(3)

    expect(
      screen.getByText(
        'Seat 1 (3 courses) needs a starter and a dessert. Seat 2 (2 courses) needs a starter or a dessert.',
      ),
    ).toBeInTheDocument()
  })

  it('labels every course required on 3 courses and one-of-two on 2 courses', () => {
    renderCard(order([3, 2], [seat(1, 3, []), seat(2, 2, [])]))

    expect(screen.getAllByLabelText('Starter (required)')).toHaveLength(1)
    expect(screen.getAllByLabelText('Dessert (required)')).toHaveLength(1)
    expect(screen.getAllByLabelText('Main (required)')).toHaveLength(2)
    expect(screen.getByLabelText('Starter (or a dessert)')).toBeInTheDocument()
    expect(screen.getByLabelText('Dessert (or a starter)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Starter (optional)')).not.toBeInTheDocument()
  })

  it('keeps the old main-only wording on a booking with no tiers', () => {
    renderCard(order(null, [seat(1, null, [])]))

    expect(screen.getByText(/Every guest needs a main\. A starter and a dessert are optional/)).toBeInTheDocument()
    expect(screen.getByText('Needs a main')).toBeInTheDocument()
    expect(screen.getByLabelText('Starter (optional)')).toBeInTheDocument()
  })
})

// BK-051, owner decision D21: after the cutoff a manager can still record a change, marked as late.
describe('SeasonalPreorderSection after the cutoff', () => {
  const closedOrder = () => order([3], [seat(1, 3, [])])

  it('stays read-only for staff who are not managers, and says a manager records changes', () => {
    render(
      <SeasonalPreorderSection
        order={closedOrder()}
        menu={MENU}
        canEdit
        preorderEnabled
        closed
        closesAtIso="2026-11-03T12:00:00.000Z"
      />,
    )

    expect(screen.getByLabelText('Main (required)')).toBeDisabled()
    expect(screen.getByText(/a manager has to record any change now/)).toBeInTheDocument()
  })

  it('lets a manager record a late change and says it will be marked', () => {
    render(
      <SeasonalPreorderSection
        order={closedOrder()}
        menu={MENU}
        canEdit
        preorderEnabled
        closed
        closesAtIso="2026-11-03T12:00:00.000Z"
        canRecordLate
      />,
    )

    expect(screen.getByLabelText('Main (required)')).not.toBeDisabled()
    expect(screen.getByText(/As a manager you can still record a change/)).toBeInTheDocument()
  })
})
