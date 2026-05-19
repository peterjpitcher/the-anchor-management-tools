/**
 * Container — backward-compatible layout wrapper
 * @deprecated Use standard layout containers instead
 */

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
  /** @deprecated Use `maxWidth` instead */
  size?: string
  padding?: boolean
  centered?: boolean
}

const maxWidthClasses = {
  sm: 'max-w-screen-sm',
  md: 'max-w-screen-md',
  lg: 'max-w-screen-lg',
  xl: 'max-w-screen-xl',
  '2xl': 'max-w-screen-2xl',
  full: 'max-w-full',
}

export const Container = forwardRef<HTMLDivElement, ContainerProps>(
  ({ maxWidth, size, padding = true, centered = true, className, children, ...props }, ref) => {
    const resolvedMaxWidth = (maxWidth ?? size ?? 'xl') as keyof typeof maxWidthClasses
    return (
    <div
      ref={ref}
      className={cn(
        maxWidthClasses[resolvedMaxWidth] ?? maxWidthClasses['xl'],
        padding && 'px-4 sm:px-6 lg:px-8',
        centered && 'mx-auto',
        className,
      )}
      {...props}
    >
      {children}
    </div>
    )
  },
)

Container.displayName = 'Container'
