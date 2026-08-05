import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PreorderSection } from '@/app/g/[token]/table-manage/PreorderSection'
import type { BookerPreorderView } from '@/app/g/[token]/table-manage/preorder-data'
import type { BookingPeriodMenuItem } from '@/lib/table-bookings/periods'
import { PREORDER_ADDON_GUEST_NOTE, type PreorderCover, type PreorderSelection } from '@/types/preorders'

/**
 * The pre-order form, restyled onto the guest design system.
 *
 * These assertions are deliberately about the plumbing rather than the paint: the hidden add-on
 * marker, the one shared note every add-on group points at, the polite totals and the invalid
 * marking on a failed seat are what make the form work for a screen reader and for the action route
 * behind it. A restyle that quietly drops one of them looks fine and behaves badly.
 */

const TIMESTAMPS = { createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z' }

function menuItem(id: string, name: string, priceGbp: number | null = null): BookingPeriodMenuItem {
  return {
    id,
    course: 'main',
    name,
    description: null,
    priceGbp,
    allergens: null,
    sortOrder: 1,
    isActive: true,
  } as BookingPeriodMenuItem
}

function selection(over: Partial<PreorderSelection> & { course: PreorderSelection['course'] }): PreorderSelection {
  return {
    id: `selection-${over.course}`,
    coverId: 'cover-1',
    menuItemId: 'item-1',
    itemName: 'Roast turkey',
    priceGbp: null,
    itemWithdrawn: false,
    ...TIMESTAMPS,
    ...over,
  }
}

function cover(over: Partial<PreorderCover> = {}): PreorderCover {
  return {
    id: 'cover-1',
    tableBookingId: 'booking-1',
    ordinal: 1,
    guestName: 'Sam',
    dietaryNote: null,
    selections: [],
    ...TIMESTAMPS,
    ...over,
  }
}

function view(over: Partial<BookerPreorderView> = {}): BookerPreorderView {
  return {
    order: {
      tableBookingId: 'booking-1',
      bookingReference: 'TB-2026-0042',
      bookingDate: '2026-12-24',
      bookingTime: '18:30',
      partySize: 2,
      requiresPreorder: true,
      bookingAllergies: [],
      periodId: 'period-1',
      periodName: 'Christmas',
      preorderCutoffDays: 7,
      covers: [cover({ selections: [selection({ course: 'main' })] })],
    },
    // Starter and dessert are empty on purpose: a course with no live items renders no field at all.
    menuByCourse: {
      starter: [],
      main: [menuItem('item-1', 'Roast turkey'), menuItem('item-2', 'Nut roast')],
      dessert: [],
    },
    addons: [menuItem('addon-1', 'Farmhouse cheeseboard', 6.5)],
    cutoff: { at: new Date('2026-12-17T12:00:00.000Z'), editable: true },
    ...over,
  }
}

const baseProps = { actionUrl: '/g/raw-token/table-manage/action', errorSeat: null }

describe('PreorderSection', () => {
  it('keeps add-ons as tick boxes, with the hidden marker that lets one be removed', () => {
    const ticked = view({
      order: {
        ...view().order,
        covers: [
          cover({
            selections: [
              selection({ course: 'main' }),
              selection({
                id: 'selection-addon',
                course: 'addon',
                menuItemId: 'addon-1',
                itemName: 'Farmhouse cheeseboard',
                priceGbp: 6.5,
              }),
            ],
          }),
        ],
      },
    })

    const { container } = render(<PreorderSection {...ticked} {...baseProps} />)

    // Two seats, one add-on each, as checkboxes rather than a fourth dropdown. The cheeseboard is
    // had ALONGSIDE a pudding, which is exactly what a dropdown would forbid.
    const boxes = screen.getAllByRole('checkbox', { name: /Farmhouse cheeseboard/ })
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).toBeChecked()
    expect(boxes[1]).not.toBeChecked()

    // Without this marker, "everything unticked" and "no add-on block on this form" arrive at the
    // action route identically, and nobody could ever remove an add-on.
    for (const ordinal of [1, 2]) {
      const marker = container.querySelector(`input[name="seat_${ordinal}_addons_present"]`)
      expect(marker).not.toBeNull()
      expect(marker).toHaveAttribute('type', 'hidden')
      expect(marker).toHaveValue('1')
    }
  })

  it('points every add-on group at the one verbatim money note', () => {
    const { container } = render(<PreorderSection {...view()} {...baseProps} />)

    const note = screen.getByText(PREORDER_ADDON_GUEST_NOTE)
    expect(note.id).toBe('preorder-addon-note')

    const groups = Array.from(container.querySelectorAll('fieldset[aria-describedby]'))
    expect(groups).toHaveLength(2)
    for (const group of groups) {
      expect(group).toHaveAttribute('aria-describedby', 'preorder-addon-note')
    }
  })

  it('keeps the saved totals in a polite live region, per seat and across the booking', () => {
    const { container } = render(<PreorderSection {...view()} {...baseProps} />)

    const live = Array.from(container.querySelectorAll('[aria-live="polite"]'))
    // One per seat, plus the booking-wide line.
    expect(live).toHaveLength(3)
    expect(live[live.length - 1]).toHaveTextContent(/Add-ons across this booking/)
  })

  it('marks a failed seat invalid and points its controls at the reason', () => {
    const { container } = render(<PreorderSection {...view()} {...baseProps} errorSeat={1} />)

    const mainSelect = screen.getByLabelText('Main', { selector: '#seat-1-main' })
    expect(mainSelect).toHaveAttribute('aria-invalid', 'true')
    expect(mainSelect).toHaveAttribute('aria-describedby', 'seat-1-error')

    const reason = container.querySelector('#seat-1-error')
    expect(reason).not.toBeNull()
    expect(reason).toHaveTextContent('We could not save this seat')

    // The second seat did not fail, so nothing on it is marked.
    expect(screen.getByLabelText('Main', { selector: '#seat-2-main' })).not.toHaveAttribute('aria-invalid')
  })

  it('flags a withdrawn dish and describes the seat with it', () => {
    const withdrawn = view({
      order: {
        ...view().order,
        covers: [
          cover({
            selections: [selection({ course: 'main', itemWithdrawn: true, itemName: 'Beef wellington' })],
          }),
        ],
      },
    })

    const { container } = render(<PreorderSection {...withdrawn} {...baseProps} />)

    const note = container.querySelector('#seat-1-withdrawn')
    expect(note).toHaveTextContent('Beef wellington is no longer on the menu')
    expect(screen.getByLabelText('Main', { selector: '#seat-1-main' })).toHaveAttribute(
      'aria-describedby',
      'seat-1-withdrawn'
    )
  })

  it('renders the record, not a form, once the cutoff has passed', () => {
    const closed = view({ cutoff: { at: new Date('2026-12-17T12:00:00.000Z'), editable: false } })

    render(<PreorderSection {...closed} {...baseProps} />)

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText(/Food choices are now closed for this booking/)).toBeInTheDocument()
    expect(screen.getByText('Main: Roast turkey')).toBeInTheDocument()
  })
})
