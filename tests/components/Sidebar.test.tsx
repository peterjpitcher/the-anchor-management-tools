import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
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

  it('preserves native modified clicks without dismissing the menu', () => {
    const { container } = render(<Sidebar navGroups={NAV_GROUPS} />)
    const link = screen.getByRole('link', { name: 'Events' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand menu' }))
    fireEvent.click(link, { ctrlKey: true })
    expect(container.querySelector('.ds-sidebar')).toHaveAttribute('data-expanded', 'true')
  })
})


describe('hover navigation', () => {
  it('opens on pointer entry and closes on leave even with a focused link', () => {
    const { container } = render(<Sidebar navGroups={NAV_GROUPS} />)
    const panel = container.querySelector('.ds-sidebar') as HTMLElement
    fireEvent.pointerEnter(panel, { pointerType: 'mouse' })
    expect(panel).toHaveAttribute('data-expanded', 'true')
    screen.getByRole('link', { name: 'Dashboard' }).focus()
    fireEvent.pointerLeave(panel, { pointerType: 'mouse' })
    expect(panel).toHaveAttribute('data-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Find or go to' })).not.toBeInTheDocument()
  })
})
