'use client'

import { forwardRef } from 'react'
import { Button } from './Button'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: React.ReactNode
  label: string
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, variant = 'ghost', size = 'md', ...rest }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      icon={icon}
      aria-label={label}
      {...rest}
    />
  )
)
IconButton.displayName = 'IconButton'
