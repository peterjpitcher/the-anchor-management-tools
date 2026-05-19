/**
 * CardTitle / CardDescription — backward-compatible wrappers
 * @deprecated Use ds/CardHeader instead
 */

import { cn } from '@/lib/utils'

export function CardTitle({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h3 className={cn('text-sm font-semibold text-text-strong', className)}>{children}</h3>
  )
}

export function CardDescription({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p className={cn('text-xs text-text-muted mt-0.5', className)}>{children}</p>
  )
}
