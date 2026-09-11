import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  promise: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/ds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ds')>()
  return { ...actual, toast }
})

const mockConfirm = vi.fn()

vi.mock('@/app/actions/privateBookingActions', () => ({
  confirmPrivateBookingDeposit: (...args: unknown[]) => mockConfirm(...args),
}))

import { ConfirmDepositPanel } from '@/app/(authenticated)/private-bookings/[id]/ConfirmDepositPanel'

function renderPanel(overrides: Partial<React.ComponentProps<typeof ConfirmDepositPanel>> = {}) {
  const onConfirmed = vi.fn()
  render(
    <ConfirmDepositPanel
      bookingId="booking-1"
      depositAmount={250}
      holdExpiryPreview="2026-09-25T09:00:00.000Z"
      isDateTbd={false}
      canConfirm
      onConfirmed={onConfirmed}
      {...overrides}
    />
  )
  return { onConfirmed }
}

describe('Deposit to be confirmed on the booking page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('says the guest has not been told, and shows what confirming will send and the deadline', () => {
    renderPanel()

    expect(screen.getByText('Deposit to be confirmed')).toBeInTheDocument()
    expect(screen.getByText(/The guest has not been told a deposit yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deposit' }))

    expect(screen.getByLabelText(/Deposit amount/)).toHaveValue(250)
    expect(screen.getByText('The guest will be asked to pay by Friday, 25 September 2026.')).toBeInTheDocument()
    expect(screen.getByText(/paid in cash at the bar or by PayPal/)).toBeInTheDocument()
  })

  it('shows staff why nothing was sent when the action fails, and leaves the dialog open', async () => {
    mockConfirm.mockResolvedValue({
      error: 'Nothing was sent: the email failed (Resend 503) and the text failed too (Twilio 500). The deposit is still to be confirmed.',
    })
    const { onConfirmed } = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm deposit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }))

    expect(await screen.findByText(/the email failed \(Resend 503\) and the text failed too \(Twilio 500\)/)).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Nothing was sent'))
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm and send' })).toBeInTheDocument()
  })

  it('shows staff a failure when the request never reaches the server', async () => {
    mockConfirm.mockRejectedValue(new Error('Failed to fetch'))
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm deposit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }))

    expect(await screen.findByText(/Nothing was sent: the request did not reach the server/)).toBeInTheDocument()
  })

  it('on success tells staff the channel it went by and refreshes the page', async () => {
    mockConfirm.mockResolvedValue({
      success: true,
      data: { status: 'sent', channel: 'email', message: 'Deposit confirmed at £250, due by 25 September 2026. The deposit request was emailed to the guest.' },
    })
    const { onConfirmed } = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm deposit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }))

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith('Deposit confirmed at £250, due by 25 September 2026. The deposit request was emailed to the guest.')
    expect(mockConfirm).toHaveBeenCalledWith('booking-1', { amount: '250', reductionReason: undefined })
  })

  it('a double click sends one request', async () => {
    let resolve: (value: unknown) => void = () => undefined
    mockConfirm.mockReturnValue(new Promise((r) => { resolve = r }))
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm deposit' }))
    const send = screen.getByRole('button', { name: 'Confirm and send' })
    fireEvent.click(send)
    fireEvent.click(send)
    resolve({ success: true, data: { status: 'sent', channel: 'email', message: 'Deposit confirmed.' } })

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(mockConfirm).toHaveBeenCalledTimes(1)
  })

  it('asks for the reason when the amount goes below £250', async () => {
    mockConfirm.mockResolvedValue({ success: true, data: { status: 'sent', channel: 'sms', message: 'ok' } })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm deposit' }))
    fireEvent.change(screen.getByLabelText(/Deposit amount/), { target: { value: '150' } })
    fireEvent.change(screen.getByLabelText(/Reason for the reduced deposit/), { target: { value: 'Repeat corporate client' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('booking-1', { amount: '150', reductionReason: 'Repeat corporate client' }))
  })

  it('a booking with no firm date says there is no deadline yet', () => {
    renderPanel({ isDateTbd: true, holdExpiryPreview: null })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deposit' }))
    expect(screen.getByText('No deadline yet: the event date is still to be confirmed.')).toBeInTheDocument()
  })

  it('staff who cannot manage deposits see the state but no button', () => {
    renderPanel({ canConfirm: false })
    expect(screen.queryByRole('button', { name: 'Confirm deposit' })).not.toBeInTheDocument()
    expect(screen.getByText('Someone who manages deposits can confirm it.')).toBeInTheDocument()
  })
})
