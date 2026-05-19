'use client'

import { forwardRef } from 'react'
import { Button } from './Button'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon?: React.ReactNode
  /** @deprecated Use `icon` instead of children */
  children?: React.ReactNode
  label?: string
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** @deprecated Accepted for backward compatibility */
  iconOnly?: boolean
  /** @deprecated Use `icon` instead */
  leftIcon?: React.ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, children, label, variant = 'ghost', size = 'md', iconOnly: _io, leftIcon, ...rest }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      icon={icon ?? leftIcon ?? children}
      aria-label={label ?? rest['aria-label'] ?? 'icon button'}
      {...rest}
    />
  )
)
IconButton.displayName = 'IconButton'
