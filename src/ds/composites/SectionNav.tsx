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
  badge?: string | number
  href?: string
  icon?: React.ReactNode
  disabled?: boolean
}

export interface SectionNavProps {
  items: SectionNavItem[]
  activeId: string
  onSelect?: (id: string) => void
  className?: string
}

export function SectionNav({ items, activeId, onSelect, className }: SectionNavProps) {
  const itemRefs = React.useRef<Array<HTMLElement | null>>([])
  const enabledIndexes = items
    .map((item, index) => item.disabled ? -1 : index)
    .filter(index => index >= 0)
  const activeIndex = items.findIndex(item => item.id === activeId && !item.disabled)
  const tabStopIndex = activeIndex >= 0 ? activeIndex : enabledIndexes[0] ?? -1

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    if (enabledIndexes.length === 0) return

    event.preventDefault()
    const currentEnabledIndex = enabledIndexes.indexOf(index)
    const safeCurrentIndex = currentEnabledIndex >= 0 ? currentEnabledIndex : 0
    const nextEnabledIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabledIndexes.length - 1
          : event.key === 'ArrowLeft'
            ? (safeCurrentIndex === 0 ? enabledIndexes.length - 1 : safeCurrentIndex - 1)
            : (safeCurrentIndex === enabledIndexes.length - 1 ? 0 : safeCurrentIndex + 1)
    const nextIndex = enabledIndexes[nextEnabledIndex]
    const nextItem = items[nextIndex]
    if (!nextItem) return

    itemRefs.current[nextIndex]?.focus()
    if (!nextItem.href) {
      onSelect?.(nextItem.id)
    }
  }

  return (
    <nav
      role="tablist"
      aria-label="Section navigation"
      className={cn('flex items-end gap-1 overflow-x-auto border-b border-border scrollbar-hide', className)}
    >
      {items.map((item, index) => {
        const isActive = item.id === activeId
        const badge = item.badge ?? item.count
        const tabIndex = index === tabStopIndex ? 0 : -1

        const classes = cn(
          'inline-flex h-9 items-center rounded-t-[var(--radius-default)] border border-b-0 px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
          isActive
            ? 'border-[#a57626] bg-[#a57626] text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.22)]'
            : 'border-[#005131] bg-[#005131] text-white hover:border-[#004229] hover:bg-[#004229]',
          item.disabled && 'pointer-events-none opacity-50',
        )

        const countBadge = badge !== undefined && badge !== null ? (
          <span
            className={cn(
              'ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-pill)] border px-1.5 text-[11px] leading-none',
              isActive
                ? 'border-white/30 bg-white/15 text-white'
                : 'border-white/25 bg-white/10 text-white',
            )}
          >
            {badge}
          </span>
        ) : null

        const content = (
          <>
            {item.icon && <span className="flex items-center">{item.icon}</span>}
            <span>{item.label}</span>
            {countBadge}
          </>
        )

        if (item.disabled) {
          return (
            <span
              key={item.id}
              role="tab"
              aria-selected={false}
              aria-disabled="true"
              tabIndex={-1}
              className={classes}
            >
              {content}
            </span>
          )
        }

        /* Link variant (page navigation) */
        if (item.href) {
          return (
            <Link
              key={item.id}
              ref={(node) => { itemRefs.current[index] = node }}
              href={item.href}
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
              tabIndex={tabIndex}
              className={classes}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {content}
            </Link>
          )
        }

        /* Button variant (in-page tab switching) */
        return (
          <button
            key={item.id}
            ref={(node) => { itemRefs.current[index] = node }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={tabIndex}
            className={classes}
            onClick={() => onSelect?.(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {content}
          </button>
        )
      })}
    </nav>
  )
}
