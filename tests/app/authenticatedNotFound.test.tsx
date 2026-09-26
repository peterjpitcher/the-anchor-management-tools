// The staff 404 (src/app/(authenticated)/not-found.tsx): a notFound() inside a staff page shows
// this inside the app shell, on the page contract, with a way back to the dashboard. Which
// not-found Next picks for which URL was checked on a real Next 15.5 build; this only pins what
// the page renders.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/invoices/missing',
  useSearchParams: () => new URLSearchParams(),
}))

import AuthenticatedNotFound from '@/app/(authenticated)/not-found'

describe('staff 404', () => {
  it('titles the page Page Not Found and links to the dashboard', () => {
    render(<AuthenticatedNotFound />)

    // PageLayout draws the title in its phone and desktop headers.
    expect(screen.getAllByRole('heading', { level: 1, name: 'Page Not Found' }).length).toBeGreaterThan(0)
    expect(screen.getByText("We can't find that page")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Dashboard' })).toHaveAttribute('href', '/dashboard')
  })

  it('stays on the staff design system, never the guest brand', () => {
    const { container } = render(<AuthenticatedNotFound />)

    expect(container.querySelector('.guest-theme')).toBeNull()
    expect(screen.queryByText(/The Anchor website/)).not.toBeInTheDocument()
  })
})
