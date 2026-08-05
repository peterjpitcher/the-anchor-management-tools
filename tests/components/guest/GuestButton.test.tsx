import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuestButton } from '@/components/features/guest'

// The barrel re-exports GuestShell, which loads the guest webfonts, and
// next/font/google is a build-time transform with no loader under Vitest.
// Any test importing from '@/components/features/guest' needs this stub.
vi.mock('next/font/google', () => {
  const font = (): { variable: string; className: string } => ({
    variable: 'mock-font-variable',
    className: 'mock-font',
  })
  return { DM_Serif_Display: font, Outfit: font, Clicker_Script: font }
})

// next/link needs an App Router context to render. The harness has none, and
// the behaviour under test is the element it produces, not its prefetching.
vi.mock('next/link', () => ({
  default: ({
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.JSX.Element => (
    <a {...rest}>{children}</a>
  ),
}))

describe('GuestButton', () => {
  it('renders a button by default, typed button rather than submit', () => {
    render(<GuestButton>Save changes</GuestButton>)

    const button = screen.getByRole('button', { name: 'Save changes' })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('carries the AA-safe gold on primary, not the 4.02:1 fill the handoff drew', () => {
    // Spec C1. #a57626 on white is 4.02:1 and these labels are 14 to 18px
    // semibold, so they are not WCAG large text and need 4.5:1. If this
    // assertion ever flips, the primary CTA has regressed below AA.
    render(<GuestButton variant="primary">Pay deposit</GuestButton>)

    const button = screen.getByRole('button', { name: 'Pay deposit' })
    expect(button.className).toContain('bg-anchor-gold-dark')
    expect(button.className).toContain('text-white')
    expect(button.className).not.toContain('bg-anchor-gold ')
  })

  it('renders every variant and size', () => {
    const { container } = render(
      <>
        <GuestButton variant="primary" size="sm">
          Primary
        </GuestButton>
        <GuestButton variant="outline" size="md">
          Outline
        </GuestButton>
        <GuestButton variant="ghost" size="lg">
          Ghost
        </GuestButton>
        <GuestButton variant="danger">Danger</GuestButton>
      </>
    )

    expect(screen.getAllByRole('button')).toHaveLength(4)
    // Touch targets never drop below 44px on these pages.
    expect(container.querySelector('.min-h-\\[44px\\]')).not.toBeNull()
    expect(container.querySelector('.min-h-\\[48px\\]')).not.toBeNull()
    expect(container.querySelector('.min-h-\\[56px\\]')).not.toBeNull()
  })

  it('applies fullWidth explicitly rather than by breakpoint', () => {
    render(
      <>
        <GuestButton fullWidth>Wide</GuestButton>
        <GuestButton>Narrow</GuestButton>
      </>
    )

    expect(screen.getByRole('button', { name: 'Wide' }).className).toContain('w-full')
    expect(screen.getByRole('button', { name: 'Narrow' }).className).not.toContain('w-full')
  })

  it('disables the button rather than faking it with a class', () => {
    render(<GuestButton disabled>Pay deposit</GuestButton>)

    expect(screen.getByRole('button', { name: 'Pay deposit' })).toBeDisabled()
  })

  it('as="a" produces a real anchor and never nests an interactive element', () => {
    const { container } = render(
      <GuestButton as="a" href="tel:+441753682707">
        Call 01753 682707
      </GuestButton>
    )

    const link = screen.getByRole('link', { name: 'Call 01753 682707' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', 'tel:+441753682707')

    // An anchor inside a button (or the reverse) is invalid HTML and breaks
    // keyboard and screen-reader behaviour.
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('a a, a button, button a, button button')).toBeNull()
  })

  it('as="a" defaults to no-referrer and opts into external target only when asked', () => {
    const { rerender } = render(
      <GuestButton as="a" href="/privacy">
        Privacy
      </GuestButton>
    )

    let link = screen.getByRole('link', { name: 'Privacy' })
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(link).not.toHaveAttribute('target')

    rerender(
      <GuestButton as="a" href="https://www.the-anchor.pub" external>
        Back to The Anchor
      </GuestButton>
    )

    link = screen.getByRole('link', { name: 'Back to The Anchor' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('as="link" routes through next/link and still suppresses the referrer', () => {
    const { container } = render(
      <GuestButton as="link" href="/feedback/thanks">
        Thanks
      </GuestButton>
    )

    const link = screen.getByRole('link', { name: 'Thanks' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/feedback/thanks')
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(container.querySelector('button')).toBeNull()
  })
})
