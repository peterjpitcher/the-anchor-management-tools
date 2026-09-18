'use client'

import { forwardRef } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

type LinkButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type LinkButtonSize = 'sm' | 'md' | 'lg'

export interface LinkButtonProps {
  href: string
  variant?: LinkButtonVariant
  size?: LinkButtonSize
  icon?: React.ReactNode
  /** @deprecated Use `icon` instead */
  leftIcon?: React.ReactNode
  iconRight?: React.ReactNode
  target?: string
  rel?: string
  disabled?: boolean
  className?: string
  children: React.ReactNode
}

// Same values as Button's variant and size maps, so a LinkButton matches a Button beside it.
const variantStyles: Record<LinkButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg border-primary hover:bg-primary-hover hover:border-primary-hover shadow-xs',
  secondary: 'bg-surface text-text border-border-strong hover:bg-surface-hover',
  ghost: 'bg-transparent text-text border-transparent hover:bg-surface-hover',
  danger: 'bg-danger text-white border-danger hover:brightness-95',
}

const sizeStyles: Record<LinkButtonSize, string> = {
  sm: 'h-btn-h-sm px-2.5 text-xs rounded-sm',
  md: 'h-btn-h px-3 text-ui rounded-default',
  lg: 'h-btn-h-lg px-4 text-sm rounded-default',
}

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(
  (
    {
      href,
      variant = 'secondary',
      size = 'md',
      icon,
      leftIcon,
      iconRight,
      target,
      rel,
      disabled = false,
      className,
      children,
    },
    ref,
  ) => {
    const classes = cn(
      'inline-flex items-center justify-center gap-1.5 border font-semibold transition-all no-underline',
      // Guarantee a >=44px tap target on mobile (sm size is only 34px tall otherwise)
      'max-shell:min-h-touch',
      'focus-visible:outline-hidden focus-visible:shadow-ring',
      sizeStyles[size],
      variantStyles[variant],
      disabled && 'opacity-50 pointer-events-none',
      className,
    )

    const resolvedIcon = icon ?? leftIcon
    const inner = (
      <>
        {resolvedIcon && <span className="flex-shrink-0 [&>svg]:h-4 [&>svg]:w-4">{resolvedIcon}</span>}
        {children}
        {iconRight && <span className="flex-shrink-0 [&>svg]:h-4 [&>svg]:w-4">{iconRight}</span>}
      </>
    )

    // External links
    if (
      target === '_blank' ||
      href.startsWith('http') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    ) {
      return (
        <a
          ref={ref}
          href={href}
          target={target}
          rel={rel || (target === '_blank' ? 'noopener noreferrer' : undefined)}
          className={classes}
          aria-disabled={disabled || undefined}
        >
          {inner}
        </a>
      )
    }

    // Internal links
    return (
      <Link ref={ref} href={href} className={classes} aria-disabled={disabled || undefined}>
        {inner}
      </Link>
    )
  },
)

LinkButton.displayName = 'LinkButton'
