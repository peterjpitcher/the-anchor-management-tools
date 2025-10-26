'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { usePathname } from 'next/navigation'

export interface HeaderNavItem {
  label: string
  href?: string
  onClick?: () => void
  icon?: React.ReactNode
  active?: boolean
  disabled?: boolean
  badge?: string | number
}

export interface HeaderNavProps {
  items: HeaderNavItem[]
  className?: string
  itemClassName?: string
  ariaLabel?: string
}

/**
 * HeaderNav - Consistent horizontal navigation used within page headers.
 * Provides a single place to manage typography, spacing, and responsive fallbacks.
 */
export function HeaderNav({
  items,
  className,
  itemClassName,
  ariaLabel = 'Section navigation',
}: HeaderNavProps) {
  const pathname = usePathname()
  const [currentHash, setCurrentHash] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.hash : '',
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleHashChange = () => {
      setCurrentHash(window.location.hash)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const resolvedItems = useMemo(() => {
    const computed = items.map((item) => {
      if (typeof item.active === 'boolean') {
        return { item, active: item.active }
      }

      let active = false
      if (item.href) {
        if (item.href.startsWith('#')) {
          active = item.href === currentHash
        } else {
          const hrefWithoutHash = item.href.split('#')[0]
          active = hrefWithoutHash === pathname
        }
      }

      return { item, active }
    })

    if (!computed.some(({ active }) => active) && computed.length > 0) {
      computed[0].active = true
    }

    return computed
  }, [items, pathname, currentHash])

  if (resolvedItems.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        'relative w-full sm:flex-1',
        className,
      )}
    >
      <nav
        className="overflow-x-auto py-1 text-sm sm:text-base"
        aria-label={ariaLabel}
      >
        <ul className="flex w-max min-w-full items-center gap-1 sm:gap-2">
          {resolvedItems.map(({ item, active }, index) => {
            const { href, onClick, label, icon, disabled, badge } = item
            const key = `${label}-${index}`
            const content = (
              <span
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 transition-colors duration-150',
                  active
                    ? 'bg-white text-sidebar shadow-sm'
                    : 'text-white/80 hover:text-white hover:bg-white/10',
                  disabled && 'opacity-50 pointer-events-none',
                  itemClassName,
                )}
              >
                {icon && <span className="flex items-center">{icon}</span>}
                <span className="font-medium">{label}</span>
                {badge !== undefined && badge !== null && (
                  <span className={cn(
                    'inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1 text-xs font-semibold',
                    active ? 'bg-sidebar/10 text-sidebar' : 'bg-white/15 text-white',
                  )}>
                    {badge}
                  </span>
                )}
              </span>
            )

            return (
              <li key={key} className="flex flex-shrink-0">
                {href ? (
                  <Link href={href} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar">
                    {content}
                  </Link>
                ) : (
                <button
                  type="button"
                  onClick={onClick}
                  disabled={disabled}
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                >
                  {content}
                </button>
              )}
            </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
