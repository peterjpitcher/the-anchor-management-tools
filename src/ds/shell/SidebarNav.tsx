'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/ds/icons'
import type { IconName } from '@/ds/icons'

export interface NavItem {
  id: string
  label: string
  icon: string
  href: string
  badge?: number
}

export interface NavGroup {
  label: string | null
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'home', href: '/' },
      { id: 'events', label: 'Events', icon: 'calendar', href: '/events' },
      { id: 'performers', label: 'Performers', icon: 'mic', href: '/performers' },
      { id: 'customers', label: 'Customers', icon: 'users', href: '/customers' },
      { id: 'messages', label: 'Messages', icon: 'message', href: '/messages' },
    ],
  },
  {
    label: null,
    items: [
      { id: 'menu', label: 'Menu Management', icon: 'grid', href: '/menu-management' },
      { id: 'tables', label: 'Table Bookings', icon: 'table', href: '/table-bookings' },
      { id: 'private-bookings', label: 'Private Bookings', icon: 'building', href: '/private-bookings' },
      { id: 'parking', label: 'Parking', icon: 'truck', href: '/parking' },
    ],
  },
  {
    label: null,
    items: [
      { id: 'employees', label: 'Employees', icon: 'user', href: '/employees' },
      { id: 'rota', label: 'Rota', icon: 'clock', href: '/rota' },
    ],
  },
  {
    label: null,
    items: [
      { id: 'cashing-up', label: 'Cashing Up', icon: 'cash', href: '/cashing-up/dashboard' },
      { id: 'invoices', label: 'Invoices', icon: 'file', href: '/invoices' },
      { id: 'quotes', label: 'Quotes', icon: 'file', href: '/quotes' },
      { id: 'projects', label: 'OJ Projects', icon: 'briefcase', href: '/oj-projects' },
      { id: 'receipts', label: 'Receipts', icon: 'receipt', href: '/receipts' },
      { id: 'mileage', label: 'Mileage', icon: 'map', href: '/mileage' },
      { id: 'expenses', label: 'Expenses', icon: 'pound', href: '/expenses' },
      { id: 'mgd', label: 'MGD', icon: 'trendUp', href: '/mgd' },
      { id: 'short-links', label: 'Short Links', icon: 'link', href: '/short-links' },
    ],
  },
  {
    label: null,
    items: [
      { id: 'settings', label: 'Settings', icon: 'cog', href: '/settings' },
      { id: 'system', label: 'Design System', icon: 'palette', href: '/design-system' },
    ],
  },
]

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

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-0.5">
      {items.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && (
            <div className="ds-group-divider border-t border-sidebar-border my-2 mx-2" />
          )}
          {group.items.map((item) => {
            const active = isActive(pathname, item.href)
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
                <Icon name={item.icon as IconName} size={20} className="shrink-0" />
                <span className="ds-label truncate">{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="ds-label ml-auto inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-sidebar-active-bg text-[11px] font-semibold text-sidebar-fg">
                    {item.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
