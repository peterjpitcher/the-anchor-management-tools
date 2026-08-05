import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuestShell } from '@/components/features/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

// next/font/google is a build-time transform. Under Vitest the real module has
// no loader, so stub the three faces the guest font module asks for.
vi.mock('next/font/google', () => {
  const font = (): { variable: string; className: string } => ({
    variable: 'mock-font-variable',
    className: 'mock-font',
  })
  return { DM_Serif_Display: font, Outfit: font, Clicker_Script: font }
})

describe('GuestShell', () => {
  it('renders exactly one main landmark, so page roots never add a second', () => {
    const { container } = render(
      <GuestShell>
        <p>Body content</p>
      </GuestShell>
    )

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveTextContent('Body content')
  })

  it('scopes every guest style and webfont to its own wrapper', () => {
    const { container } = render(
      <GuestShell>
        <p>Body content</p>
      </GuestShell>
    )

    // The one element carrying `guest-theme` is the shell root. Nothing outside
    // it can match the scoped rules in globals.css.
    const themed = container.querySelectorAll('.guest-theme')
    expect(themed).toHaveLength(1)
    expect(themed[0]).toBe(container.firstElementChild)
    expect(themed[0].className).toContain('mock-font-variable')
  })

  it('sets no-referrer on every footer link, so a bearer token never leaks onward', () => {
    render(
      <GuestShell>
        <p>Body content</p>
      </GuestShell>
    )

    const footer = screen.getByRole('contentinfo')
    const links = Array.from(footer.querySelectorAll('a'))

    // The app sends `Referrer-Policy: strict-origin-when-cross-origin`, which
    // includes the FULL path on same-origin navigation. These pages carry a
    // token in the URL, so /privacy would otherwise log /g/<token>/...
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
    }

    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: 'The Anchor website' })).toHaveAttribute(
      'href',
      GUEST_CONTACT.website
    )
  })

  it('renders contact facts from the single source, display and dial kept apart', () => {
    render(
      <GuestShell>
        <p>Body content</p>
      </GuestShell>
    )

    const phone = screen.getByRole('link', { name: GUEST_CONTACT.phoneDisplay })
    expect(phone).toHaveAttribute('href', 'tel:+441753682707')
    expect(phone).toHaveTextContent('01753 682707')

    expect(screen.getByRole('link', { name: GUEST_CONTACT.email })).toHaveAttribute(
      'href',
      'mailto:manager@the-anchor.pub'
    )
    expect(
      screen.getByText('The Anchor, Horton Road, Stanwell Moor Village, Surrey TW19 6AQ')
    ).toBeInTheDocument()
  })

  it('honours the width, padding and centring overrides the feedback pages need', () => {
    render(
      <GuestShell maxWidthClassName="max-w-2xl" bodyClassName="pt-10" centred>
        <p>Body content</p>
      </GuestShell>
    )

    const main = screen.getByRole('main')
    expect(main.className).toContain('max-w-2xl')
    expect(main.className).toContain('items-center')
    expect(main.className).toContain('text-center')
    expect(main.className).not.toContain('max-w-[560px]')
  })
})
