'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { Avatar } from '@/ds/primitives/Avatar'
import { Icon, type IconName } from '@/ds/icons'
import { cn } from '@/lib/utils'
import { useNavCounts } from './NavCountsContext'
import { isActiveNavPath, navBadgeText, navCount, type NavGroup, type NavItem } from './SidebarNav'

const MOBILE_TABS = [
  { id: 'dashboard', label: 'Home', icon: 'home', href: '/dashboard' },
  { id: 'events', label: 'Events', icon: 'calendar', href: '/events' },
  { id: 'tables', label: 'Tables', icon: 'table', href: '/table-bookings' },
  { id: 'messages', label: 'Messages', icon: 'message', href: '/messages' },
] satisfies Array<Pick<NavItem, 'id' | 'label' | 'icon' | 'href'>>

// The badge text comes from SidebarNav so a count cannot read one way here and
// another on the desktop rail, and so a count that could not be read shows as '!'
// on a phone too rather than as a number.
const badgeText = navBadgeText

export function MobileTopbar({ onMenuOpen }: { onMenuOpen: () => void }) {
  const { unreadCount } = useNavCounts()

  return (
    // z-45 for the same reason as the desktop rail: page chrome reaches z-40.
    <header className="shell:hidden sticky top-0 z-[45] flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border bg-sidebar px-3 text-sidebar-fg">
      <button
        type="button"
        onClick={onMenuOpen}
        className="grid h-10 w-10 place-items-center rounded-md text-sidebar-fg transition-colors active:bg-on-dark-hover focus-visible:outline-hidden focus-visible:shadow-ring"
        aria-label="Open menu"
      >
        <Icon name="menu" size={20} />
      </button>

      <Link href="/dashboard" className="mr-auto flex min-w-0 items-center gap-2" aria-label="Orange Jelly dashboard">
        <img src="/orange-jelly/logo-horizontal-white.png" alt="Orange Jelly" className="h-10 w-40 object-contain" />
      </Link>


      {/* This was a bell that showed an unread dot permanently and linked to the
          dashboard, so it signalled "something is waiting" whether or not
          anything was, and never led anywhere useful. It now carries the real
          unread count and opens the inbox. */}
      <Link
        href="/messages"
        className="relative grid h-10 w-10 place-items-center rounded-md text-sidebar-fg transition-colors active:bg-on-dark-hover focus-visible:outline-hidden focus-visible:shadow-ring"
        aria-label={unreadCount > 0 ? `Messages, ${unreadCount} unread` : 'Messages'}
      >
        <Icon name="message" size={20} />
        {unreadCount > 0 ? (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-2xs font-bold leading-none text-white shadow-[0_0_0_2px_var(--color-sidebar)]">
            {badgeText(unreadCount)}
          </span>
        ) : null}
      </Link>
    </header>
  )
}

export function MobileBottomNav({ navGroups, shortcuts = [], onMore }: { navGroups: NavGroup[]; shortcuts?: NavItem[]; onMore: () => void }) {
  const pathname = usePathname() ?? '/'
  const { unreadCount, counts } = useNavCounts()
  const availableIds = new Set(navGroups.flatMap((group) => group.items.map((item) => item.id)))
  const defaults = MOBILE_TABS.filter((tab) => availableIds.has(tab.id))
  // Restricted staff still get useful destinations if none of the standard tabs apply.
  const tabs = shortcuts.length ? shortcuts.filter(tab => availableIds.has(tab.id)).slice(0, 4)
    : defaults.length ? defaults : navGroups.flatMap(group => group.items).slice(0, 4)
  const primaryActive = tabs.some((tab) => isActiveNavPath(pathname, tab.href))

  return (
    <nav
      className="shell:hidden grid shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--color-border),0_-8px_24px_-16px_rgba(0,0,0,0.18)]"
      style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
      aria-label="Mobile navigation"
    >
      {tabs.map((tab) => {
        const active = isActiveNavPath(pathname, tab.href)
        const count = navCount(tab, unreadCount, counts)

        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={cn(
              'relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-meta font-semibold tracking-normal transition-colors',
              active ? 'text-primary' : 'text-text-subtle',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <span className="grid h-6 w-6 place-items-center">
              <Icon name={tab.icon as IconName} size={21} />
            </span>
            <span>{tab.label}</span>
            {count ? (
              <span className="absolute left-[calc(50%+6px)] top-1 grid h-4 min-w-4 place-items-center rounded-full border border-surface bg-danger px-1 text-2xs font-bold leading-none text-white">
                {badgeText(count)}
              </span>
            ) : null}
          </Link>
        )
      })}

      <button
        type="button"
        onClick={onMore}
        className={cn(
          'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-meta font-semibold tracking-normal transition-colors',
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
  shortcutControl,
}: {
  open: boolean
  onClose: () => void
  navGroups: NavGroup[]
  userName: string
  userRole: string
  onSignOut: () => void
  isSigningOut: boolean
  shortcutControl?: ReactNode
}) {
  const pathname = usePathname() ?? '/'
  const { unreadCount, counts } = useNavCounts()

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50 shell:hidden">
      <DialogBackdrop className="fixed inset-0 bg-overlay" />
      <DialogPanel className="fixed inset-y-0 left-0 flex w-[min(84vw,320px)] flex-col bg-sidebar text-sidebar-fg shadow-lg">
        <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <DialogTitle><img src="/orange-jelly/logo-horizontal-white.png" alt="Orange Jelly" className="h-10 w-40 object-contain" /></DialogTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-default bg-on-dark-hover text-sidebar-fg transition-colors active:bg-on-dark-active focus-visible:outline-hidden focus-visible:shadow-ring"
            aria-label="Close menu"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 py-1">
          <div className="ds-shortcut-control">{shortcutControl}</div>
          {navGroups.map((group, groupIndex) => (
            <div key={groupIndex}>
              {group.label ? (
                <div className="px-3 py-1 text-2xs font-bold uppercase tracking-[0.09em] text-sidebar-fg-muted">
                  {group.label}
                </div>
              ) : null}
              {group.items.map((item) => {
                const active = isActiveNavPath(pathname, item.href)
                const count = navCount(item, unreadCount, counts)

                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      'flex min-h-8 items-center gap-2 rounded-default px-3 py-1 text-ui font-medium transition-colors focus-visible:outline-hidden focus-visible:shadow-ring',
                      active
                        ? 'bg-sidebar-active-bg text-text'
                        : 'text-sidebar-fg-muted active:bg-sidebar-hover-bg',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon name={item.icon as IconName} size={18} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {count ? (
                      <span className="rounded-full bg-on-dark-active px-2 py-0.5 text-2xs font-bold text-on-dark">
                        {badgeText(count)}
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
            <div className="truncate text-ui font-semibold">{userName}</div>
            <div className="truncate text-meta text-sidebar-fg-muted">{userRole}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose()
              onSignOut()
            }}
            disabled={isSigningOut}
            className="grid h-9 w-9 place-items-center rounded-default text-sidebar-fg-muted transition-colors hover:bg-sidebar-hover-bg focus-visible:outline-hidden focus-visible:shadow-ring hover:text-sidebar-fg disabled:opacity-50"
            aria-label="Sign out"
          >
            {/* Deliberately not an `x`: the drawer header already has an `x` that
                closes the panel, and two identical glyphs a thumb apart made
                signing out an easy mis-tap. */}
            <Icon name="logout" size={16} />
          </button>
        </div>
      </DialogPanel>
    </Dialog>
  )
}
