/**
 * Common types for the component library
 */

import { ReactNode, HTMLAttributes, ButtonHTMLAttributes } from 'react'

// Base component props that all components should extend
export interface BaseComponentProps {
  className?: string
  children?: ReactNode
  'data-testid'?: string
}

// Common size variants
export type Size = 'sm' | 'md' | 'lg'

// Common color variants
export type Variant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'

// Status types
export type Status = 'success' | 'warning' | 'error' | 'info'

// Component prop types
export interface ComponentProps extends HTMLAttributes<HTMLElement>, BaseComponentProps {}

// Button-specific props
export interface ButtonComponentProps extends ButtonHTMLAttributes<HTMLButtonElement>, BaseComponentProps {
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  fullWidth?: boolean
}

// Form field props
export interface FormFieldProps extends BaseComponentProps {
  label?: string
  error?: string
  hint?: string
  required?: boolean
  disabled?: boolean
}

// Layout props
export interface LayoutProps extends BaseComponentProps {
  as?: keyof JSX.IntrinsicElements
}

// Responsive prop helper
export type ResponsiveProp<T> = T | {
  sm?: T
  md?: T
  lg?: T
  xl?: T
  '2xl'?: T
}