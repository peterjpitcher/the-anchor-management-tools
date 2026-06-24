'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { Anchor } from 'lucide-react'
import { Avatar } from '@/ds/primitives/Avatar'
import { Icon, type IconName } from '@/ds/icons'
import { cn } from '@/lib/utils'
import { useOutstandingCounts } from '@/hooks/useOutstandingCounts'
import { useUnreadMessageCount } from '@/hooks/useUnreadMessageCount'
import type { NavGroup, NavItem } from './SidebarNav'

const DRAWER_GROUP_TITLES = ['Overview', 'Operations', 'Staff', 'Finance', 'Admin']

const MOBILE_TABS = [
  { id: 'dashboard', label: 'Home', icon: 'home', href: '/dashboard' },
  { id: 'events', label: 'Events', icon: 'calendar', href: '/events' },
  { id: 'tables', label: 'Bookings', icon: 'table', href: '/table-bookings' },
  { id: 'messages', label: 'Messages', icon: 'message', href: '/messages' },
] satisfies Array<Pick<NavItem, 'id' | 'label' | 'icon' | 'href'>>

function mobileNavGroups(navGroups: NavGroup[]): NavGroup[] {
  return navGroups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.id === 'dashboard' ? { ...item, href: '/dashboard' } : item
    ),
  }))
}

function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function navCount(
  item: Pick<NavItem, 'id' | 'badge'>,
  unreadCount: number,
  counts: ReturnType<typeof useOutstandingCounts>['counts'],
): number | undefined {
  if (item.id === 'messages') return unreadCount > 0 ? unreadCount : undefined
  if (!counts) return item.badge

  const countById: Record<string, number | undefined> = {
    events: counts.events,
    menu: counts.menu_management,
    tables: counts.table_bookings,
    'private-bookings': counts.private_bookings,
    parking: counts.parking,
    'cashing-up': counts.cashing_up,
    invoices: counts.invoices,
    receipts: counts.receipts,
  }

  return countById[item.id] || item.badge
}

export function MobileTopbar({ onMenuOpen }: { onMenuOpen: () => void }) {
  return (
    <header className="md:hidden sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border bg-sidebar-bg px-3 text-sidebar-fg">
      <button
        type="button"
        onClick={onMenuOpen}
        className="grid h-10 w-10 place-items-center rounded-[10px] text-sidebar-fg transition-colors active:bg-white/10"
        aria-label="Open menu"
      >
        <Icon name="menu" size={20} />
      </button>

      <Link href="/dashboard" className="mr-auto flex min-w-0 items-center gap-2" aria-label="The Anchor dashboard">
        <span className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-white/20 bg-white/15">
          <Anchor className="h-[17px] w-[17px]" aria-hidden="true" />
        </span>
        <span className="truncate text-[15px] font-bold tracking-normal">The Anchor</span>
      </Link>

      <button
        type="button"
        className="grid h-10 w-10 place-items-center rounded-[10px] text-sidebar-fg transition-colors active:bg-white/10"
        aria-label="Search"
        onClick={() => window.dispatchEvent(new CustomEvent('open-global-search'))}
      >
        <Icon name="search" size={20} />
      </button>

      <Link
        href="/dashboard"
        className="relative grid h-10 w-10 place-items-center rounded-[10px] text-sidebar-fg transition-colors active:bg-white/10"
        aria-label="Notifications"
      >
        <Icon name="bell" size={20} />
        <span className="absolute right-2.5 top-2 h-2 w-2 rounded-full bg-brand-300 shadow-[0_0_0_2px_var(--color-sidebar-bg)]" />
      </Link>
    </header>
  )
}

export function MobileBottomNav({ navGroups, onMore }: { navGroups: NavGroup[]; onMore: () => void }) {
  const pathname = usePathname() ?? '/'
  const unreadCount = useUnreadMessageCount()
  const { counts } = useOutstandingCounts()
  const availableIds = new Set(navGroups.flatMap((group) => group.items.map((item) => item.id)))
  const tabs = MOBILE_TABS.filter((tab) => availableIds.has(tab.id))
  const primaryActive = tabs.some((tab) => isActivePath(pathname, tab.href))

  return (
    <nav
      className="md:hidden grid shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--color-border),0_-8px_24px_-16px_rgba(0,0,0,0.18)]"
      style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
      aria-label="Mobile navigation"
    >
      {tabs.map((tab) => {
        const active = isActivePath(pathname, tab.href)
        const count = navCount(tab, unreadCount, counts)

        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={cn(
              'relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10.5px] font-semibold tracking-normal transition-colors',
              active ? 'text-primary' : 'text-text-subtle',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <span className="grid h-6 w-6 place-items-center">
              <Icon name={tab.icon as IconName} size={21} />
            </span>
            <span>{tab.label}</span>
            {count ? (
              <span className="absolute left-[calc(50%+6px)] top-1 grid h-4 min-w-4 place-items-center rounded-full border border-surface bg-danger px-1 text-[9.5px] font-bold leading-none text-white">
                {count}
              </span>
            ) : null}
          </Link>
        )
      })}

      <button
        type="button"
        onClick={onMore}
        className={cn(
          'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10.5px] font-semibold tracking-normal transition-colors',
          primaryActive ? 'text-text-subtle' : 'text-primary',
        )}
        aria-label="Open full menu"
      >
        <span className="grid h-6 w-6 place-items-center">
          <Icon name="menu" size={21} />
        </span>
        <span>More</span>
      </button>
    </nav>
  )
}

export function MobileDrawer({
  open,
  onClose,
  navGroups,
  userName,
  userRole,
  onSignOut,
  isSigningOut,
}: {
  open: boolean
  onClose: () => void
  navGroups: NavGroup[]
  userName: string
  userRole: string
  onSignOut: () => void
  isSigningOut: boolean
}) {
  const pathname = usePathname() ?? '/'
  const unreadCount = useUnreadMessageCount()
  const { counts } = useOutstandingCounts()
  const groups = mobileNavGroups(navGroups)

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50 md:hidden">
      <DialogBackdrop className="fixed inset-0 bg-stone-950/50" />
      <DialogPanel className="fixed inset-y-0 left-0 flex w-[min(84vw,320px)] flex-col bg-sidebar-bg text-sidebar-fg shadow-lg">
        <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-[9px] border border-white/20 bg-white/15">
              <Anchor className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm font-bold leading-tight">The Anchor</DialogTitle>
              <div className="truncate text-[11px] text-sidebar-fg-muted">Stanwell Moor Village</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-[9px] bg-white/10 text-sidebar-fg transition-colors active:bg-white/15"
            aria-label="Close menu"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 py-2">
          {groups.map((group, groupIndex) => (
            <div key={groupIndex}>
              <div className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.09em] text-sidebar-fg-muted">
                {group.label ?? DRAWER_GROUP_TITLES[groupIndex]}
              </div>
              {group.items.map((item) => {
                const active = isActivePath(pathname, item.href)
                const count = navCount(item, unreadCount, counts)

                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-[9px] px-3 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-sidebar-active-bg text-sidebar-fg'
                        : 'text-sidebar-fg-muted active:bg-sidebar-hover-bg',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon name={item.icon as IconName} size={18} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {count ? (
                      <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold text-white">
                        {count}
                      </span>
                    ) : null}
                  </Link>
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2.5 border-t border-sidebar-border px-4 py-3">
          <Avatar name={userName} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{userName}</div>
            <div className="truncate text-[11px] text-sidebar-fg-muted">{userRole}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose()
              onSignOut()
            }}
            disabled={isSigningOut}
            className="grid h-9 w-9 place-items-center rounded-[9px] text-sidebar-fg-muted transition-colors hover:bg-sidebar-hover-bg hover:text-sidebar-fg disabled:opacity-50"
            aria-label="Sign out"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </DialogPanel>
    </Dialog>
  )
}
