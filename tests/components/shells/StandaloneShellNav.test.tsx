import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StandaloneShellNav } from '@/components/shells/StandaloneShellNav'
import { PORTAL_NAV } from '@/app/(staff-portal)/portal/_shared/nav'

let pathname = '/portal/shifts'

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}))

describe('staff portal tab row', () => {
  it('lights the tab for the current page', () => {
    pathname = '/portal/shifts'
    render(<StandaloneShellNav items={PORTAL_NAV} label="Staff Portal" />)

    expect(screen.getByRole('link', { name: 'My Shifts' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Holiday' })).not.toHaveAttribute('aria-current')
  })

  it('keeps the parent tab lit on a page below it', () => {
    pathname = '/portal/leave/new'
    render(<StandaloneShellNav items={PORTAL_NAV} label="Staff Portal" />)

    expect(screen.getByRole('link', { name: 'Holiday' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'My Shifts' })).not.toHaveAttribute('aria-current')
  })

  it('uses real links, not full page reloads from bare anchors', () => {
    pathname = '/portal/shifts'
    render(<StandaloneShellNav items={PORTAL_NAV} label="Staff Portal" />)

    expect(screen.getByRole('navigation', { name: 'Staff Portal' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Holiday' })).toHaveAttribute('href', '/portal/leave')
  })
})
