/**
 * BadgeGroup — backward-compatible wrapper
 * @deprecated Use a flex container with ds/Badge instead
 */

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const gapClasses = { sm: 'gap-1', md: 'gap-2', lg: 'gap-3' }

export function BadgeGroup({
  children,
  gap = 'md',
  wrap = true,
  className,
}: {
  children: ReactNode
  gap?: 'sm' | 'md' | 'lg'
  wrap?: boolean
  className?: string
}) {
  return (
    <div className={cn('inline-flex items-center', gapClasses[gap], wrap && 'flex-wrap', className)}>
      {children}
    </div>
  )
}
