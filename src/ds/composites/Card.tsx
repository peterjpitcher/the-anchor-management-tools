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
  const hasLegacyHeader = Boolean(header) || Boolean(title)
  const usesSubcomponents = React.Children.toArray(children).some(
    (child) =>
      React.isValidElement(child) &&
      (child.type === CardBody || child.type === CardHeader || child.type === CardFooter),
  )
  const shouldAutoPad = !usesSubcomponents

  return (
    <div
      className={cn('bg-surface border border-border rounded-lg shadow-sm overflow-hidden', onClick && 'cursor-pointer', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {header && (
        <div className="px-[var(--spacing-pad-card)] py-3 border-b border-border">
          {header}
        </div>
      )}
      {title && <CardHeader title={title} subtitle={subtitle} />}
      {/*
        This wrapper is rendered unconditionally, and switches to `display: contents`
        instead of disappearing, because plenty of cards flip between "has a CardBody"
        and "has none" at runtime -- swapping a table for a loading spinner, for
        instance. Rendering `children` bare in one branch and wrapped in a div in the
        other changes the shape of the tree, so React tears the whole subtree down and
        rebuilds it. That destroyed any focused input rendered above the swap: on
        /customers you could type one character into the search box before the element
        you were typing into was thrown away. `display: contents` keeps layout identical
        to rendering the children directly, including inside flex and grid cards.
      */}
      <div className={shouldAutoPad ? 'p-[var(--spacing-pad-card)]' : 'contents'}>
        {children}
      </div>
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
