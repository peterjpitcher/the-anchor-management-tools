'use client'

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { cn } from '@/lib/utils'

interface DropdownProps {
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'left' | 'right'
}

export function Dropdown({ trigger, children, align = 'right' }: DropdownProps) {
  return (
    <Menu as="div" className="relative inline-block text-left">
      <MenuButton as="div" className="inline-flex">
        {trigger}
      </MenuButton>

      <MenuItems
        className={cn(
          'absolute z-50 mt-1 w-48 rounded-lg bg-surface border border-border shadow-lg py-1',
          'focus:outline-none',
          'transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0',
          align === 'right' ? 'right-0' : 'left-0'
        )}
      >
        {children}
      </MenuItems>
    </Menu>
  )
}

interface DropdownItemProps {
  onClick?: () => void
  icon?: React.ReactNode
  danger?: boolean
  children: React.ReactNode
}

export function DropdownItem({ onClick, icon, danger, children }: DropdownItemProps) {
  return (
    <MenuItem>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-sm',
          'data-[focus]:bg-surface-hover transition-colors',
          danger ? 'text-danger' : 'text-text'
        )}
      >
        {icon && <span className="[&>svg]:w-4 [&>svg]:h-4 flex-shrink-0">{icon}</span>}
        {children}
      </button>
    </MenuItem>
  )
}
