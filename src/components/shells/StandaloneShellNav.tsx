'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface StandaloneNavItem {
  label: string
  href: string
}

/**
 * The tab for the current page. Only a tab's own page has one: a page below a tab (a new,
 * edit or detail page, such as /portal/leave/new) is a child page, which shows its back button
 * instead of the tab row (docs/standards/UI_UX.md, Navigation).
 */
function currentTabHref(items: StandaloneNavItem[], pathname: string): string | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return items.find((item) => item.href === path)?.href
}

/**
 * The tab row under a standalone header, drawn like the staff app's section tabs so the portal
 * reads as part of the same product. Real links, so each one is a normal client navigation.
 * Nothing is drawn on a child page.
 */
export function StandaloneShellNav({ items, label }: { items: StandaloneNavItem[]; label: string }): React.JSX.Element | null {
  const pathname = usePathname() ?? ''
  const current = currentTabHref(items, pathname)
  if (!current) return null

  return (
    <nav aria-label={label} className="-mb-px flex items-end gap-1 overflow-x-auto scrollbar-hide">
      {items.map((item) => {
        const active = item.href === current
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-9 shrink-0 items-center rounded-t-default border border-b-0 px-3.5 text-ui font-medium whitespace-nowrap transition-colors',
              'focus-visible:outline-hidden focus-visible:shadow-ring-inset',
              active
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
