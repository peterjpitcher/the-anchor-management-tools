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
 * Refactored to use an "underline" style (border-bottom) instead of "pills".
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
          // Check for exact path match or if the current path starts with the href (for nested routes)
          // But exclude the root path '/' from being active on every page
          const hrefWithoutHash = item.href.split('#')[0]
          active = hrefWithoutHash === pathname || (hrefWithoutHash !== '/' && pathname.startsWith(hrefWithoutHash))
        }
      }

      return { item, active }
    })
    
    // Only default-select the first item when this is a local in-page nav.
    if (!computed.some(({ active }) => active) && computed.length > 0) {
      const allLocalAnchors = computed.every(
        ({ item }) => !item.href || item.href.startsWith('#'),
      )

      if (allLocalAnchors) {
        computed[0].active = true
      }
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
        className="overflow-x-auto text-sm sm:text-base"
        aria-label={ariaLabel}
      >
        <ul className="flex w-max min-w-full items-center gap-4 sm:gap-6 -mb-px">
          {resolvedItems.map(({ item, active }, index) => {
            const { href, onClick, label, icon, disabled, badge } = item
            const key = `${label}-${index}`
            const content = (
              <span
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap px-1 py-3 border-b-2 transition-colors duration-150 text-sm font-medium',
                  active
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                  disabled && 'opacity-50 pointer-events-none',
                  itemClassName,
                )}
              >
                {icon && <span className="flex items-center">{icon}</span>}
                <span className="">{label}</span>
                {badge !== undefined && badge !== null && (
                  <span className={cn(
                    'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                    active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600',
                  )}>
                    {badge}
                  </span>
                )}
              </span>
            )

            return (
              <li key={key} className="flex flex-shrink-0">
                {href ? (
                  <Link href={href} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
                    {content}
                  </Link>
                ) : (
                <button
                  type="button"
                  onClick={onClick}
                  disabled={disabled}
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
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
