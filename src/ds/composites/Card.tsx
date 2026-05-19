import React from 'react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/*  Card compound component                                           */
/*  Server component -- no 'use client' directive                     */
/* ------------------------------------------------------------------ */

interface CardProps {
  children: React.ReactNode
  className?: string
  /** @deprecated Use CardHeader subcomponent instead */
  title?: string
  /** @deprecated Use CardHeader subcomponent instead */
  subtitle?: string
  /** @deprecated Accepted for backward compatibility */
  header?: React.ReactNode
  /** @deprecated Accepted for backward compatibility */
  id?: string
  /** @deprecated Accepted for backward compatibility */
  onClick?: () => void
  /** @deprecated Accepted for backward compatibility */
  variant?: string
  /** @deprecated Accepted for backward compatibility */
  padding?: string
  /** @deprecated Accepted for backward compatibility */
  interactive?: boolean
}

export function Card({ children, className, title, subtitle, header, id: _id, onClick, variant: _variant, padding: _padding, interactive: _interactive }: CardProps) {
  return (
    <div
      className={cn('bg-surface border border-border rounded-lg shadow-sm overflow-hidden', onClick && 'cursor-pointer', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {header}
      {title && <CardHeader title={title} subtitle={subtitle} />}
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface CardHeaderProps {
  title?: string
  subtitle?: string
  action?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

export function CardHeader({ title, subtitle, action, children, className }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'px-[var(--spacing-pad-card)] py-3 border-b border-border flex items-center justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-text-strong truncate">{title}</h3>
        {subtitle && <p className="text-xs text-text-muted mt-0.5 truncate">{subtitle}</p>}
      </div>
      {action && <div className="ml-3 flex-shrink-0">{action}</div>}
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface CardBodyProps {
  children: React.ReactNode
  className?: string
}

export function CardBody({ children, className }: CardBodyProps) {
  return (
    <div className={cn('p-[var(--spacing-pad-card)]', className)}>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface CardFooterProps {
  children: React.ReactNode
  className?: string
}

export function CardFooter({ children, className }: CardFooterProps) {
  return (
    <div className={cn('px-[var(--spacing-pad-card)] py-3 border-t border-border bg-surface-2', className)}>
      {children}
    </div>
  )
}
