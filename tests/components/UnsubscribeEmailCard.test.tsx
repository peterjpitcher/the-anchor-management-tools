import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const unsubscribeMarketingEmailAddress = vi.hoisted(() => vi.fn())

vi.mock('@/app/actions/marketing-contacts', () => ({
  unsubscribeMarketingEmailAddress,
}))

import { UnsubscribeEmailCard } from '@/app/(authenticated)/marketing/UnsubscribeEmailCard'

describe('UnsubscribeEmailCard', () => {
  beforeEach(() => {
    unsubscribeMarketingEmailAddress.mockReset()
  })

  it('explains that only marketing email is stopped', () => {
    render(<UnsubscribeEmailCard />)

    expect(screen.getByText('Unsubscribe an email address')).toBeInTheDocument()
    expect(
      screen.getByText('Marketing only. Booking confirmations and reminders will still be sent.'),
    ).toBeInTheDocument()
  })

  it('submits the entered address and clears it after a successful unsubscribe', async () => {
    unsubscribeMarketingEmailAddress.mockResolvedValue({
      success: true,
      data: {
        customerMatches: 1,
        businessContactMatches: 0,
        newlyUnsubscribed: 1,
        alreadyUnsubscribed: 0,
        addressBlocked: true,
      },
    })

    render(<UnsubscribeEmailCard />)

    const input = screen.getByLabelText('Email address')
    fireEvent.change(input, { target: { value: 'person@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))

    await waitFor(() => {
      expect(unsubscribeMarketingEmailAddress).toHaveBeenCalledWith('person@example.com')
    })
    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })

  it('keeps the address in place when the server rejects the request', async () => {
    unsubscribeMarketingEmailAddress.mockResolvedValue({ error: 'Enter a valid email address' })

    render(<UnsubscribeEmailCard />)

    const input = screen.getByLabelText('Email address')
    fireEvent.change(input, { target: { value: 'person@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))

    await waitFor(() => {
      expect(unsubscribeMarketingEmailAddress).toHaveBeenCalled()
    })
    expect(input).toHaveValue('person@example.com')
  })
})
