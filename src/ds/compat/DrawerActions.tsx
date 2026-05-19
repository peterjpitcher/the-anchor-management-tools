/**
 * DrawerActions — backward-compatible wrapper
 * @deprecated Use Drawer footer prop instead
 */

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const alignClasses = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
  between: 'justify-between',
}

export function DrawerActions({
  children,
  align = 'right',
  className,
}: {
  children: ReactNode
  align?: 'left' | 'center' | 'right' | 'between'
  className?: string
}) {
  return (
    <div className={cn('flex gap-3 pt-4 border-t border-border mt-4', alignClasses[align], className)}>
      {children}
    </div>
  )
}
