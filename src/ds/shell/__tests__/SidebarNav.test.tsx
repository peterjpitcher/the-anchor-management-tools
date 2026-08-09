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
      private_bookings: 0,
      cashing_up: 0,
      invoices: 0,
      receipts: 0,
      rota: 0,
      checklists: 0,
      feedback: 0,
    } satisfies OutstandingCounts,
    loading: false,
    error: null,
  }),
}))

import { SidebarNav, navCount, filterNavGroupsForPermissions, NAV_GROUPS } from '../SidebarNav'
import type { NavGroup } from '../SidebarNav'
import { NavCountsProvider } from '../NavCountsContext'

const FULL_COUNTS: OutstandingCounts = {
  events: 4,
  menu_management: 5,
  private_bookings: 7,
  cashing_up: 9,
  invoices: 10,
  receipts: 11,
  rota: 12,
  checklists: 13,
  feedback: 14,
}

describe('NAV_GROUPS', () => {
  it('points Dashboard at /dashboard, the path `/` redirects to', () => {
    // `/` only ever redirects, so an item hrefed to `/` could never match the
    // path the user actually lands on and was never highlighted as active.
    const dashboard = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === 'dashboard')
    expect(dashboard?.href).toBe('/dashboard')
  })

  it('gives every group its own label', () => {
    // The mobile drawer renders these. It used to index a positional array of
    // titles instead, which broke as soon as a group was filtered out.
    expect(NAV_GROUPS.every((group) => Boolean(group.label))).toBe(true)
  })
})

describe('filterNavGroupsForPermissions', () => {
  it('keeps each surviving group paired with its own label', () => {
    // A staff user with none of the Overview permissions. Before labels moved
    // onto the data, dropping group 0 shifted every later group up an index and
    // the drawer titled Operations "Overview", Staff "Operations", and so on.
    const allowed = new Set(['table_bookings', 'rota'])
    const filtered = filterNavGroupsForPermissions(NAV_GROUPS, (module) => allowed.has(module))

    // Admin survives on "My Profile", which every user gets (no permission gate).
    expect(filtered.map((group) => group.label)).toEqual(['Operations', 'Staff', 'Admin'])
    expect(filtered[0].items.map((i) => i.id)).toEqual(['tables'])
    expect(filtered[1].items.map((i) => i.id)).toEqual(['rota'])
    expect(filtered[2].items.map((i) => i.id)).toEqual(['profile'])
  })
})

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
    expect(navCount({ id: 'private-bookings' }, 0, FULL_COUNTS)).toBe(7)
    expect(navCount({ id: 'cashing-up' }, 0, FULL_COUNTS)).toBe(9)
    expect(navCount({ id: 'invoices' }, 0, FULL_COUNTS)).toBe(10)
    expect(navCount({ id: 'receipts' }, 0, FULL_COUNTS)).toBe(11)
    expect(navCount({ id: 'rota' }, 0, FULL_COUNTS)).toBe(12)
    expect(navCount({ id: 'checklists' }, 0, FULL_COUNTS)).toBe(13)
    expect(navCount({ id: 'feedback' }, 0, FULL_COUNTS)).toBe(14)
  })

  it('gives Parking no badge, because nothing there is staff-actionable', () => {
    // Parking only ever waited on the guest to pay, which resolves itself to
    // paid or expired. A badge there could never be worked down to zero.
    expect(navCount({ id: 'parking' }, 0, FULL_COUNTS)).toBeUndefined()
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
    // Counts flow through the shared provider (which reads the mocked hooks).
    render(
      <NavCountsProvider>
        <SidebarNav items={items} />
      </NavCountsProvider>,
    )

    // Events badge (from outstanding counts) and Messages badge (from unread count).
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    // Customers has no count → no badge.
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
