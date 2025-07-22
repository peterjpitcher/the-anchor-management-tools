/**
 * Skeleton Component
 * 
 * Used on 95/107 pages (89%)
 * 
 * Provides loading placeholders that match the shape of content.
 * Prevents layout shift and improves perceived performance.
 */

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import type { ComponentProps } from '../types'

export interface SkeletonProps extends ComponentProps {
  /**
   * Shape variant of the skeleton
   * @default 'text'
   */
  variant?: 'text' | 'circular' | 'rectangular' | 'rounded'
  
  /**
   * Width of the skeleton
   * Can be a number (pixels) or string (any CSS value)
   */
  width?: string | number
  
  /**
   * Height of the skeleton
   * Can be a number (pixels) or string (any CSS value)
   */
  height?: string | number
  
  /**
   * Animation type
   * @default 'pulse'
   */
  animation?: 'pulse' | 'wave' | false
  
  /**
   * Number of lines (only for text variant)
   * @default 1
   */
  lines?: number
  
  /**
   * Whether the last line should be shorter (only for text variant with multiple lines)
   * @default true
   */
  lastLineShort?: boolean
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(({
  variant = 'text',
  width,
  height,
  animation = 'pulse',
  lines = 1,
  lastLineShort = true,
  className,
  style,
  ...props
}, ref) => {
  // Base classes
  const baseClasses = 'bg-gray-200'
  
  // Animation classes
  const animationClasses = {
    pulse: 'animate-pulse',
    wave: 'skeleton-wave',
    false: '',
  }
  
  // Variant classes
  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-none',
    rounded: 'rounded-md',
  }
  
  // Default dimensions based on variant
  const defaultDimensions = {
    text: { width: '100%', height: '1em' },
    circular: { width: 40, height: 40 },
    rectangular: { width: '100%', height: 120 },
    rounded: { width: '100%', height: 120 },
  }
  
  // Calculate dimensions
  const dimensions = {
    width: width ?? defaultDimensions[variant].width,
    height: height ?? defaultDimensions[variant].height,
  }
  
  // Style object
  const skeletonStyle = {
    width: typeof dimensions.width === 'number' ? `${dimensions.width}px` : dimensions.width,
    height: typeof dimensions.height === 'number' ? `${dimensions.height}px` : dimensions.height,
    ...style,
  }
  
  // Render multiple lines for text variant
  if (variant === 'text' && lines > 1) {
    return (
      <div ref={ref} className={className} {...props}>
        {Array.from({ length: lines }).map((_, index) => {
          const isLastLine = index === lines - 1
          const lineWidth = isLastLine && lastLineShort ? '80%' : dimensions.width
          
          return (
            <div
              key={index}
              className={cn(
                baseClasses,
                animationClasses[animation as keyof typeof animationClasses],
                variantClasses[variant],
                index > 0 && 'mt-2'
              )}
              style={{
                width: typeof lineWidth === 'number' ? `${lineWidth}px` : lineWidth,
                height: skeletonStyle.height,
              }}
            />
          )
        })}
      </div>
    )
  }
  
  return (
    <div
      ref={ref}
      className={cn(
        baseClasses,
        animationClasses[animation as keyof typeof animationClasses],
        variantClasses[variant],
        className
      )}
      style={skeletonStyle}
      {...props}
    />
  )
})

Skeleton.displayName = 'Skeleton'

/**
 * SkeletonText - Convenience component for text skeletons
 */
export function SkeletonText({
  lines = 3,
  ...props
}: Omit<SkeletonProps, 'variant'>) {
  return <Skeleton variant="text" lines={lines} {...props} />
}

/**
 * SkeletonAvatar - Convenience component for avatar skeletons
 */
export function SkeletonAvatar({
  size = 40,
  ...props
}: Omit<SkeletonProps, 'variant' | 'width' | 'height'> & { size?: number }) {
  return (
    <Skeleton
      variant="circular"
      width={size}
      height={size}
      {...props}
    />
  )
}

/**
 * SkeletonButton - Convenience component for button skeletons
 */
export function SkeletonButton({
  width = 100,
  height = 36,
  ...props
}: Omit<SkeletonProps, 'variant'>) {
  return (
    <Skeleton
      variant="rounded"
      width={width}
      height={height}
      {...props}
    />
  )
}

/**
 * SkeletonCard - Convenience component for card skeletons
 */
export function SkeletonCard({
  className,
  ...props
}: ComponentProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-lg shadow p-6 space-y-4',
        className
      )}
      {...props}
    >
      <div className="flex items-center space-x-4">
        <SkeletonAvatar size={48} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="50%" />
          <Skeleton variant="text" width="30%" />
        </div>
      </div>
      <SkeletonText lines={3} />
      <div className="flex space-x-2">
        <SkeletonButton width={80} />
        <SkeletonButton width={80} />
      </div>
    </div>
  )
}

// Add wave animation CSS (would normally be in global CSS)
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = `
    @keyframes skeleton-wave {
      0% {
        background-position: -200% 0;
      }
      100% {
        background-position: 200% 0;
      }
    }
    
    .skeleton-wave {
      background: linear-gradient(
        90deg,
        #e5e7eb 25%,
        #f3f4f6 50%,
        #e5e7eb 75%
      );
      background-size: 200% 100%;
      animation: skeleton-wave 1.5s ease-in-out infinite;
    }
  `
  document.head.appendChild(style)
}