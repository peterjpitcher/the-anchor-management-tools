import { cloneElement, isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import DesignSystemPage from '@/app/(authenticated)/settings/design-system/page'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings/design-system',
}))

// jsdom has no layout, so ResponsiveContainer measures 0 x 0 and draws nothing. Give each chart
// a fixed size instead, as src/ds/composites/Chart.test.tsx does.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div>
        {isValidElement<{ width?: number; height?: number }>(children)
          ? cloneElement(children, { width: 600, height: 240 })
          : children}
      </div>
    ),
  }
})

describe('the design system reference page', () => {
  beforeEach(() => {
    push.mockReset()
    // Stands in for the stylesheet: the page must print what :root holds, not a copied value.
    document.documentElement.style.setProperty('--color-primary', 'rgb(1, 2, 3)')
    document.documentElement.style.setProperty('--radius-lg', '14px')
  })

  afterEach(() => {
    document.documentElement.style.removeProperty('--color-primary')
    document.documentElement.style.removeProperty('--radius-lg')
  })

  it('follows the page contract: one PageLayout titled from its Settings tile, back to Settings, no breadcrumbs', () => {
    render(<DesignSystemPage />)

    expect(screen.getAllByRole('heading', { level: 1, name: 'Design System' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('navigation', { name: /breadcrumbs/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Back to Settings' })[0])
    expect(push).toHaveBeenCalledWith('/settings')
  })

  it('links every contents entry to a section on the page, each headed by a Section h2', () => {
    const { container } = render(<DesignSystemPage />)
    const contents = screen.getByRole('navigation', { name: 'Design system contents' })
    // The contents card has no CardHeader, so its group headings are SubHeading h3s.
    expect(within(contents).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Foundations',
      'Components',
      'Guest',
    ])
    const links = within(contents).getAllByRole('link')
    expect(links.length).toBeGreaterThan(10)

    for (const link of links) {
      const id = link.getAttribute('href')?.replace('#', '') ?? ''
      const section = container.querySelector(`section#${id}`)
      expect(section, `no section for ${id}`).not.toBeNull()
      expect(within(section as HTMLElement).getAllByRole('heading', { level: 2 })[0]).toHaveTextContent(link.textContent ?? '')
    }
  })

  it('prints token values read live from :root', () => {
    render(<DesignSystemPage />)
    expect(screen.getAllByText('rgb(1, 2, 3)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('14px').length).toBeGreaterThan(0)
  })

  // Three dialogs opened by accessible-name lookups across the whole reference page. About 1.2 s
  // locally but 5.8 to 6 s in CI with coverage on and the full suite in parallel, so the default
  // 5 s timeout failed main's CI on four of five runs (27 Sep 2026). The test is right; the budget
  // was not.
  it('shows the Modal description and both ConfirmDialog tones', { timeout: 15_000 }, () => {
    render(<DesignSystemPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Modal' }))
    const modal = screen.getByRole('dialog', { name: 'Edit Day Note' })
    expect(modal).toHaveAccessibleDescription('Shown to staff on the rota for this day')
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Publish Rota' }))
    const publish = screen.getByRole('dialog', { name: 'Publish Rota' })
    expect(within(publish).getByRole('button', { name: 'Publish' })).toHaveClass('bg-primary')
    fireEvent.click(within(publish).getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete Shift' }))
    const remove = screen.getByRole('dialog', { name: 'Delete Shift' })
    expect(within(remove).getByRole('button', { name: 'Delete' })).toHaveClass('bg-danger')
  })

  it('names every chart for screen readers', () => {
    render(<DesignSystemPage />)
    for (const name of [
      'Covers by day, example data',
      'Covers and bookings by week, example data',
      'Revenue and margin by week, example data',
      'Takings by day against target, example data',
    ]) {
      expect(screen.getByRole('figure', { name })).toBeInTheDocument()
    }
  })

  it('draws the guest type samples with a generic fallback, since the guest webfonts only load inside GuestShell', () => {
    render(<DesignSystemPage />)
    // At :root the guest font aliases are invalid, so a bare var() would inherit the staff font.
    const styles = screen.getAllByText('Your table is booked').map((sample) => sample.getAttribute('style') ?? '')
    expect(styles.some((style) => style.includes('var(--font-anchor-display, serif)'))).toBe(true)
    expect(styles.some((style) => style.includes('var(--font-anchor-body, sans-serif)'))).toBe(true)
    expect(screen.getByText('The Anchor').getAttribute('style') ?? '').toContain('var(--font-anchor-script, cursive)')
  })

  it('links to the guest component preview outside production', () => {
    render(<DesignSystemPage />)
    expect(screen.getByRole('link', { name: 'Open Guest Preview' })).toHaveAttribute('href', '/guest-preview')
    expect(screen.getByText(/returns 404 in production/)).toBeInTheDocument()
  })
})
