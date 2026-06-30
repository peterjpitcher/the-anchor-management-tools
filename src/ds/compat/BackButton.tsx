'use client'

/**
 * BackButton / MobileBackButton — backward-compatible wrapper
 * @deprecated Use ds/LinkButton or a custom back button instead
 */

import { ButtonHTMLAttributes, forwardRef } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface BackButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string
  icon?: 'arrow' | 'chevron' | 'none'
  size?: 'sm' | 'md' | 'lg'
  variant?: 'ghost' | 'outline' | 'solid'
  onBack?: () => void
  showLabelOnMobile?: boolean
  iconOnly?: boolean
}

const ArrowLeft = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
)

const ChevronLeft = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
)

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

    const IconComponent = icon === 'chevron' ? ChevronLeft : icon === 'arrow' ? ArrowLeft : null

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
        {IconComponent && <IconComponent />}
        {!iconOnly && (
          <span className={cn(!showLabelOnMobile && 'hidden sm:inline')}>{label}</span>
        )}
      </button>
    )
  },
)

BackButton.displayName = 'BackButton'

function BackLink(props: BackButtonProps) {
  return <BackButton {...props} />
}

function MobileBackButton({
  label = 'Back',
  onBack,
  className,
}: {
  label?: string
  onBack?: () => void
  className?: string
}) {
  return (
    <div className={cn('sm:hidden', className)}>
      <BackButton label={label} onBack={onBack} size="sm" icon="chevron" showLabelOnMobile />
    </div>
  )
}
