'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/ds/icons'
import type { IconName } from '@/ds/icons'
import type { ActionType, ModuleName } from '@/types/rbac'
import type { OutstandingCounts } from '@/actions/get-outstanding-counts'
import { useNavCounts } from './NavCountsContext'

export interface NavItem {
  id: string
  label: string
  icon: string
  href: string
  badge?: number
  permission?: {
    module: ModuleName
    action: ActionType
  }
  /**
   * For a feature restricted to super-admins rather than granted by a permission
   * row. `permission` cannot express that: user_has_permission returns true for a
   * super-admin on any module name, including one that was never created, so an
   * RBAC module can only ever raise a floor, never impose a ceiling.
   */
  superAdminOnly?: boolean
}

/**
 * What a nav badge shows. `'unavailable'` is not a number and is not zero: it
 * means the count could not be read. Zero means there is nothing outstanding, so
 * showing it in place of a failed read would be a lie.
 */
export type NavBadge = number | 'unavailable' | undefined

export interface NavGroup {
  label: string | null
  items: NavItem[]
}

/**
 * Group labels live on the data, not on position. The mobile drawer used to
 * title its groups from a fixed array indexed by position, but
 * `filterNavGroupsForPermissions` drops groups a user cannot see, so the indexes
 * shifted and a restricted user got the wrong heading over every group.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      // `/` only ever redirects to `/dashboard` (src/app/page.tsx), so linking
      // to `/` meant the active check never matched the path the user actually
      // lands on and Dashboard was never highlighted.
      { id: 'dashboard', label: 'Dashboard', icon: 'home', href: '/dashboard', permission: { module: 'dashboard', action: 'view' } },
      { id: 'events', label: 'Events', icon: 'calendar', href: '/events', permission: { module: 'events', action: 'view' } },
      { id: 'customers', label: 'Customers', icon: 'users', href: '/customers', permission: { module: 'customers', action: 'view' } },
      { id: 'marketing', label: 'Marketing', icon: 'mail', href: '/marketing', permission: { module: 'marketing', action: 'view' } },
      { id: 'messages', label: 'Messages', icon: 'message', href: '/messages', permission: { module: 'messages', action: 'view' } },
      { id: 'feedback', label: 'Feedback', icon: 'message', href: '/feedback-inbox', permission: { module: 'feedback', action: 'view' } },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'menu', label: 'Menu Management', icon: 'grid', href: '/menu-management', permission: { module: 'menu_management', action: 'view' } },
      { id: 'tables', label: 'Table Bookings', icon: 'table', href: '/table-bookings', permission: { module: 'table_bookings', action: 'view' } },
      { id: 'vouchers', label: 'Vouchers', icon: 'ticket', href: '/vouchers', permission: { module: 'vouchers', action: 'manage' } },
      { id: 'private-bookings', label: 'Private Bookings', icon: 'building', href: '/private-bookings', permission: { module: 'private_bookings', action: 'view' } },
      { id: 'parking', label: 'Parking', icon: 'truck', href: '/parking', permission: { module: 'parking', action: 'view' } },
      // Repairs and improvements to the building, not table_holds.hold_type =
      // 'maintenance', which is a live and unrelated way of taking a table out of
      // service. Super-admin only, and no permission gate for the reason given on
      // NavItem.superAdminOnly.
      { id: 'maintenance', label: 'Maintenance', icon: 'alertTriangle', href: '/maintenance', superAdminOnly: true },
    ],
  },
  {
    label: 'Staff',
    items: [
      { id: 'employees', label: 'Employees', icon: 'user', href: '/employees', permission: { module: 'employees', action: 'view' } },
      { id: 'recruitment', label: 'Recruitment', icon: 'briefcase', href: '/recruitment', permission: { module: 'recruitment', action: 'view' } },
      { id: 'rota', label: 'Rota', icon: 'clock', href: '/rota', permission: { module: 'rota', action: 'view' } },
      { id: 'checklists', label: 'Checklists', icon: 'check', href: '/checklists/manage', permission: { module: 'checklists', action: 'manage' } },
    ],
  },
  {
    label: 'Finance',
    items: [
      { id: 'cashing-up', label: 'Cashing Up', icon: 'cash', href: '/cashing-up/dashboard', permission: { module: 'cashing_up', action: 'view' } },
      { id: 'invoices', label: 'Invoices', icon: 'file', href: '/invoices', permission: { module: 'invoices', action: 'view' } },
      { id: 'quotes', label: 'Quotes', icon: 'file', href: '/quotes', permission: { module: 'quotes', action: 'view' } },
      { id: 'projects', label: 'OJ Projects', icon: 'briefcase', href: '/oj-projects', permission: { module: 'oj_projects', action: 'view' } },
      { id: 'receipts', label: 'Receipts', icon: 'receipt', href: '/receipts', permission: { module: 'receipts', action: 'view' } },
      { id: 'mileage', label: 'Mileage', icon: 'map', href: '/mileage', permission: { module: 'mileage', action: 'view' } },
      { id: 'expenses', label: 'Expenses', icon: 'pound', href: '/expenses', permission: { module: 'expenses', action: 'view' } },
      { id: 'mgd', label: 'MGD', icon: 'trendUp', href: '/mgd', permission: { module: 'mgd', action: 'view' } },
      { id: 'short-links', label: 'Short Links', icon: 'link', href: '/short-links', permission: { module: 'short_links', action: 'view' } },
    ],
  },
  {
    label: 'Admin',
    items: [
      { id: 'settings', label: 'Settings', icon: 'cog', href: '/settings', permission: { module: 'settings', action: 'view' } },
      { id: 'users', label: 'Users', icon: 'users', href: '/users', permission: { module: 'users', action: 'view' } },
      { id: 'roles', label: 'Roles', icon: 'cog', href: '/roles', permission: { module: 'roles', action: 'view' } },
      { id: 'profile', label: 'My Profile', icon: 'user', href: '/profile' },
    ],
  },
]

/**
 * `isSuperAdmin` defaults to false, so a caller that has not been taught about
 * super-admin-only items hides them rather than showing them to everyone. Hiding
 * an item is never the boundary in any case: the page and every server action
 * re-check the role.
 */
export function filterNavGroupsForPermissions(
  groups: NavGroup[],
  hasPermission: (module: ModuleName, action: ActionType) => boolean,
  options?: { isSuperAdmin?: boolean },
): NavGroup[] {
  const isSuperAdmin = options?.isSuperAdmin ?? false

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.superAdminOnly && !isSuperAdmin) return false
        if (!item.permission) return true
        return hasPermission(item.permission.module, item.permission.action)
      }),
    }))
    .filter((group) => group.items.length > 0)
}

/**
 * Resolves the live outstanding-count badge for a nav item. Shared by the
 * desktop sidebar and the mobile chrome so both stay in sync. Falls back to any
 * static `item.badge` when live counts are unavailable.
 *
 * A badge means "work you can clear from here". Only add an id to the map below
 * when the underlying count drops as staff do the work: a count that waits on a
 * customer never reaches zero and trains people to ignore every badge.
 */
export function navCount(
  item: Pick<NavItem, 'id' | 'badge'>,
  unreadCount: number,
  counts: OutstandingCounts | null,
): NavBadge {
  if (item.id === 'messages') return unreadCount > 0 ? unreadCount : undefined
  if (!counts) return item.badge

  const countById: Record<string, NavBadge> = {
    events: counts.events,
    menu: counts.menu_management,
    'private-bookings': counts.private_bookings,
    'cashing-up': counts.cashing_up,
    invoices: counts.invoices,
    receipts: counts.receipts,
    rota: counts.rota,
    checklists: counts.checklists,
    feedback: counts.feedback,
    // Three states, not two. Absent means this user may not see the count at all
    // and it never left the server; null means the read failed, which is shown as
    // unavailable rather than as a zero nobody could act on.
    maintenance: counts.maintenance === null ? 'unavailable' : counts.maintenance,
  }

  // A live count wins even when it is 0 (0 = "nothing outstanding", not "no
  // data"); only fall back to a static badge for items we don't track.
  if (item.id in countById) return countById[item.id]
  return item.badge
}

/**
 * The text on a badge. Shared by the sidebar and the mobile chrome so a count
 * cannot read one way on a phone and another on a laptop. '!' marks a count that
 * could not be read; it is never shown as a number.
 */
export function navBadgeText(count: Exclude<NavBadge, undefined>): string {
  if (count === 'unavailable') return '!'
  return count > 99 ? '99+' : String(count)
}

interface SidebarNavProps {
  items: NavGroup[]
  onNavigate?: () => void
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}

export function SidebarNav({ items, onNavigate }: SidebarNavProps) {
  const pathname = usePathname() ?? '/'
  const { unreadCount, counts } = useNavCounts()

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-0.5">
      {items.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && (
            <div className="ds-group-divider border-t border-sidebar-border my-2 mx-2" />
          )}
          {group.items.map((item) => {
            const active = isActive(pathname, item.href)
            const count = navCount(item, unreadCount, counts)
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={onNavigate}
                className={`flex items-center gap-3 px-3 py-2 mx-2 rounded-[var(--radius-default)] text-[13px] font-medium transition-colors ${
                  active
                    ? 'bg-sidebar-active-bg text-sidebar-fg'
                    : 'text-sidebar-fg-muted hover:bg-sidebar-hover-bg hover:text-sidebar-fg'
                }`}
              >
                <span className="relative shrink-0">
                  <Icon name={item.icon as IconName} size={20} className="shrink-0" />
                  {/* The numeric badge below is a `.ds-label`, so it is hidden
                      while the rail is collapsed. This dot is its stand-in, and
                      fades out as the real badge fades in. */}
                  {count ? (
                    <span
                      className="ds-collapsed-dot absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger ring-2 ring-sidebar-bg"
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
                <span className="ds-label truncate">{item.label}</span>
                {count ? (
                  <span
                    className="ds-label ml-auto inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-sidebar-active-bg text-[11px] font-semibold text-sidebar-fg"
                    // The state is spelled out for a screen reader rather than
                    // left to a glyph, and "unavailable" is never dressed up as a
                    // number.
                    aria-label={
                      count === 'unavailable'
                        ? `${item.label} count unavailable`
                        : `${count} outstanding in ${item.label}`
                    }
                    title={count === 'unavailable' ? 'Count unavailable' : undefined}
                  >
                    {navBadgeText(count)}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
