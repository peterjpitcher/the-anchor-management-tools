'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface StandaloneNavItem {
  label: string
  href: string
}

/** The longest link that is the current path or a parent of it, so /portal/leave/new keeps Holiday lit. */
function activeHref(items: StandaloneNavItem[], pathname: string): string | undefined {
  return items
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0]
}

/**
 * The tab row under a standalone header, drawn like the staff app's section tabs so the portal
 * reads as part of the same product. Real links, so each one is a normal client navigation.
 */
export function StandaloneShellNav({ items, label }: { items: StandaloneNavItem[]; label: string }): React.JSX.Element {
  const pathname = usePathname() ?? ''
  const current = activeHref(items, pathname)

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
