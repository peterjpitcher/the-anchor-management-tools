'use client'

/**
 * Textarea Component
 * 
 * Used on 42/107 pages (39%)
 * 
 * Enhanced textarea with auto-resize, character count, and consistent styling.
 * Optimized for mobile with proper touch targets.
 */

import { TextareaHTMLAttributes, forwardRef, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ExclamationCircleIcon } from '@heroicons/react/20/solid'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Visual style variant
   * @default 'default'
   */
  variant?: 'default' | 'filled' | 'borderless'
  
  /**
   * Textarea size
   * @default 'md'
   */
  textareaSize?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether the textarea has an error
   * @default false
   */
  error?: boolean
  
  /**
   * Whether to auto-resize based on content
   * @default false
   */
  autoResize?: boolean
  
  /**
   * Minimum number of rows when auto-resizing
   * @default 3
   */
  minRows?: number
  
  /**
   * Maximum number of rows when auto-resizing
   * @default 10
   */
  maxRows?: number
  
  /**
   * Whether to show character count
   * @default false
   */
  showCount?: boolean
  
  /**
   * Whether the textarea should take full width
   * @default true
   */
  fullWidth?: boolean
  
  /**
   * Additional classes for the textarea wrapper
   */
  wrapperClassName?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({
  variant = 'default',
  textareaSize = 'md',
  error = false,
  autoResize = false,
  minRows = 3,
  maxRows = 10,
  showCount = false,
  fullWidth = true,
  wrapperClassName,
  className,
  onChange,
  value,
  defaultValue,
  maxLength,
  ...props
}, ref) => {
  const [charCount, setCharCount] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  
  // Size classes
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-3 py-2 text-sm',
    lg: 'px-4 py-3 text-base',
  }
  
  // Variant classes
  const variantClasses = {
    default: cn(
      'border border-gray-400',
      'focus:border-primary-600 focus:ring-1 focus:ring-primary-600',
      error && 'border-red-300 focus:border-red-500 focus:ring-red-500'
    ),
    filled: cn(
      'bg-gray-100 border border-transparent',
      'focus:bg-white focus:border-primary-600 focus:ring-1 focus:ring-primary-600',
      error && 'bg-red-50 focus:border-red-500 focus:ring-red-500'
    ),
    borderless: cn(
      'border-0 border-b border-gray-400',
      'focus:border-primary-600 focus:ring-0',
      'rounded-none px-0',
      error && 'border-red-300 focus:border-red-500'
    ),
  }
  
  // Base textarea classes
  const textareaClasses = cn(
    // Base styles
    'block w-full rounded-md shadow-sm',
    'text-gray-900 placeholder-gray-400',
    'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500',
    'transition-colors duration-200',
    'resize-none', // We control resize behavior
    
    // Size classes
    sizeClasses[textareaSize],
    
    // Variant classes
    variantClasses[variant],
    
    // Custom classes
    className
  )
  
  // Wrapper classes
  const wrapperClasses = cn(
    'relative',
    fullWidth ? 'w-full' : 'inline-flex',
    wrapperClassName
  )
  
  // Handle auto-resize
  const adjustHeight = () => {
    const textarea = textareaRef.current
    if (!textarea || !autoResize) return
    
    // Reset height to get accurate scrollHeight
    textarea.style.height = 'auto'
    
    // Calculate new height
    const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight)
    const minHeight = minRows * lineHeight
    const maxHeight = maxRows * lineHeight
    const scrollHeight = textarea.scrollHeight
    
    // Set new height within bounds
    const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight)
    textarea.style.height = `${newHeight}px`
  }
  
  // Update character count
  const updateCharCount = (text: string) => {
    setCharCount(text.length)
  }
  
  // Handle change
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (showCount) {
      updateCharCount(e.target.value)
    }
    if (autoResize) {
      adjustHeight()
    }
    onChange?.(e)
  }
  
  // Set ref
  const setRefs = (element: HTMLTextAreaElement | null) => {
    textareaRef.current = element
    if (typeof ref === 'function') {
      ref(element)
    } else if (ref) {
      ref.current = element
    }
  }
  
  // Initialize
  useEffect(() => {
    if (showCount) {
      const initialValue = (value || defaultValue || '') as string
      updateCharCount(initialValue)
    }
    if (autoResize) {
      adjustHeight()
    }
  }, [value, defaultValue, showCount, autoResize])
  
  // Adjust height when value changes externally
  useEffect(() => {
    if (autoResize) {
      adjustHeight()
    }
  }, [value, autoResize])
  
  return (
    <div className={wrapperClasses}>
      <textarea
        ref={setRefs}
        className={textareaClasses}
        onChange={handleChange}
        value={value}
        defaultValue={defaultValue}
        maxLength={maxLength}
        rows={autoResize ? minRows : props.rows}
        aria-invalid={error}
        aria-describedby={
          error && props['aria-describedby']
            ? `${props['aria-describedby']} ${props.id}-error`
            : props['aria-describedby']
        }
        {...props}
      />
      
      {/* Error icon */}
      {error && (
        <div className="absolute top-2 right-2 pointer-events-none">
          <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
        </div>
      )}
      
      {/* Character count */}
      {showCount && (
        <div className={cn(
          'absolute bottom-2 right-2 text-xs pointer-events-none',
          charCount > (maxLength || Infinity) * 0.9
            ? 'text-red-600'
            : 'text-gray-400'
        )}>
          {charCount}
          {maxLength && `/${maxLength}`}
        </div>
      )}
    </div>
  )
})

Textarea.displayName = 'Textarea'

/**
 * TextareaWithActions - Textarea with action buttons
 */
export function TextareaWithActions({
  children,
  actions,
  className,
}: {
  children: React.ReactElement<TextareaProps>
  actions: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {children}
      <div className="flex justify-end gap-2">
        {actions}
      </div>
    </div>
  )
}