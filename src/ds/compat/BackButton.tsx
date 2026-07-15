'use client'

/**
 * BackButton / MobileBackButton — backward-compatible wrapper
 * @deprecated Use ds/LinkButton or a custom back button instead
 */

import { ButtonHTMLAttributes, forwardRef } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Icon } from '../icons'

export interface BackButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string
  icon?: 'arrow' | 'chevron' | 'none'
  size?: 'sm' | 'md' | 'lg'
  variant?: 'ghost' | 'outline' | 'solid'
  onBack?: () => void
  showLabelOnMobile?: boolean
  iconOnly?: boolean
}

const sizeClasses = {
  sm: 'text-xs px-2 py-1 gap-1',
  md: 'text-sm px-3 py-1.5 gap-1.5',
  lg: 'text-base px-4 py-2 gap-2',
}

const variantStyles = {
  ghost: 'text-gray-600 hover:text-gray-900 hover:bg-gray-100',
  outline: 'text-gray-600 border border-gray-300 hover:bg-gray-50',
  solid: 'text-white bg-gray-600 hover:bg-gray-700',
}

export const BackButton = forwardRef<HTMLButtonElement, BackButtonProps>(
  (
    {
      label = 'Back',
      icon = 'arrow',
      size = 'md',
      variant = 'ghost',
      onBack,
      showLabelOnMobile = false,
      iconOnly = false,
      className,
      onClick,
      ...props
    },
    ref,
  ) => {
    const router = useRouter()

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e)
      if (!e.defaultPrevented) {
        if (onBack) {
          onBack()
        } else {
          router.back()
        }
      }
    }

    return (
      <button
        ref={ref}
        type="button"
        onClick={handleClick}
        className={cn(
          'inline-flex items-center rounded-md transition-colors font-medium',
          sizeClasses[size],
          variantStyles[variant],
          className,
        )}
        aria-label={iconOnly ? label : undefined}
        {...props}
      >
        {icon !== 'none' && <Icon name="chevronLeft" size={20} />}
        {!iconOnly && (
          <span className={cn(!showLabelOnMobile && 'hidden sm:inline')}>{label}</span>
        )}
      </button>
    )
  },
)

BackButton.displayName = 'BackButton'
