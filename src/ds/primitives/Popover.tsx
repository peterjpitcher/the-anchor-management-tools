'use client'

import {
  Popover as HeadlessPopover,
  PopoverButton,
  PopoverPanel,
} from '@headlessui/react'
import { cn } from '@/lib/utils'

export interface PopoverProps {
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'left' | 'right'
  /** @deprecated Accepted for backward compatibility */
  placement?: string
  /** @deprecated Accepted for backward compatibility */
  width?: number
  /** @deprecated Accepted for backward compatibility */
  onOpenChange?: (open: boolean) => void
}

export function Popover({ trigger, children, align = 'left', placement: _placement, width, onOpenChange: _ooc }: PopoverProps) {
  return (
    <HeadlessPopover className="relative">
      <PopoverButton as="div" className="inline-flex">
        {trigger}
      </PopoverButton>

      <PopoverPanel
        className={cn(
          'absolute z-50 mt-2 max-w-[calc(100vw-1rem)] rounded-lg bg-surface border border-border shadow-lg p-4',
          width ? '' : 'w-72',
          'focus:outline-none',
          'transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0',
          align === 'right' ? 'right-0' : 'left-0'
        )}
      >
        {children}
      </PopoverPanel>
    </HeadlessPopover>
  )
}
