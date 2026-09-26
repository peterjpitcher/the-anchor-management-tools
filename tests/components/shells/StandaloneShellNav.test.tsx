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
    expect(screen.getByRole('link', { name: 'My Holiday' })).not.toHaveAttribute('aria-current')
  })

  it('lights the other tab on its own page', () => {
    pathname = '/portal/leave'
    render(<StandaloneShellNav items={PORTAL_NAV} label="Staff Portal" />)

    expect(screen.getByRole('link', { name: 'My Holiday' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'My Shifts' })).not.toHaveAttribute('aria-current')
  })

  it('shows no tab row on a child page, which has its back button instead', () => {
    pathname = '/portal/leave/new'
    render(<StandaloneShellNav items={PORTAL_NAV} label="Staff Portal" />)

    expect(screen.queryByRole('navigation', { name: 'Staff Portal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('uses real links, not full page reloads from bare anchors', () => {
    pathname = '/portal/shifts'
    render(<StandaloneShellNav items={PORTAL_NAV} label="Staff Portal" />)

    expect(screen.getByRole('navigation', { name: 'Staff Portal' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My Holiday' })).toHaveAttribute('href', '/portal/leave')
  })
})
