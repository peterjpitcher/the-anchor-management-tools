'use client'

/**
 * Spinner Component
 * 
 * Used on 95/107 pages (89%)
 * 
 * Provides consistent loading indicators throughout the application.
 * Replaces various inline spinner implementations.
 */

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import type { ComponentProps } from '../types'

export interface SpinnerProps extends ComponentProps {
    /**
     * Size of the spinner
     * @default 'md'
     */
    size?: 'sm' | 'md' | 'lg' | 'xl'

    /**
     * Color variant
     * @default 'primary'
     */
    color?: 'primary' | 'white' | 'gray'

    /**
     * Accessible label for screen readers
     * @default 'Loading...'
     */
    label?: string

    /**
     * Whether to show the label visually
     * @default false
     */
    showLabel?: boolean
}

export const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(({
    size = 'md',
    color = 'primary',
    label = 'Loading...',
    showLabel = false,
    className,
    ...props
}, ref) => {
    // Size classes
    const sizeClasses = {
        sm: 'h-4 w-4',
        md: 'h-6 w-6',
        lg: 'h-8 w-8',
        xl: 'h-12 w-12',
    }

    // Color classes
    const colorClasses = {
        primary: 'text-green-600',
        white: 'text-white',
        gray: 'text-gray-400',
    }


    return (
        <div
            ref={ref}
            className={cn('inline-flex items-center', className)}
            role="status"
            aria-live="polite"
            aria-busy="true"
            {...props}
        >
            <svg
                className={cn(
                    'animate-spin',
                    sizeClasses[size],
                    colorClasses[color]
                )}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
            >
                <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                />
                <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
            </svg>

            {showLabel ? (
                <span className={cn(
                    'ml-2',
                    size === 'sm' && 'text-xs',
                    size === 'md' && 'text-sm',
                    size === 'lg' && 'text-base',
                    size === 'xl' && 'text-lg',
                    color === 'white' && 'text-white',
                    color === 'gray' && 'text-gray-500',
                    color === 'primary' && 'text-gray-700'
                )}>
                    {label}
                </span>
            ) : (
                <span className="sr-only">{label}</span>
            )}
        </div>
    )
})

Spinner.displayName = 'Spinner'

/**
 * SpinnerOverlay - Full page loading overlay
 */
export function SpinnerOverlay({
    label = 'Loading...',
    blur = true,
    className,
    ...props
}: SpinnerProps & { blur?: boolean }) {
    return (
        <div
            className={cn(
                'fixed inset-0 z-50 flex items-center justify-center',
                blur && 'backdrop-blur-sm',
                'bg-white/75',
                className
            )}
            {...props}
        >
            <div className="text-center">
                <Spinner size="xl" color="primary" />
                <p className="mt-4 text-sm text-gray-600">{label}</p>
            </div>
        </div>
    )
}

/**
 * SpinnerButton - Spinner for button loading states
 */
export function SpinnerButton({
    size = 'sm',
    className,
    ...props
}: SpinnerProps) {
    return (
        <Spinner
            size={size}
            className={cn('-ml-1 mr-2', className)}
            {...props}
        />
    )
}