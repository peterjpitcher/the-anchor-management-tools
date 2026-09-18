'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: React.ReactNode
  /** @deprecated Use `icon` instead */
  leftIcon?: React.ReactNode
  iconRight?: React.ReactNode
  /** @deprecated Use `iconRight` instead */
  rightIcon?: React.ReactNode
  loading?: boolean
  /** @deprecated Accepted for backward compatibility */
  fullWidth?: boolean
  /** @deprecated Use IconButton or icon-only Button instead */
  iconOnly?: boolean
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg border-primary hover:bg-primary-hover hover:border-primary-hover shadow-xs',
  secondary:
    'bg-surface text-text border-border-strong hover:bg-surface-hover',
  ghost:
    'bg-transparent text-text border-transparent hover:bg-surface-hover',
  danger:
    'bg-danger text-white border-danger hover:brightness-95',
  link:
    'bg-transparent text-primary border-transparent hover:underline p-0 h-auto',
}

const sizeStyles: Record<ButtonSize, string> = {
  xs: 'h-6 px-1.5 text-meta rounded-sm',
  sm: 'h-btn-h-sm px-2.5 text-xs rounded-sm',
  md: 'h-btn-h px-3 text-ui rounded-default',
  lg: 'h-btn-h-lg px-4 text-sm rounded-default',
}

const Spinner = () => (
  <svg
    className="animate-spin h-4 w-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" />
    <path
      className="opacity-75"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
)

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      icon,
      leftIcon,
      iconRight,
      rightIcon,
      loading,
      fullWidth,
      iconOnly: _iconOnly,
      children,
      className,
      disabled,
      ...rest
    },
    ref
  ) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 border font-semibold whitespace-nowrap',
        'max-shell:min-h-touch',
        'transition-[background,border-color,color,transform,box-shadow] duration-[120ms] select-none tracking-[-0.005em]',
        'focus-visible:outline-hidden focus-visible:shadow-ring',
        'active:translate-y-[0.5px]',
        // Size first, then variant, so the link variant's p-0 h-auto wins at every size.
        sizeStyles[size],
        variantStyles[variant],
        !children && size === 'xs' && 'w-6 px-0',
        !children && size === 'sm' && 'w-btn-h-sm px-0',
        !children && size === 'md' && 'w-btn-h px-0',
        !children && size === 'lg' && 'w-btn-h-lg px-0',
        fullWidth && 'w-full',
        (disabled || loading) && 'opacity-50 cursor-not-allowed',
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner /> : (icon ?? leftIcon) ? (icon ?? leftIcon) : null}
      {children}
      {(iconRight ?? rightIcon) && !loading ? (iconRight ?? rightIcon) : null}
    </button>
  )
)
Button.displayName = 'Button'
