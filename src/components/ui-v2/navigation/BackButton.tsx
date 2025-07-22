'use client'

/**
 * BackButton Component
 * 
 * Used on 72/107 pages (67%)
 * 
 * Provides consistent back navigation with keyboard support and mobile optimization.
 * Replaces various inline back button implementations.
 */

import { ButtonHTMLAttributes, forwardRef } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ArrowLeftIcon, ChevronLeftIcon } from '@heroicons/react/20/solid'

export interface BackButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Custom label for the button
   * @default 'Back'
   */
  label?: string
  
  /**
   * Icon style
   * @default 'arrow'
   */
  icon?: 'arrow' | 'chevron' | 'none'
  
  /**
   * Size of the button
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Visual variant
   * @default 'ghost'
   */
  variant?: 'ghost' | 'outline' | 'solid'
  
  /**
   * Custom navigation function (instead of router.back())
   */
  onBack?: () => void
  
  /**
   * Whether to show label on mobile
   * @default false
   */
  showLabelOnMobile?: boolean
  
  /**
   * Whether to show icon only (no label)
   * @default false
   */
  iconOnly?: boolean
}

export const BackButton = forwardRef<HTMLButtonElement, BackButtonProps>(({
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
}, ref) => {
  const router = useRouter()
  
  // Handle click
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
  
  // Size classes
  const sizeClasses = {
    sm: {
      button: 'px-2 py-1 text-sm',
      icon: 'h-4 w-4',
      iconOnly: 'p-1',
      gap: 'gap-1',
    },
    md: {
      button: 'px-3 py-2 text-sm',
      icon: 'h-5 w-5',
      iconOnly: 'p-2',
      gap: 'gap-2',
    },
    lg: {
      button: 'px-4 py-2.5 text-base',
      icon: 'h-6 w-6',
      iconOnly: 'p-2.5',
      gap: 'gap-2',
    },
  }
  
  // Variant classes
  const variantClasses = {
    ghost: cn(
      'text-gray-700 hover:text-gray-900',
      'hover:bg-gray-100',
      'focus:bg-gray-100'
    ),
    outline: cn(
      'text-gray-700 hover:text-gray-900',
      'border border-gray-300 hover:border-gray-400',
      'bg-white hover:bg-gray-50'
    ),
    solid: cn(
      'text-white',
      'bg-gray-600 hover:bg-gray-700',
      'focus:ring-2 focus:ring-offset-2 focus:ring-gray-500'
    ),
  }
  
  // Base button classes
  const buttonClasses = cn(
    // Base styles
    'inline-flex items-center justify-center',
    'font-medium rounded-md',
    'transition-colors duration-200',
    'focus:outline-none',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    
    // Touch target optimization
    size === 'sm' && 'min-h-[36px]',
    size === 'md' && 'min-h-[40px]',
    size === 'lg' && 'min-h-[44px]',
    
    // Size classes
    iconOnly ? sizeClasses[size].iconOnly : sizeClasses[size].button,
    !iconOnly && sizeClasses[size].gap,
    
    // Variant classes
    variantClasses[variant],
    
    // Focus ring for non-solid variants
    variant !== 'solid' && 'focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
    
    // Custom classes
    className
  )
  
  // Icon component
  const IconComponent = icon === 'arrow' ? ArrowLeftIcon : ChevronLeftIcon
  
  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      className={buttonClasses}
      aria-label={iconOnly ? label : undefined}
      {...props}
    >
      {icon !== 'none' && (
        <IconComponent
          className={cn(
            sizeClasses[size].icon,
            iconOnly && 'mx-0'
          )}
          aria-hidden="true"
        />
      )}
      
      {!iconOnly && (
        <span className={cn(
          !showLabelOnMobile && 'hidden sm:inline'
        )}>
          {label}
        </span>
      )}
    </button>
  )
})

BackButton.displayName = 'BackButton'

/**
 * BackLink - Link-style back button
 */
export function BackLink({
  label = 'Back',
  icon = 'arrow',
  className,
  ...props
}: Omit<BackButtonProps, 'variant' | 'size'>) {
  return (
    <BackButton
      label={label}
      icon={icon}
      variant="ghost"
      size="sm"
      className={cn(
        'p-0 hover:bg-transparent focus:bg-transparent',
        'text-green-600 hover:text-green-700',
        'focus:ring-0 focus:underline',
        className
      )}
      {...props}
    />
  )
}

/**
 * MobileBackButton - Optimized for mobile headers
 */
export function MobileBackButton({
  className,
  ...props
}: Omit<BackButtonProps, 'showLabelOnMobile' | 'iconOnly'>) {
  return (
    <BackButton
      icon="chevron"
      variant="outline"
      size="lg"
      iconOnly
      className={cn(
        'sm:hidden',
        className
      )}
      {...props}
    />
  )
}