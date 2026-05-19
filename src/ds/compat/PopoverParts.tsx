/**
 * PopoverHeader / PopoverContent — backward-compatible wrappers
 * @deprecated Use Popover children directly
 */

import { cn } from '@/lib/utils'

export function PopoverHeader({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('pb-2 mb-2 border-b border-border', className)}>
      {children}
    </div>
  )
}

export function PopoverContent({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn(className)}>{children}</div>
}
