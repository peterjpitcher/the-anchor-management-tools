// The create form on the floor iPad (owner decisions, 22 November 2026): after midnight the date
// box agrees with the trading date the form holds, the buttons sit in the dialog footer where the
// keyboard cannot push them out of reach, and a tap outside a half-filled form asks first.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FohCreateBookingModal, type CreateForm } from '../FohCreateBookingModal'

const FORM: CreateForm = {
  // The night of 31 December, still being worked at 00:30 on 1 January.
  booking_date: '2026-12-31',
  event_id: '',
  phone: '',
  email: '',
  customer_name: '',
  first_name: '',
  last_name: '',
  time: '00:35',
  party_size: '2',
  purpose: 'drinks',
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

function renderModal(options: {
  form?: CreateForm
  createMode?: 'booking' | 'walk_in'
  serviceDateNow?: string
  errorMessage?: string | null
  onSetCreateForm?: (updater: (current: CreateForm) => CreateForm) => void
} = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
  render(
    <FohCreateBookingModal
      open
      serviceDateNow={options.serviceDateNow}
      createMode={options.createMode ?? 'walk_in'}
      createForm={options.form ?? FORM}
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
      formRequiresDeposit={false}
      seasonalPeriod={null}
      seasonalAnswer={null}
      onSetSeasonalAnswer={vi.fn()}
      errorMessage={options.errorMessage ?? null}
      onClose={onClose}
      onSubmit={onSubmit}
      onSetCreateForm={options.onSetCreateForm ?? vi.fn()}
      onSetCustomerQuery={vi.fn()}
      onSelectCustomer={vi.fn()}
      onClearCustomer={vi.fn()}
      onSetTableEventPromptAcknowledgedEventId={vi.fn()}
      onSetWalkInPurposeAutoSelectionEnabled={vi.fn()}
      onSetErrorMessage={vi.fn()}
    />
  )
  return { onClose, onSubmit }
}

describe('the walk-in date box after midnight', () => {
  it('is held to the trading date the form holds, so the browser accepts it', () => {
    renderModal({ serviceDateNow: '2026-12-31' })

    const date = screen.getByLabelText(/Booking date/) as HTMLInputElement
    expect(date.value).toBe('2026-12-31')
    expect(date.min).toBe('2026-12-31')
    expect(date.max).toBe('2026-12-31')
    // The browser's own check: the value is inside the range it was given.
    expect(date.validity.rangeOverflow).toBe(false)
    expect(date.validity.rangeUnderflow).toBe(false)
  })

  it('leaves a booking free to pick any date', () => {
    renderModal({ createMode: 'booking', serviceDateNow: '2026-12-31' })

    const date = screen.getByLabelText(/Booking date/) as HTMLInputElement
    expect(date.min).toBe('')
    expect(date.max).toBe('')
  })
})

describe('the buttons stay in reach', () => {
  it('submits the form from the dialog footer, outside the scrolling form', async () => {
    const { onSubmit } = renderModal({ serviceDateNow: '2026-12-31' })

    const create = screen.getByRole('button', { name: 'Create walk-in' })
    const form = document.getElementById('foh-create-booking-form')
    expect(form).not.toBeNull()
    expect(form?.contains(create)).toBe(false)
    expect(create).toHaveAttribute('form', 'foh-create-booking-form')

    await userEvent.click(create)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows a failed save beside the buttons', () => {
    renderModal({ serviceDateNow: '2026-12-31', errorMessage: 'No table is free at that time.' })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('No table is free at that time.')
  })
})

describe('a tap outside the form', () => {
  it('closes an untouched form straight away', async () => {
    const { onClose } = renderModal({ serviceDateNow: '2026-12-31' })

    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('asks before discarding a half-filled form, and keeps it on Keep editing', async () => {
    const { onClose } = renderModal({
      createMode: 'booking',
      serviceDateNow: '2026-12-31',
      form: { ...FORM, first_name: 'Jo', phone: '07700 900123' },
    })

    await userEvent.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
    const question = screen.getByRole('alertdialog', { name: 'Discard this booking?' })
    expect(question).toHaveTextContent('This booking has not been saved.')

    await userEvent.click(within(question).getByRole('button', { name: 'Keep editing' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create booking' })).toBeInTheDocument()
  })

  it('discards when staff say so', async () => {
    const { onClose } = renderModal({
      createMode: 'booking',
      serviceDateNow: '2026-12-31',
      form: { ...FORM, notes: 'Window table' },
    })

    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('still closes at once on the Cancel button', async () => {
    const { onClose } = renderModal({
      createMode: 'booking',
      serviceDateNow: '2026-12-31',
      form: { ...FORM, first_name: 'Jo' },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('party size in the create form', () => {
  it('has a plus and a minus as well as the number', () => {
    const onSetCreateForm = vi.fn<(updater: (current: CreateForm) => CreateForm) => void>()
    renderModal({ serviceDateNow: '2026-12-31', onSetCreateForm })

    fireEvent.click(screen.getByRole('button', { name: 'One more: party size' }))

    const updater = onSetCreateForm.mock.calls.at(-1)?.[0]
    expect(updater?.(FORM).party_size).toBe('3')
    expect(screen.getByLabelText(/Party size/)).toHaveValue(2)
  })
})
