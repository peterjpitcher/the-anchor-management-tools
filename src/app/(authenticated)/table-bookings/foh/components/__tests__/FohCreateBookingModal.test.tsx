import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { christmasPreorderDeadlineText, FohCreateBookingModal, type CreateForm } from '../FohCreateBookingModal'

const CHRISTMAS_FORM: CreateForm = {
  booking_date: '2026-12-05',
  event_id: '',
  phone: '',
  email: '',
  customer_name: '',
  first_name: '',
  last_name: '',
  time: '13:00',
  party_size: '4',
  purpose: 'christmas',
  seating_preference: 'seated',
  sunday_deposit_method: 'payment_link',
  notes: '',
  allergies: '',
  waive_deposit: false,
  is_venue_event: false,
  bypass_pacing: false,
  high_chair_count: '0',
  outside_seating: false,
  requires_accessible_table: false,
}

function renderModal(
  createForm: CreateForm,
  options: {
    createMode?: 'booking' | 'walk_in' | 'management'
    onSetCreateForm?: (updater: (current: CreateForm) => CreateForm) => void
    walkInTargetTable?: { id: string; name: string } | null
    canWaiveDeposit?: boolean
    christmasPreorderCutoffDays?: number | null
  } = {},
) {
  render(
    <FohCreateBookingModal
      open
      createMode={options.createMode ?? 'booking'}
      createForm={createForm}
      canWaiveDeposit={options.canWaiveDeposit ?? false}
      walkInTargetTable={options.walkInTargetTable ?? null}
      submittingBooking={false}
      customerQuery=""
      completedCustomerSearchQuery=""
      customerResults={[]}
      selectedCustomer={null}
      searchingCustomers={false}
      eventOptions={[]}
      loadingEventOptions={false}
      eventOptionsError={null}
      selectedEventOption={null}
      overlappingEventForTable={null}
      tableEventPromptAcknowledgedEventId={null}
      walkInPurposeAutoSelectionEnabled={false}
      formRequiresDeposit
      seasonalPeriod={null}
      christmasPreorderCutoffDays={options.christmasPreorderCutoffDays ?? null}
      seasonalAnswer={null}
      onSetSeasonalAnswer={vi.fn()}
      errorMessage={null}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      onSetCreateForm={options.onSetCreateForm ?? vi.fn()}
      onSetCustomerQuery={vi.fn()}
      onSelectCustomer={vi.fn()}
      onClearCustomer={vi.fn()}
      onSetTableEventPromptAcknowledgedEventId={vi.fn()}
      onSetWalkInPurposeAutoSelectionEnabled={vi.fn()}
      onSetErrorMessage={vi.fn()}
    />,
  )
}

describe('FohCreateBookingModal: the Christmas rules staff are shown', () => {
  it('says a Christmas booking needs 4 guests or more', () => {
    // Owner decision, 6 September 2026: 4 on every day of the window, down from 6.
    renderModal(CHRISTMAS_FORM)
    expect(screen.getByText(/Christmas bookings need 4 guests or more/)).toBeInTheDocument()
  })

  it('no longer quotes the old 6-guest minimum', () => {
    renderModal(CHRISTMAS_FORM)
    expect(screen.queryByText(/need 6 guests or more/)).not.toBeInTheDocument()
  })

  it('shows the Christmas rules only for a Christmas booking', () => {
    renderModal({ ...CHRISTMAS_FORM, purpose: 'food' })
    expect(screen.queryByText(/Christmas bookings need/)).not.toBeInTheDocument()
  })
})

describe('FohCreateBookingModal: high chairs, outside and step-free', () => {
  const FOOD_FORM: CreateForm = { ...CHRISTMAS_FORM, purpose: 'food', party_size: '2' }

  function applyLastUpdate(onSetCreateForm: ReturnType<typeof vi.fn>, form: CreateForm): CreateForm {
    const updater = onSetCreateForm.mock.calls.at(-1)?.[0] as (current: CreateForm) => CreateForm
    return updater(form)
  }

  it('offers high chairs, an outside table and a step-free table on a food booking', () => {
    renderModal(FOOD_FORM)
    expect(screen.getByLabelText('High chairs')).toBeInTheDocument()
    expect(screen.getByLabelText('Outside table')).toBeInTheDocument()
    expect(screen.getByLabelText('Needs a step-free table')).toBeInTheDocument()
  })

  it('records the high chairs staff choose', () => {
    const onSetCreateForm = vi.fn()
    renderModal(FOOD_FORM, { onSetCreateForm })
    fireEvent.change(screen.getByLabelText('High chairs'), { target: { value: '2' } })
    expect(applyLastUpdate(onSetCreateForm, FOOD_FORM).high_chair_count).toBe('2')
  })

  it('records an outside table', () => {
    const onSetCreateForm = vi.fn()
    renderModal(FOOD_FORM, { onSetCreateForm })
    fireEvent.click(screen.getByLabelText('Outside table'))
    expect(applyLastUpdate(onSetCreateForm, FOOD_FORM).outside_seating).toBe(true)
  })

  it('hides the step-free choice for an outside table, which has no indoor table to choose', () => {
    renderModal({ ...FOOD_FORM, outside_seating: true })
    expect(screen.queryByLabelText('Needs a step-free table')).not.toBeInTheDocument()
  })

  it('drops the "will be moved to" note once a walk-in is outside', () => {
    renderModal({ ...FOOD_FORM, outside_seating: true }, { createMode: 'walk_in', walkInTargetTable: { id: 't1', name: 'Low 4a' } })
    expect(screen.queryByText(/Walk-in will be moved to/)).not.toBeInTheDocument()
  })

  it('keeps the "will be moved to" note for an indoor walk-in', () => {
    renderModal(FOOD_FORM, { createMode: 'walk_in', walkInTargetTable: { id: 't1', name: 'Low 4a' } })
    expect(screen.getByText(/Walk-in will be moved to/)).toBeInTheDocument()
  })

  it('keeps high chairs and outside on a walk-in, without the step-free choice', () => {
    renderModal(FOOD_FORM, { createMode: 'walk_in' })
    expect(screen.getByLabelText('High chairs')).toBeInTheDocument()
    expect(screen.getByLabelText('Outside table')).toBeInTheDocument()
    expect(screen.queryByLabelText('Needs a step-free table')).not.toBeInTheDocument()
  })
})

// BK-057: a Christmas booking taken here records each guest's 1, 2 or 3 courses.
describe('FohCreateBookingModal: Christmas courses for each guest', () => {
  it('asks for a course choice for every guest on a Christmas booking', () => {
    renderModal(CHRISTMAS_FORM)
    expect(screen.getByText('Christmas courses for each guest')).toBeInTheDocument()
    for (const guest of [1, 2, 3, 4]) {
      expect(screen.getByLabelText(`Guest ${guest}`)).toHaveValue('0')
    }
  })

  it('sets every guest at once from "Everyone", and one guest on their own', () => {
    let form = CHRISTMAS_FORM
    const onSetCreateForm = vi.fn((updater: (current: CreateForm) => CreateForm) => {
      form = updater(form)
    })
    renderModal(CHRISTMAS_FORM, { onSetCreateForm })

    fireEvent.change(screen.getByLabelText('Everyone'), { target: { value: '3' } })
    expect(form.christmas_course_counts).toEqual([3, 3, 3, 3])

    fireEvent.change(screen.getByLabelText('Guest 2'), { target: { value: '1' } })
    expect(form.christmas_course_counts).toEqual([0, 1, 0, 0])
  })

  it('does not ask on a walk-in, which is on the day and so 1 course', () => {
    renderModal(CHRISTMAS_FORM, { createMode: 'walk_in' })
    expect(screen.queryByText('Christmas courses for each guest')).not.toBeInTheDocument()
  })

  it('does not ask on any other kind of booking', () => {
    renderModal({ ...CHRISTMAS_FORM, purpose: 'food' })
    expect(screen.queryByText('Christmas courses for each guest')).not.toBeInTheDocument()
  })
})

// BK-106 (D18): the Pub Event tick takes the deposit off, so only staff who may waive one see it,
// and never on a Christmas booking, which always takes its deposit.
describe('the Pub Event tick', () => {
  const FOOD_FORM: CreateForm = { ...CHRISTMAS_FORM, purpose: 'food', party_size: '20' }

  it('is shown to staff who may waive a deposit', () => {
    renderModal(FOOD_FORM, { canWaiveDeposit: true })
    expect(screen.getByLabelText(/Pub Event/)).toBeInTheDocument()
  })

  it('is hidden from staff who may not', () => {
    renderModal(FOOD_FORM, { canWaiveDeposit: false })
    expect(screen.queryByLabelText(/Pub Event/)).not.toBeInTheDocument()
  })

  it('is never shown on a Christmas booking', () => {
    renderModal({ ...CHRISTMAS_FORM, party_size: '20' }, { canWaiveDeposit: true })
    expect(screen.queryByLabelText(/Pub Event/)).not.toBeInTheDocument()
  })
})

// BK-150: the deadline comes from the Christmas period's editable cutoff, not a fixed 7.
describe('FohCreateBookingModal: the Christmas pre-order deadline', () => {
  it('quotes the period setting', () => {
    renderModal(CHRISTMAS_FORM, { christmasPreorderCutoffDays: 10 })
    expect(screen.getByText(/need food choices by noon 10 days before the date/)).toBeInTheDocument()
    expect(screen.getByText(/Booked after noon 10 days before the date/)).toBeInTheDocument()
    expect(screen.queryByText(/7 days/)).not.toBeInTheDocument()
  })

  it('names no number when the setting is not known', () => {
    renderModal(CHRISTMAS_FORM)
    expect(screen.getByText(/need food choices by the pre-order deadline/)).toBeInTheDocument()
  })

  it('words one day and the day itself', () => {
    expect(christmasPreorderDeadlineText(1)).toBe('noon 1 day before the date')
    expect(christmasPreorderDeadlineText(0)).toBe('noon on the date')
  })
})
