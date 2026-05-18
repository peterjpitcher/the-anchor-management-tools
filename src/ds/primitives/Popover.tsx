'use client'

import {
  Popover as HeadlessPopover,
  PopoverButton,
  PopoverPanel,
} from '@headlessui/react'
import { cn } from '@/lib/utils'

interface PopoverProps {
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'left' | 'right'
}

export function Popover({ trigger, children, align = 'left' }: PopoverProps) {
  return (
    <HeadlessPopover className="relative">
      <PopoverButton as="div" className="inline-flex">
        {trigger}
      </PopoverButton>

      <PopoverPanel
        className={cn(
          'absolute z-50 mt-2 w-72 rounded-lg bg-surface border border-border shadow-lg p-4',
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
