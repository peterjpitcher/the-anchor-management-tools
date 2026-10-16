import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FohCreateBookingModal, type CreateForm } from '../FohCreateBookingModal'

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
  } = {},
) {
  render(
    <FohCreateBookingModal
      open
      createMode={options.createMode ?? 'booking'}
      createForm={createForm}
      canWaiveDeposit={false}
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
