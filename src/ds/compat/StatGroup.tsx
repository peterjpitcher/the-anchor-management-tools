'use client'

/**
 * StatGroup — backward-compatible wrapper
 * @deprecated Use a grid container with ds/Stat instead
 */

import React, { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const columnClasses = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
}

export function StatGroup({
  children,
  columns = 3,
  className,
  mobileScroll = false,
}: {
  children: ReactNode
  columns?: 1 | 2 | 3 | 4
  className?: string
  mobileScroll?: boolean
}) {
  if (mobileScroll) {
    return (
      <div className="sm:hidden -mx-4">
        <div className="flex gap-3 px-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
          {React.Children.map(children, (child, index) => (
            <div key={index} className="flex-none w-[280px] snap-start">
              {child}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('ds-stat-group grid gap-3 sm:gap-4', columnClasses[columns], className)}>
      {children}
    </div>
  )
}
