'use client'

import React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/*  SectionNav — horizontal tab strip for sub-page navigation         */
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
    <nav className={cn('flex items-end gap-1 overflow-x-auto border-b border-border scrollbar-hide', className)}>
      {items.map((item) => {
        const isActive = item.id === activeId

        const classes = cn(
          'inline-flex h-9 items-center rounded-t-[var(--radius-default)] border border-b-0 px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
          isActive
            ? 'border-[#a57626] bg-[#a57626] text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.22)]'
            : 'border-[#005131] bg-[#005131] text-white hover:border-[#004229] hover:bg-[#004229]',
        )

        const countBadge = item.count !== undefined ? (
          <span
            className={cn(
              'ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-pill)] border px-1.5 text-[11px] leading-none',
              isActive
                ? 'border-white/30 bg-white/15 text-white'
                : 'border-white/25 bg-white/10 text-white',
            )}
          >
            {item.count}
          </span>
        ) : null

        /* Link variant (page navigation) */
        if (item.href) {
          return (
            <Link key={item.id} href={item.href} className={classes} aria-current={isActive ? 'page' : undefined}>
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
            aria-pressed={isActive}
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
