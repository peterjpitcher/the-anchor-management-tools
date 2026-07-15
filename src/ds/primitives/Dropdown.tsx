'use client'

import { Fragment } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

export interface DropdownProps {
  trigger?: React.ReactNode
  /** @deprecated Use `trigger` instead */
  label?: React.ReactNode
  /** @deprecated Accepted for backward compatibility — use `trigger` instead */
  icon?: React.ReactNode
  /** @deprecated Accepted for backward compatibility */
  items?: Array<{ key: string; label: React.ReactNode; description?: string; onClick?: () => void; icon?: React.ReactNode; danger?: boolean }>
  /** @deprecated Accepted for backward compatibility */
  disabled?: boolean
  /** @deprecated Accepted for backward compatibility */
  variant?: string
  /** @deprecated Accepted for backward compatibility */
  size?: string
  children?: React.ReactNode
  align?: 'left' | 'right'
}

export function Dropdown({ trigger, label, icon: _icon, items, disabled: _disabled, variant: _variant, size: _size, children, align = 'right' }: DropdownProps) {
  const resolvedTrigger = trigger ?? (
    <Button type="button" variant="ghost" size="sm" disabled={_disabled}>
      {label ?? 'More actions'}
    </Button>
  )
  return (
    <Menu as="div" className="relative inline-block text-left">
      <MenuButton as={Fragment}>
        {resolvedTrigger}
      </MenuButton>

      <MenuItems
        className={cn(
          'absolute z-50 mt-1 w-48 rounded-lg bg-surface border border-border shadow-lg py-1',
          'focus:outline-none',
          'transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0',
          align === 'right' ? 'right-0' : 'left-0'
        )}
      >
        {items && items.map((item) => (
          <DropdownItem key={item.key} onClick={item.onClick} icon={item.icon} danger={item.danger}>
            {item.label}
          </DropdownItem>
        ))}
        {children}
      </MenuItems>
    </Menu>
  )
}

interface DropdownItemProps {
  onClick?: () => void
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  children: React.ReactNode
}

export function DropdownItem({ onClick, icon, danger, disabled, children }: DropdownItemProps) {
  return (
    <MenuItem disabled={disabled}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-sm',
          'data-[focus]:bg-surface-hover transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
          danger ? 'text-danger' : 'text-text'
        )}
      >
        {icon && <span className="[&>svg]:w-4 [&>svg]:h-4 flex-shrink-0">{icon}</span>}
        {children}
      </button>
    </MenuItem>
  )
}
