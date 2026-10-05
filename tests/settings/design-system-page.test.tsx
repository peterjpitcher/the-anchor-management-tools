import { cloneElement, isValidElement, type ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
// The pure entry point: the default one unmounts after every test, and most of the tests here read
// one shared render. Nothing is unmounted for us, so every render below is paired with a cleanup.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react/pure'

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

/**
 * The header block around a page title. PageLayout draws its header twice (phone and desktop) and
 * neither is a landmark, so walk up from the h1 to the first block that holds a button.
 */
function headerBlock(title: HTMLElement): HTMLElement {
  let block = title.parentElement
  while (block && !block.querySelector('button')) block = block.parentElement
  if (!block) throw new Error('the page title has no header block with a button in it')
  return block
}

// This page is big in jsdom: about 4,000 elements and 160 buttons. Two habits made every test here
// slow enough to pass 5s on a busy machine, and neither was the page's fault:
//   - rendering the page afresh for each test, when most of them only read it;
//   - finding a button by name across the whole page. Naming a button reads its `labels`, and jsdom
//     answers each read by walking the whole document, so one lookup cost more than a render.
// So the tests that only read share one render, and each button is looked up inside the part of
// the page it lives in.
describe('the design system reference page', () => {
  beforeAll(() => {
    // Stands in for the stylesheet: the page must print what :root holds, not a copied value.
    document.documentElement.style.setProperty('--color-primary', 'rgb(1, 2, 3)')
    document.documentElement.style.setProperty('--radius-lg', '14px')
  })

  afterAll(() => {
    document.documentElement.style.removeProperty('--color-primary')
    document.documentElement.style.removeProperty('--radius-lg')
  })

  beforeEach(() => {
    push.mockReset()
  })

  // None of these changes the page, so they read one render between them.
  describe('read from one render', () => {
    let container: HTMLElement

    beforeAll(() => {
      container = render(<DesignSystemPage />).container
    })

    afterAll(() => {
      cleanup()
    })

    it('follows the page contract: one PageLayout titled from its Settings tile, back to Settings, no breadcrumbs', () => {
      const titles = screen.getAllByRole('heading', { level: 1, name: 'Design System' })
      expect(titles.length).toBeGreaterThan(0)
      expect(screen.queryByRole('navigation', { name: /breadcrumbs/i })).not.toBeInTheDocument()

      fireEvent.click(within(headerBlock(titles[0])).getByRole('button', { name: 'Back to Settings' }))
      expect(push).toHaveBeenCalledWith('/settings')
    })

    it('links every contents entry to a section on the page, each headed by a Section h2', () => {
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
      expect(screen.getAllByText('rgb(1, 2, 3)').length).toBeGreaterThan(0)
      expect(screen.getAllByText('14px').length).toBeGreaterThan(0)
    })

    it('names every chart for screen readers', () => {
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
      // At :root the guest font aliases are invalid, so a bare var() would inherit the staff font.
      const styles = screen.getAllByText('Your table is booked').map((sample) => sample.getAttribute('style') ?? '')
      expect(styles.some((style) => style.includes('var(--font-anchor-display, serif)'))).toBe(true)
      expect(styles.some((style) => style.includes('var(--font-anchor-body, sans-serif)'))).toBe(true)
      expect(screen.getByText('The Anchor').getAttribute('style') ?? '').toContain('var(--font-anchor-script, cursive)')
    })

    it('links to the guest component preview outside production', () => {
      expect(screen.getByRole('link', { name: 'Open Guest Preview' })).toHaveAttribute('href', '/guest-preview')
      expect(screen.getByText(/returns 404 in production/)).toBeInTheDocument()
    })
  })

  // Opening a dialog changes the page, so each of these draws its own. They also stay separate
  // tests: all three in one test exceeded 5s under CI coverage.
  describe('dialogs, each on its own render', () => {
    /** The Overlays section, where the dialog samples and the buttons that open them live. */
    let overlays: HTMLElement

    beforeEach(() => {
      const section = render(<DesignSystemPage />).container.querySelector('section#overlays')
      expect(section, 'no Overlays section on the page').not.toBeNull()
      overlays = section as HTMLElement
    })

    afterEach(() => {
      cleanup()
    })

    it('shows the Modal description', () => {
      fireEvent.click(within(overlays).getByRole('button', { name: 'Open Modal' }))
      const modal = screen.getByRole('dialog', { name: 'Edit Day Note' })
      expect(modal).toHaveAccessibleDescription('Shown to staff on the rota for this day')
      fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }))
    })

    it('uses the primary tone for the Publish Rota confirmation', () => {
      fireEvent.click(within(overlays).getByRole('button', { name: 'Publish Rota' }))
      const publish = screen.getByRole('dialog', { name: 'Publish Rota' })
      expect(within(publish).getByRole('button', { name: 'Publish' })).toHaveClass('bg-primary')
      fireEvent.click(within(publish).getByRole('button', { name: 'Cancel' }))
    })

    it('uses the danger tone for the Delete Shift confirmation', () => {
      fireEvent.click(within(overlays).getByRole('button', { name: 'Delete Shift' }))
      const remove = screen.getByRole('dialog', { name: 'Delete Shift' })
      expect(within(remove).getByRole('button', { name: 'Delete' })).toHaveClass('bg-danger')
    })
  })
})
