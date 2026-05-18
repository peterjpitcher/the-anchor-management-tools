'use client'

import React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/*  SectionNav — horizontal pill strip for sub-page navigation        */
/* ------------------------------------------------------------------ */

interface SectionNavItem {
  id: string
  label: string
  count?: number
  href?: string
}

interface SectionNavProps {
  items: SectionNavItem[]
  activeId: string
  onSelect?: (id: string) => void
  className?: string
}

export function SectionNav({ items, activeId, onSelect, className }: SectionNavProps) {
  return (
    <nav className={cn('flex items-center gap-1 overflow-x-auto scrollbar-hide', className)}>
      {items.map((item) => {
        const isActive = item.id === activeId

        const classes = cn(
          'px-3 py-1.5 text-[13px] font-medium rounded-[9999px] whitespace-nowrap transition-colors',
          isActive
            ? 'bg-primary-soft text-primary-soft-fg'
            : 'text-text-muted hover:bg-surface-hover hover:text-text',
        )

        const countBadge = item.count !== undefined ? (
          <span className="ml-1.5 inline-flex items-center justify-center text-xs bg-surface-2 rounded-[9999px] px-1.5 min-w-5 text-center">
            {item.count}
          </span>
        ) : null

        /* Link variant (page navigation) */
        if (item.href) {
          return (
            <Link key={item.id} href={item.href} className={classes}>
              {item.label}
              {countBadge}
            </Link>
          )
        }

        /* Button variant (in-page tab switching) */
        return (
          <button
            key={item.id}
            type="button"
            className={classes}
            onClick={() => onSelect?.(item.id)}
          >
            {item.label}
            {countBadge}
          </button>
        )
      })}
    </nav>
  )
}
