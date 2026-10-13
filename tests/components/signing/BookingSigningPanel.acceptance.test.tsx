import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  sendWaiver: vi.fn(),
  record: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/app/actions/signing-bookings', () => ({
  getBookingSigningState: mocks.getState,
  sendBookingWaiver: mocks.sendWaiver,
  recordContractAcceptedAnotherWay: mocks.record,
}))
// The panel's shared actions (chase, withdraw, sign in person) are server actions too.
vi.mock('@/app/actions/signing', () => ({
  sendSigningReminder: vi.fn(),
  startInPersonSigningAction: vi.fn(),
  voidSigningRequest: vi.fn(),
}))
vi.mock('@/ds/primitives/Toast', () => ({ toast: mocks.toast }))

import type { BookingSigningState } from '@/app/actions/signing-bookings'
import { BookingSigningPanel } from '@/components/features/signing/BookingSigningPanel'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const OPEN = 'Record Acceptance Another Way'
const CONFIRM = 'Record Acceptance'
const NOTE = 'Signed copy is in the bookings folder in the office.'

function signingState(overrides: Partial<BookingSigningState> = {}): BookingSigningState {
  return {
    documents: [],
    waiverRequired: false,
    waiverOutstanding: false,
    waiverStatus: 'not_required',
    hasEmail: true,
    canSend: true,
    contractIssued: true,
    contractAcceptedAt: null,
    contractAcceptanceMethod: null,
    canRecordAcceptance: true,
    ...overrides,
  }
}

function load(state: BookingSigningState): void {
  mocks.getState.mockResolvedValue({ success: true, data: state })
}

async function renderLoaded(state: BookingSigningState): Promise<void> {
  load(state)
  render(<BookingSigningPanel bookingId={BOOKING} />)
  await screen.findByText('Signatures')
}

function openButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: OPEN })
}

function dateField(): HTMLInputElement {
  return screen.getByLabelText('Date accepted') as HTMLInputElement
}

function noteField(): HTMLTextAreaElement {
  return screen.getByLabelText('Where the evidence is kept') as HTMLTextAreaElement
}

/** userEvent drives the clock itself, so only the date is frozen. */
function setNow(instant: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(instant))
}

async function openModal(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: OPEN }))
  await screen.findByRole('button', { name: CONFIRM })
  return user
}

beforeEach(() => {
  vi.resetAllMocks()
  setNow('2026-10-13T10:00:00.000Z')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('offering to record an acceptance on the booking', () => {
  it('offers it when the contract is not accepted and the user may record it', async () => {
    await renderLoaded(signingState())

    expect(openButton()).toBeInTheDocument()
    expect(screen.queryByText('Contract Accepted')).not.toBeInTheDocument()
  })

  it('offers it beside the food agreement button when both apply', async () => {
    await renderLoaded(signingState({ waiverRequired: true, waiverOutstanding: true, waiverStatus: 'required' }))

    expect(openButton()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send Food Agreement to Sign' })).toBeInTheDocument()
  })

  it('does not offer it to someone who may not record it, or before a contract exists', async () => {
    await renderLoaded(signingState({ canRecordAcceptance: false }))
    expect(openButton()).not.toBeInTheDocument()
  })

  it.each([
    ['e_signature', '2026-10-12T14:03:00.000Z', 'Signed online on 12 October 2026.'],
    ['deposit_payment', '2026-10-02T08:00:00.000Z', 'Accepted by paying the deposit on 2 October 2026.'],
    ['signed_paper', '2026-10-25T12:00:00.000Z', 'Signed on paper on 25 October 2026.'],
    ['written_confirmation', '2027-03-28T11:00:00.000Z', 'Confirmed in writing on 28 March 2027.'],
    // A method written by something older is still shown as accepted, with its date.
    [null, '2026-09-01T11:00:00.000Z', 'Accepted on 1 September 2026.'],
  ])('says how and when a contract accepted by %s was accepted, and stops offering', async (method, acceptedAt, wording) => {
    // Even if the server still said yes, an accepted contract is not offered again.
    await renderLoaded(signingState({ contractAcceptedAt: acceptedAt, contractAcceptanceMethod: method, canRecordAcceptance: true }))

    expect(screen.getByText('Contract Accepted')).toBeInTheDocument()
    expect(screen.getByText(wording)).toBeInTheDocument()
    expect(openButton()).not.toBeInTheDocument()
  })

  it('shows the London day for an acceptance stamped late in the evening in UTC', async () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in London.
    await renderLoaded(signingState({ contractAcceptedAt: '2026-06-30T23:30:00.000Z', contractAcceptanceMethod: 'e_signature' }))

    expect(screen.getByText('Signed online on 1 July 2026.')).toBeInTheDocument()
  })
})

describe('the form for recording an acceptance', () => {
  it('opens with both choices unpicked, today in London as the date, and help on what to write', async () => {
    // 23:30 UTC on the 13th is already the 14th in London.
    setNow('2026-10-13T23:30:00.000Z')
    await renderLoaded(signingState())
    await openModal()

    expect(screen.getByRole('radio', { name: 'Signed on Paper' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Confirmed in Writing' })).not.toBeChecked()
    expect(dateField().value).toBe('2026-10-14')
    expect(dateField().max).toBe('2026-10-14')
    expect(noteField().value).toBe('')
    expect(
      screen.getByText(
        'For example: signed copy in the bookings folder in the office, or email from the customer on 9 October in the manager inbox.'
      )
    ).toBeInTheDocument()
  })

  it('asks for a choice and a proper note before it will send anything', async () => {
    await renderLoaded(signingState())
    const user = await openModal()

    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(screen.getByText('Choose how the contract was accepted.')).toBeInTheDocument()
    expect(screen.getByText('Say where the evidence is kept, in at least 10 characters.')).toBeInTheDocument()
    expect(mocks.record).not.toHaveBeenCalled()

    // Spaces do not count towards the note.
    await user.click(screen.getByRole('radio', { name: 'Signed on Paper' }))
    await user.type(noteField(), '  office    ')
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(screen.queryByText('Choose how the contract was accepted.')).not.toBeInTheDocument()
    expect(screen.getByText('Say where the evidence is kept, in at least 10 characters.')).toBeInTheDocument()
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('refuses a date in the future, and a missing date', async () => {
    await renderLoaded(signingState())
    const user = await openModal()
    await user.click(screen.getByRole('radio', { name: 'Confirmed in Writing' }))
    await user.type(noteField(), NOTE)

    fireEvent.change(dateField(), { target: { value: '2026-10-14' } })
    await user.click(screen.getByRole('button', { name: CONFIRM }))
    expect(screen.getByText('The date cannot be in the future.')).toBeInTheDocument()

    fireEvent.change(dateField(), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: CONFIRM }))
    expect(screen.getByText('Enter the date the contract was accepted.')).toBeInTheDocument()

    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('records the acceptance, says so, closes, and reloads to show how it was accepted', async () => {
    await renderLoaded(signingState())
    const user = await openModal()
    mocks.record.mockResolvedValue({ success: true, data: { acceptedAt: '2026-10-09T11:00:00.000Z', withdrawn: 1 } })
    load(signingState({ contractAcceptedAt: '2026-10-09T11:00:00.000Z', contractAcceptanceMethod: 'signed_paper', canRecordAcceptance: false }))

    await user.click(screen.getByRole('radio', { name: 'Signed on Paper' }))
    fireEvent.change(dateField(), { target: { value: '2026-10-09' } })
    await user.type(noteField(), `  ${NOTE}  `)
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Contract acceptance recorded.'))
    expect(mocks.record).toHaveBeenCalledTimes(1)
    expect(mocks.record).toHaveBeenCalledWith({ bookingId: BOOKING, method: 'signed_paper', acceptedOn: '2026-10-09', note: NOTE })
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(await screen.findByText('Signed on paper on 9 October 2026.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: CONFIRM })).not.toBeInTheDocument())
    expect(openButton()).not.toBeInTheDocument()
    expect(mocks.getState).toHaveBeenCalledTimes(2)
  })

  it('sends the written confirmation choice as chosen', async () => {
    await renderLoaded(signingState())
    const user = await openModal()
    mocks.record.mockResolvedValue({ success: true, data: { acceptedAt: '2026-10-13T11:00:00.000Z', withdrawn: 0 } })

    await user.click(screen.getByRole('radio', { name: 'Signed on Paper' }))
    await user.click(screen.getByRole('radio', { name: 'Confirmed in Writing' }))
    await user.type(noteField(), NOTE)
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    await waitFor(() =>
      expect(mocks.record).toHaveBeenCalledWith({ bookingId: BOOKING, method: 'written_confirmation', acceptedOn: '2026-10-13', note: NOTE })
    )
  })

  it('passes on the warning when the acceptance was recorded but the online request was not withdrawn', async () => {
    await renderLoaded(signingState())
    const user = await openModal()
    const warning = 'The acceptance was recorded, but the request to sign the contract online could not be withdrawn. Withdraw it from the Signatures panel.'
    mocks.record.mockResolvedValue({ success: true, data: { acceptedAt: '2026-10-13T11:00:00.000Z', withdrawn: 0, warning } })

    await user.click(screen.getByRole('radio', { name: 'Signed on Paper' }))
    await user.type(noteField(), NOTE)
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(warning))
    expect(mocks.toast.success).toHaveBeenCalledWith('Contract acceptance recorded.')
  })

  it.each([
    ['a reason from the server', { error: 'This contract is already accepted: signed online on 12 October 2026.' }, 'This contract is already accepted: signed online on 12 October 2026.'],
    ['neither success nor a reason', {}, 'The acceptance could not be recorded.'],
  ])('shows the failure and keeps the form open, with what was typed, on %s', async (_label, response, message) => {
    await renderLoaded(signingState())
    const user = await openModal()
    mocks.record.mockResolvedValue(response)

    await user.click(screen.getByRole('radio', { name: 'Signed on Paper' }))
    await user.type(noteField(), NOTE)
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(message))
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(screen.getByText('The acceptance was not recorded')).toBeInTheDocument()
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: CONFIRM })).toBeInTheDocument()
    expect(noteField().value).toBe(NOTE)
    // Nothing was recorded, so the panel is not reloaded as if it had been.
    expect(mocks.getState).toHaveBeenCalledTimes(1)
  })

  it('shows a failure when the request itself does not get through', async () => {
    await renderLoaded(signingState())
    const user = await openModal()
    mocks.record.mockRejectedValue(new Error('Failed to fetch'))

    await user.click(screen.getByRole('radio', { name: 'Signed on Paper' }))
    await user.type(noteField(), NOTE)
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith('The acceptance could not be recorded. Check your connection and try again.')
    )
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: CONFIRM })).toBeInTheDocument()
  })

  it('starts clean when it is closed and opened again', async () => {
    await renderLoaded(signingState())
    const user = await openModal()
    await user.click(screen.getByRole('radio', { name: 'Signed on Paper' }))
    await user.type(noteField(), NOTE)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: CONFIRM })).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: OPEN }))
    await screen.findByRole('button', { name: CONFIRM })

    expect(screen.getByRole('radio', { name: 'Signed on Paper' })).not.toBeChecked()
    expect(noteField().value).toBe('')
    expect(mocks.record).not.toHaveBeenCalled()
  })
})
