'use client'

import { cn } from '@/lib/utils'

interface TooltipProps {
  content: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

const sideStyles: Record<string, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <span className="relative group/tooltip inline-flex">
      {children}
      <span
        className={cn(
          'absolute z-50 pointer-events-none',
          'px-2 py-1 text-xs font-medium text-white bg-text rounded-md',
          'opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-150',
          'whitespace-nowrap',
          sideStyles[side]
        )}
        role="tooltip"
      >
        {content}
      </span>
    </span>
  )
}
