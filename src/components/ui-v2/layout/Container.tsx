/**
 * Container Component
 * 
 * Used on 107/107 pages (100%)
 * 
 * Provides consistent max-width and padding for page content.
 * Responsive by default with multiple size options.
 */

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { tokens } from '../tokens'
import type { LayoutProps } from '../types'

export interface ContainerProps extends LayoutProps {
  /**
   * Maximum width of the container
   * @default 'xl'
   */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
  
  /**
   * Whether to add horizontal padding
   * @default true
   */
  padding?: boolean
  
  /**
   * Whether to center the container
   * @default true
   */
  center?: boolean
}

export const Container = forwardRef<HTMLDivElement, ContainerProps>(({
  as: Component = 'div',
  size = 'xl',
  padding = true,
  center = true,
  className,
  children,
  ...props
}, ref) => {
  // Max width classes based on size
  const maxWidthClasses = {
    sm: 'max-w-screen-sm',   // 640px
    md: 'max-w-screen-md',   // 768px
    lg: 'max-w-screen-lg',   // 1024px
    xl: 'max-w-screen-xl',   // 1280px
    '2xl': 'max-w-screen-2xl', // 1536px
    full: 'max-w-full',
  }
  
  const ElementType = Component as any
  
  return (
    <ElementType
      ref={ref}
      className={cn(
        // Base styles
        'w-full',
        
        // Max width
        maxWidthClasses[size],
        
        // Centering
        center && 'mx-auto',
        
        // Padding - responsive
        padding && [
          'px-4',     // 16px on mobile
          'sm:px-6',  // 24px on tablet
          'lg:px-8',  // 32px on desktop
        ],
        
        className
      )}
      {...props}
    >
      {children}
    </ElementType>
  )
})

Container.displayName = 'Container'