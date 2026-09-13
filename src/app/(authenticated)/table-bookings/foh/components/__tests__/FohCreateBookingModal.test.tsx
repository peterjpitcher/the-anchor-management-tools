import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
}

function renderModal(createForm: CreateForm) {
  render(
    <FohCreateBookingModal
      open
      createMode="booking"
      createForm={createForm}
      canWaiveDeposit={false}
      walkInTargetTable={null}
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
      onSetCreateForm={vi.fn()}
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
