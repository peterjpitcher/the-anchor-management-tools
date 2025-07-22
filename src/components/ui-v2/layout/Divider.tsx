/**
 * Divider Component
 * 
 * Visual separator for content sections with optional text/icon.
 * Supports horizontal and vertical orientations.
 */

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DividerProps {
  /**
   * Orientation of the divider
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical'
  
  /**
   * Text or content to display in the divider
   */
  children?: ReactNode
  
  /**
   * Text alignment (horizontal only)
   * @default 'center'
   */
  textAlign?: 'left' | 'center' | 'right'
  
  /**
   * Style variant
   * @default 'solid'
   */
  variant?: 'solid' | 'dashed' | 'dotted' | 'double'
  
  /**
   * Color of the divider
   * @default 'gray'
   */
  color?: 'gray' | 'green' | 'blue' | 'red' | 'yellow' | 'white' | 'black'
  
  /**
   * Thickness of the divider
   * @default 'normal'
   */
  thickness?: 'thin' | 'normal' | 'thick'
  
  /**
   * Spacing around the divider
   * @default 'md'
   */
  spacing?: 'sm' | 'md' | 'lg' | 'xl'
  
  /**
   * Additional classes
   */
  className?: string
  
  /**
   * Icon to display
   */
  icon?: ReactNode
  
  /**
   * Whether to fade the edges
   * @default false
   */
  fade?: boolean
  
  /**
   * Custom line style
   */
  lineStyle?: React.CSSProperties
  
  /**
   * Role for accessibility
   * @default 'separator'
   */
  role?: string
  
  /**
   * Aria label
   */
  ariaLabel?: string
}

export function Divider({
  orientation = 'horizontal',
  children,
  textAlign = 'center',
  variant = 'solid',
  color = 'gray',
  thickness = 'normal',
  spacing = 'md',
  className,
  icon,
  fade = false,
  lineStyle,
  role = 'separator',
  ariaLabel,
}: DividerProps) {
  // Color classes
  const colorClasses = {
    gray: 'border-gray-300',
    green: 'border-green-600',
    blue: 'border-blue-600',
    red: 'border-red-600',
    yellow: 'border-yellow-600',
    white: 'border-white',
    black: 'border-black',
  }
  
  // Thickness classes
  const thicknessClasses = {
    thin: orientation === 'horizontal' ? 'border-t' : 'border-l',
    normal: orientation === 'horizontal' ? 'border-t-2' : 'border-l-2',
    thick: orientation === 'horizontal' ? 'border-t-4' : 'border-l-4',
  }
  
  // Spacing classes
  const spacingClasses = {
    sm: orientation === 'horizontal' ? 'my-2' : 'mx-2',
    md: orientation === 'horizontal' ? 'my-4' : 'mx-4',
    lg: orientation === 'horizontal' ? 'my-6' : 'mx-6',
    xl: orientation === 'horizontal' ? 'my-8' : 'mx-8',
  }
  
  // Text spacing classes
  const textSpacingClasses = {
    sm: 'gap-2',
    md: 'gap-4',
    lg: 'gap-6',
    xl: 'gap-8',
  }
  
  // Variant classes
  const variantClasses = {
    solid: '',
    dashed: 'border-dashed',
    dotted: 'border-dotted',
    double: 'border-double',
  }
  
  // Base line classes
  const lineClasses = cn(
    colorClasses[color],
    thicknessClasses[thickness],
    variantClasses[variant],
    'flex-1'
  )
  
  // Fade gradient
  const fadeGradient = fade ? {
    maskImage: orientation === 'horizontal'
      ? 'linear-gradient(to right, transparent, black 20%, black 80%, transparent)'
      : 'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)',
    WebkitMaskImage: orientation === 'horizontal'
      ? 'linear-gradient(to right, transparent, black 20%, black 80%, transparent)'
      : 'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)',
  } : {}
  
  // Render content
  const renderContent = () => {
    if (!children && !icon) return null
    
    return (
      <div className={cn(
        'flex items-center',
        textSpacingClasses[spacing],
        'text-sm text-gray-500 whitespace-nowrap'
      )}>
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {children}
      </div>
    )
  }
  
  // Horizontal divider
  if (orientation === 'horizontal') {
    // Simple divider without content
    if (!children && !icon) {
      return (
        <hr
          role={role}
          aria-label={ariaLabel}
          className={cn(
            lineClasses,
            spacingClasses[spacing],
            'border-0',
            className
          )}
          style={{
            ...fadeGradient,
            ...lineStyle,
          }}
        />
      )
    }
    
    // Divider with content
    return (
      <div
        role={role}
        aria-label={ariaLabel}
        className={cn(
          'flex items-center',
          spacingClasses[spacing],
          className
        )}
      >
        {textAlign !== 'left' && (
          <hr
            className={cn(lineClasses, 'border-0')}
            style={{
              ...fadeGradient,
              ...lineStyle,
            }}
          />
        )}
        
        {renderContent()}
        
        {textAlign !== 'right' && (
          <hr
            className={cn(lineClasses, 'border-0')}
            style={{
              ...fadeGradient,
              ...lineStyle,
            }}
          />
        )}
      </div>
    )
  }
  
  // Vertical divider
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex flex-col items-center self-stretch',
        spacingClasses[spacing],
        className
      )}
    >
      <hr
        className={cn(lineClasses, 'border-0', 'h-full min-h-[1em]')}
        style={{
          ...fadeGradient,
          ...lineStyle,
        }}
      />
      
      {renderContent()}
      
      {(children || icon) && (
        <hr
          className={cn(lineClasses, 'border-0', 'h-full min-h-[1em]')}
          style={{
            ...fadeGradient,
            ...lineStyle,
          }}
        />
      )}
    </div>
  )
}

/**
 * SectionDivider - Divider with section title
 */
export function SectionDivider({
  title,
  subtitle,
  icon,
  actions,
  ...props
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  actions?: ReactNode
} & Omit<DividerProps, 'children'>) {
  return (
    <Divider {...props}>
      <div className="flex items-center justify-between gap-4 w-full max-w-md">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <h3 className="font-medium text-gray-900">{title}</h3>
            {subtitle && (
              <p className="text-xs text-gray-500">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex-shrink-0">
            {actions}
          </div>
        )}
      </div>
    </Divider>
  )
}

/**
 * OrDivider - Common "OR" divider pattern
 */
export function OrDivider(props: Omit<DividerProps, 'children'>) {
  return (
    <Divider {...props}>
      <span className="px-2 bg-white text-gray-500">OR</span>
    </Divider>
  )
}

/**
 * DotDivider - Divider with dots
 */
export function DotDivider({
  dots = 3,
  ...props
}: {
  dots?: number
} & Omit<DividerProps, 'children'>) {
  return (
    <Divider {...props}>
      <div className="flex items-center gap-1">
        {Array.from({ length: dots }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'rounded-full',
              props.color === 'gray' ? 'bg-gray-300' : 'bg-current',
              props.thickness === 'thin' ? 'h-1 w-1' : 
              props.thickness === 'thick' ? 'h-2 w-2' : 'h-1.5 w-1.5'
            )}
          />
        ))}
      </div>
    </Divider>
  )
}