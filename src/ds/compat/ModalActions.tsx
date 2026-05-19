/**
 * ModalActions — backward-compatible wrapper
 * @deprecated Use Modal footer prop instead
 */

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function ModalActions({
  children,
  align = 'right',
  className,
}: {
  children: ReactNode
  align?: 'left' | 'center' | 'right' | 'between'
  className?: string
}) {
  const alignClasses = {
    left: 'justify-start',
    center: 'justify-center',
    right: 'justify-end',
    between: 'justify-between',
  }

  return (
    <div className={cn('flex flex-col-reverse sm:flex-row gap-3', alignClasses[align], className)}>
      {children}
    </div>
  )
}
