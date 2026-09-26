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
  /** 'secondary' (or 'subtle') tints the card; 'ghost' drops the frame; anything else is the default card. */
  variant?: string
  /** Inner padding when the card does not use CardHeader/CardBody/CardFooter: none, sm, md (default) or lg. */
  padding?: string
  /** @deprecated Accepted for backward compatibility */
  interactive?: boolean
}

const cardPadding: Record<string, string> = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-pad-card',
  lg: 'p-6',
}

function cardVariant(variant?: string): string | undefined {
  if (variant === 'secondary' || variant === 'subtle') return 'bg-surface-2'
  if (variant === 'ghost') return 'border-transparent bg-transparent shadow-none'
  return undefined
}

export function Card({ children, className, title, subtitle, header, id: _id, onClick, variant, padding, interactive: _interactive }: CardProps) {
  const hasLegacyHeader = Boolean(header) || Boolean(title)
  const usesSubcomponents = React.Children.toArray(children).some(
    (child) =>
      React.isValidElement(child) &&
      (child.type === CardBody || child.type === CardHeader || child.type === CardFooter),
  )
  const shouldAutoPad = !usesSubcomponents

  return (
    <div
      className={cn('bg-surface border border-border rounded-lg shadow-sm overflow-hidden', cardVariant(variant), onClick && 'cursor-pointer', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {header && (
        <div className="px-pad-card py-3 border-b border-border">
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
      <div className={shouldAutoPad ? (cardPadding[padding ?? 'md'] ?? cardPadding.md) : 'contents'}>
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

/**
 * On a wide card the action sits to the right of the title. On a narrow one (a phone, a
 * sidebar card) the row wraps: the action drops below the title instead of being clipped,
 * and the action's own buttons wrap too. The title and subtitle wrap rather than truncate,
 * so nothing is cut off.
 *
 * When the row wraps: the title block asks for its text's natural width, but never more
 * than 12rem (`max-w-[12rem]` caps what the heading and subtitle ask for, and
 * `min-w-full` still lets them fill the block). So a short title keeps its action beside it
 * whenever both fit, as before, and a long title keeps 12rem beside the action, wrapping
 * onto a second line, before the action drops below.
 */
export function CardHeader({ title, subtitle, action, children, className }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'px-pad-card py-3 border-b border-border flex flex-wrap items-center justify-between gap-x-3 gap-y-2',
        className,
      )}
    >
      <div className="min-w-0 flex-auto">
        <h3 className="min-w-full max-w-[12rem] text-sm font-semibold text-text-strong break-words">{title}</h3>
        {subtitle && <p className="min-w-full max-w-[12rem] text-xs text-text-muted mt-0.5 break-words">{subtitle}</p>}
      </div>
      {action && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{action}</div>}
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
    <div className={cn('p-pad-card', className)}>
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
    <div className={cn('px-pad-card py-3 border-t border-border bg-surface-2', className)}>
      {children}
    </div>
  )
}
