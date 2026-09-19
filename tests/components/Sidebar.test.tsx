import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/ds/shell/Sidebar'
import { NAV_GROUPS } from '@/ds/shell/SidebarNav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/feedback-inbox',
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: Omit<ComponentPropsWithoutRef<'a'>, 'href'> & {
    href: string | { toString: () => string }
    children: ReactNode
  }) => (
    <a href={typeof href === 'string' ? href : href.toString()} {...rest} onClick={event => { rest.onClick?.(event); event.preventDefault() }}>
      {children}
    </a>
  ),
}))

describe('Sidebar', () => {
  it('keeps the desktop nav scrollable with the user footer pinned outside it', () => {
    const { container } = render(
      <Sidebar
        navGroups={NAV_GROUPS}
        userName="peter"
        userRole="Super Admin"
        onSignOut={vi.fn()}
        isSigningOut={false}
      />,
    )

    const scrollContainer = container.querySelector('.ds-sidebar-scroll')
    const footer = container.querySelector('.ds-sidebar-footer')

    expect(scrollContainer).toBeInTheDocument()
    expect(scrollContainer).toHaveClass(
      'flex-1',
      'min-h-0',
      'overflow-y-auto',
      'overflow-x-hidden',
      'py-0.5',
    )
    expect(scrollContainer).not.toHaveClass('overflow-hidden')

    expect(footer).toBeInTheDocument()
    expect(footer).toHaveClass('shrink-0')
    expect(scrollContainer).not.toContainElement(footer as HTMLElement)
    expect(footer).toHaveTextContent('Super Admin')

    for (const label of NAV_GROUPS.flatMap((group) => group.items.map((item) => item.label))) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})


describe('transient menu expansion', () => {
  it('closes after selection even while the selected link retains focus', () => {
    const { container } = render(<Sidebar navGroups={NAV_GROUPS} />)
    const panel = container.querySelector('.ds-sidebar') as HTMLElement
    const link = screen.getByRole('link', { name: 'Table Bookings' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand menu' }))
    expect(panel).toHaveAttribute('data-expanded', 'true')
    fireEvent.click(link)
    expect(panel).toHaveAttribute('data-expanded', 'false')
    // Focus on the next keyboard destination must still reveal the labels.
    fireEvent.click(screen.getByRole('button', { name: 'Expand menu' }))
    expect(panel).toHaveAttribute('data-expanded', 'true')
  })

  it('respects deliberate pin-open mode after selection', () => {
    const { container } = render(<Sidebar navGroups={NAV_GROUPS} pinned onPinnedChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('link', { name: 'Table Bookings' }))
    expect(container.querySelector('.ds-sidebar')).toHaveAttribute('data-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Unpin menu' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('preserves native modified clicks without dismissing the menu', () => {
    const { container } = render(<Sidebar navGroups={NAV_GROUPS} />)
    const link = screen.getByRole('link', { name: 'Events' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand menu' }))
    fireEvent.click(link, { ctrlKey: true })
    expect(container.querySelector('.ds-sidebar')).toHaveAttribute('data-expanded', 'true')
  })
})


describe('shortcut dialog coordination', () => {
  it('does not unpin the sidebar when Escape bubbles from a portalled child', () => {
    const onPinnedChange = vi.fn()
    const { container } = render(
      <Sidebar navGroups={NAV_GROUPS} pinned onPinnedChange={onPinnedChange}
        shortcutControl={createPortal(<button type="button">Shortcut dialog control</button>, document.body)} />,
    )
    const dialogControl = screen.getByRole('button', { name: 'Shortcut dialog control' })
    expect(container.querySelector('.ds-sidebar')).not.toContainElement(dialogControl)
    fireEvent.keyDown(dialogControl, { key: 'Escape' })
    expect(onPinnedChange).not.toHaveBeenCalled()
    expect(container.querySelector('.ds-sidebar')).toHaveAttribute('data-expanded', 'true')
    // Escape originating in the sidebar itself still performs its normal action.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Collapse menu' }), { key: 'Escape' })
    expect(onPinnedChange).toHaveBeenCalledWith(false)
  })

  it('preserves transient expansion through pointer leave and focus entering the chooser', () => {
    const { container, rerender } = render(<Sidebar navGroups={NAV_GROUPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand menu' }))
    rerender(<Sidebar navGroups={NAV_GROUPS} shortcutPickerOpen />)
    const panel = container.querySelector('.ds-sidebar') as HTMLElement
    fireEvent.pointerLeave(panel)
    fireEvent.blur(screen.getByRole('button', { name: 'Collapse menu' }), { relatedTarget: document.body })
    expect(panel).toHaveAttribute('data-expanded', 'true')
    // Closing the chooser must leave the trigger available for focus restoration.
    rerender(<Sidebar navGroups={NAV_GROUPS} shortcutPickerOpen={false} />)
    expect(panel).toHaveAttribute('data-expanded', 'true')
    fireEvent.pointerLeave(panel)
    expect(panel).toHaveAttribute('data-expanded', 'false')
  })
})
