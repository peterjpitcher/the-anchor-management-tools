import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OutstandingCounts } from '@/actions/get-outstanding-counts'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/ds/icons', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

vi.mock('@/hooks/useUnreadMessageCount', () => ({
  useUnreadMessageCount: () => 3,
}))

vi.mock('@/hooks/useOutstandingCounts', () => ({
  useOutstandingCounts: () => ({
    counts: {
      events: 2,
      menu_management: 0,
      table_bookings: 0,
      private_bookings: 0,
      parking: 0,
      cashing_up: 0,
      invoices: 0,
      receipts: 0,
    } satisfies OutstandingCounts,
    loading: false,
    error: null,
  }),
}))

import { SidebarNav, navCount } from '../SidebarNav'
import type { NavGroup } from '../SidebarNav'

const FULL_COUNTS: OutstandingCounts = {
  events: 4,
  menu_management: 5,
  table_bookings: 6,
  private_bookings: 7,
  parking: 8,
  cashing_up: 9,
  invoices: 10,
  receipts: 11,
}

describe('navCount', () => {
  it('maps the messages item to the unread message count', () => {
    expect(navCount({ id: 'messages' }, 3, FULL_COUNTS)).toBe(3)
  })

  it('returns undefined for messages when there are no unread messages', () => {
    expect(navCount({ id: 'messages' }, 0, FULL_COUNTS)).toBeUndefined()
  })

  it('maps each outstanding-count section to its live count', () => {
    expect(navCount({ id: 'events' }, 0, FULL_COUNTS)).toBe(4)
    expect(navCount({ id: 'menu' }, 0, FULL_COUNTS)).toBe(5)
    expect(navCount({ id: 'tables' }, 0, FULL_COUNTS)).toBe(6)
    expect(navCount({ id: 'private-bookings' }, 0, FULL_COUNTS)).toBe(7)
    expect(navCount({ id: 'parking' }, 0, FULL_COUNTS)).toBe(8)
    expect(navCount({ id: 'cashing-up' }, 0, FULL_COUNTS)).toBe(9)
    expect(navCount({ id: 'invoices' }, 0, FULL_COUNTS)).toBe(10)
    expect(navCount({ id: 'receipts' }, 0, FULL_COUNTS)).toBe(11)
  })

  it('falls back to the static badge when live counts are unavailable', () => {
    expect(navCount({ id: 'events', badge: 12 }, 0, null)).toBe(12)
  })

  it('lets a live count of 0 win over a static badge (no stale badge)', () => {
    const zeroed: OutstandingCounts = { ...FULL_COUNTS, events: 0 }
    expect(navCount({ id: 'events', badge: 12 }, 0, zeroed)).toBe(0)
  })

  it('returns undefined for an uncounted section', () => {
    expect(navCount({ id: 'customers' }, 0, FULL_COUNTS)).toBeUndefined()
  })
})

describe('SidebarNav', () => {
  const items: NavGroup[] = [
    {
      label: null,
      items: [
        { id: 'events', label: 'Events', icon: 'calendar', href: '/events' },
        { id: 'messages', label: 'Messages', icon: 'message', href: '/messages' },
        { id: 'customers', label: 'Customers', icon: 'users', href: '/customers' },
      ],
    },
  ]

  it('renders live outstanding-count badges on the desktop sidebar', () => {
    render(<SidebarNav items={items} />)

    // Events badge (from outstanding counts) and Messages badge (from unread count).
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    // Customers has no count → no badge.
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
