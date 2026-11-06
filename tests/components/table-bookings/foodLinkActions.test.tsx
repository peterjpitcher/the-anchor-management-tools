import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendPreorderFoodLink: vi.fn(),
  copyPreorderFoodLink: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/components/features/table-bookings/preorder/actions', () => ({
  sendPreorderFoodLink: mocks.sendPreorderFoodLink,
  copyPreorderFoodLink: mocks.copyPreorderFoodLink,
}))

import { FoodLinkActions } from '@/components/features/table-bookings/preorder/FoodLinkActions'

/** "Send Food Link" asks first and says what happened; "Copy Link" says it made a new link. */
describe('FoodLinkActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks before sending, then says the link was sent', async () => {
    mocks.sendPreorderFoodLink.mockResolvedValue({ success: true, channel: 'email', message: 'Food link emailed to the organiser.' })
    render(<FoodLinkActions tableBookingId="booking-1" closed={false} bookingConfirmed />)

    fireEvent.click(screen.getByRole('button', { name: 'Send Food Link' }))
    expect(await screen.findByText('Send the food link?')).toBeInTheDocument()
    expect(mocks.sendPreorderFoodLink).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Send Link' }))

    await waitFor(() => expect(mocks.sendPreorderFoodLink).toHaveBeenCalledWith('booking-1'))
    expect(await screen.findByText('Food link emailed to the organiser.', { selector: '*' })).toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows a failed send on screen, not only in a toast', async () => {
    mocks.sendPreorderFoodLink.mockResolvedValue({
      error: 'The food link did not send. Try again in a minute, or copy the link and send it another way.',
    })
    render(<FoodLinkActions tableBookingId="booking-1" closed={false} bookingConfirmed />)

    fireEvent.click(screen.getByRole('button', { name: 'Send Food Link' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send Link' }))

    expect(await screen.findByText('Food link not sent')).toBeInTheDocument()
    const alert = screen.getByText('Food link not sent').closest('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert).toHaveTextContent('The food link did not send.')
  })

  it('cannot send once choices have closed or before the booking is confirmed', () => {
    const { rerender } = render(<FoodLinkActions tableBookingId="booking-1" closed bookingConfirmed />)
    expect(screen.getByRole('button', { name: 'Send Food Link' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Copy Link' })).not.toBeDisabled()

    rerender(<FoodLinkActions tableBookingId="booking-1" closed={false} bookingConfirmed={false} />)
    expect(screen.getByRole('button', { name: 'Send Food Link' })).toBeDisabled()
    expect(screen.getByText('The food link can be sent once the booking is confirmed.')).toBeInTheDocument()
  })

  it('copies a new link and says the old one still works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mocks.copyPreorderFoodLink.mockResolvedValue({
      success: true,
      url: 'https://l.example.test/abc',
      message: 'New link made and copied. Any link the organiser already has still works.',
    })
    render(<FoodLinkActions tableBookingId="booking-1" closed={false} bookingConfirmed />)

    expect(screen.getByText(/Copying makes a new link each time/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://l.example.test/abc'))
    expect(await screen.findByText(/Any link the organiser already has still works\./)).toBeInTheDocument()
  })

  it('shows the link to copy by hand when the browser refuses the clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    mocks.copyPreorderFoodLink.mockResolvedValue({ success: true, url: 'https://l.example.test/abc', message: 'x' })
    render(<FoodLinkActions tableBookingId="booking-1" closed={false} bookingConfirmed />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }))

    expect(await screen.findByText('https://l.example.test/abc')).toBeInTheDocument()
    expect(screen.getByText('Copy this link')).toBeInTheDocument()
  })
})
