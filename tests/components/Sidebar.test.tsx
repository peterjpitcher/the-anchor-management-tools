import { render, screen } from '@testing-library/react'
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
    <a href={typeof href === 'string' ? href : href.toString()} {...rest}>
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
      'py-3',
    )
    expect(scrollContainer).not.toHaveClass('overflow-hidden')

    expect(footer).toBeInTheDocument()
    expect(footer).toHaveClass('shrink-0')
    expect(scrollContainer).not.toContainElement(footer as HTMLElement)
    expect(footer).toHaveTextContent('Super Admin')

    for (const label of NAV_GROUPS.flatMap((group) => group.items.map((item) => item.label))) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})
