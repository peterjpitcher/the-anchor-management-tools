import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CardCapturePage from '@/app/g/[token]/card-capture/page'
import { GUEST_CONTACT } from '@/lib/guest-contact'

/**
 * The retired card-capture landing (BK-176, customer bookings review of 24 October 2026).
 *
 * The page reads no token, so it cannot know whether the booking behind an old link is live,
 * cancelled or long past. It must not claim the booking is confirmed or that a text is coming, and
 * it must not mention card details: the pub takes PayPal deposits, never a card hold.
 */
describe('the retired card-capture page', () => {
  it('says the link is no longer used and where the booking details are', () => {
    render(<CardCapturePage />)

    expect(screen.getByRole('heading', { name: 'This link is no longer used' })).toBeInTheDocument()
    expect(screen.getByText('Your booking details are in your confirmation email or text.')).toBeInTheDocument()
  })

  it('gives the phone number as a tap-to-call link', () => {
    render(<CardCapturePage />)

    // The guest shell's footer carries the number too, so look for the one in the message.
    const line = screen.getByText(/If anything looks wrong, call us on/)
    const link = line.querySelector('a')
    expect(link).toHaveTextContent(GUEST_CONTACT.phoneDisplay)
    expect(link).toHaveAttribute('href', GUEST_CONTACT.telHref)
  })

  it('makes no claim about the booking and never mentions a card', () => {
    const { container } = render(<CardCapturePage />)
    const text = container.textContent ?? ''

    expect(text).not.toMatch(/confirmed/i)
    expect(text).not.toMatch(/card/i)
    expect(text).not.toMatch(/SMS confirmation/i)
  })
})
