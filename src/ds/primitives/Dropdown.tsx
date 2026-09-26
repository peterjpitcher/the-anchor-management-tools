'use client'

import { Fragment } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

export interface DropdownProps {
  trigger?: React.ReactNode
  /** @deprecated Use `trigger` instead */
  label?: React.ReactNode
  /** @deprecated Accepted for backward compatibility: use `trigger` instead */
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
  /**
   * Which trigger edge the menu lines up with (default `right`). The menu opens below the
   * trigger and flips above it when there is no room below.
   */
  align?: 'left' | 'right'
  /**
   * How wide the menu is: `sm` (the default, 12rem), `md` (16rem) or `lg` (20rem) for items with
   * longer labels, or `auto` to fit the longest item (at least 12rem, at most 20rem). Pick the
   * width that keeps every label on one line.
   */
  width?: DropdownWidth
}

export type DropdownWidth = 'auto' | 'sm' | 'md' | 'lg'

const WIDTH_CLASSES: Record<DropdownWidth, string> = {
  sm: 'w-48',
  md: 'w-64',
  lg: 'w-80',
  auto: 'w-max min-w-48 max-w-80',
}

/** Marks an item that keeps the menu open when chosen (see `DropdownItemProps.closeOnSelect`). */
const KEEP_OPEN_ATTRIBUTE = 'data-dropdown-keep-open'

/**
 * Enter and Space choose the highlighted item from the menu itself, and Headless UI closes the
 * menu straight after. For an item that stays open, click it here instead and stop there.
 */
function handleMenuKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const activeId = event.currentTarget.getAttribute('aria-activedescendant')
  if (!activeId) return
  const active = event.currentTarget.ownerDocument.getElementById(activeId)
  if (!active?.hasAttribute(KEEP_OPEN_ATTRIBUTE)) return
  event.preventDefault()
  event.stopPropagation()
  active.click()
}

/**
 * A menu of actions behind a trigger. The menu is portalled to the end of the page and anchored
 * to the trigger, so a scrolling table or a card with `overflow: hidden` cannot clip it.
 */
export function Dropdown({ trigger, label, icon: _icon, items, disabled: _disabled, variant: _variant, size: _size, children, align = 'right', width = 'sm' }: DropdownProps) {
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
        anchor={{ to: align === 'right' ? 'bottom end' : 'bottom start', gap: 4, padding: 8 }}
        onKeyDown={handleMenuKeyDown}
        className={cn(
          'z-50 rounded-lg bg-surface border border-border shadow-lg py-1',
          WIDTH_CLASSES[width],
          'focus:outline-hidden',
          'transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0',
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
  /**
   * Close the menu when this item is chosen (default true). Set false for an item that
   * changes something shown in the menu itself, such as a toggle.
   */
  closeOnSelect?: boolean
  children: React.ReactNode
}

export function DropdownItem({ onClick, icon, danger, disabled, closeOnSelect = true, children }: DropdownItemProps) {
  return (
    <MenuItem disabled={disabled}>
      <button
        type="button"
        onClick={(event) => {
          onClick?.()
          // Headless UI closes the menu after this handler unless the event is cancelled.
          if (!closeOnSelect) event.preventDefault()
        }}
        disabled={disabled}
        {...(closeOnSelect ? {} : { [KEEP_OPEN_ATTRIBUTE]: '' })}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-sm',
          'data-[focus]:bg-surface-hover transition-colors',
          'focus-visible:outline-hidden focus-visible:shadow-ring',
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

interface DropdownLabelProps {
  children: React.ReactNode
  className?: string
}

/**
 * A non-interactive heading over a group of items. Keyboard focus and type-ahead skip it.
 * The first label in a menu sits flush with the top; later ones leave a gap above.
 */
export function DropdownLabel({ children, className }: DropdownLabelProps) {
  return (
    <div
      role="presentation"
      className={cn(
        'px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-text-muted',
        '[&:not(:first-child)]:mt-1 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border',
        className,
      )}
    >
      {children}
    </div>
  )
}
