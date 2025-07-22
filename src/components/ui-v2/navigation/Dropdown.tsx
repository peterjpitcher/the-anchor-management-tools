'use client'

/**
 * Dropdown Component
 * 
 * Accessible dropdown menu with keyboard navigation and customizable triggers.
 * Supports single and multi-level menus.
 */

import { useState, useRef, Fragment, ReactNode } from 'react'
import { Menu, Transition } from '@headlessui/react'
import { cn } from '@/lib/utils'
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/20/solid'
import { Button } from '../forms/Button'

export interface DropdownItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  description?: ReactNode
  disabled?: boolean
  danger?: boolean
  onClick?: () => void
  href?: string
  children?: DropdownItem[]
  divider?: boolean
  selected?: boolean
}

export interface DropdownProps {
  /**
   * Dropdown items
   */
  items: DropdownItem[]
  
  /**
   * Trigger element
   */
  trigger?: ReactNode
  
  /**
   * Trigger label (if using default button)
   */
  label?: string
  
  /**
   * Trigger icon
   */
  icon?: ReactNode
  
  /**
   * Dropdown placement
   * @default 'bottom-start'
   */
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'
  
  /**
   * Button variant (if using default trigger)
   * @default 'secondary'
   */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'link'
  
  /**
   * Button size (if using default trigger)
   * @default 'md'
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  
  /**
   * Whether to show chevron icon
   * @default true
   */
  showChevron?: boolean
  
  /**
   * Menu width
   * @default 'auto'
   */
  menuWidth?: 'auto' | 'trigger' | number
  
  /**
   * Additional menu classes
   */
  menuClassName?: string
  
  /**
   * Additional trigger classes
   */
  triggerClassName?: string
  
  /**
   * Whether dropdown is disabled
   * @default false
   */
  disabled?: boolean
  
  /**
   * Custom item renderer
   */
  renderItem?: (item: DropdownItem, isActive: boolean) => ReactNode
  
  /**
   * Callback when dropdown opens
   */
  onOpen?: () => void
  
  /**
   * Callback when dropdown closes
   */
  onClose?: () => void
}

export function Dropdown({
  items,
  trigger,
  label = 'Options',
  icon,
  placement = 'bottom-start',
  variant = 'secondary',
  size = 'md',
  showChevron = true,
  menuWidth = 'auto',
  menuClassName,
  triggerClassName,
  disabled = false,
  renderItem,
  onOpen,
  onClose,
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  
  // Handle open/close callbacks
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (open) {
      onOpen?.()
    } else {
      onClose?.()
    }
  }
  
  // Placement classes
  const placementClasses = {
    'bottom-start': 'origin-top-left left-0',
    'bottom-end': 'origin-top-right right-0',
    'top-start': 'origin-bottom-left left-0 bottom-full mb-2',
    'top-end': 'origin-bottom-right right-0 bottom-full mb-2',
  }
  
  // Menu width style
  const menuStyle: React.CSSProperties = menuWidth === 'trigger' && buttonRef.current
    ? { width: buttonRef.current.offsetWidth }
    : typeof menuWidth === 'number'
    ? { width: menuWidth }
    : {}
  
  // Render menu items recursively
  const renderMenuItems = (menuItems: DropdownItem[], level = 0) => {
    return menuItems.map((item, index) => {
      // Divider
      if (item.divider) {
        return (
          <div
            key={`divider-${index}`}
            className="my-1 h-px bg-gray-200"
            role="separator"
          />
        )
      }
      
      // Nested menu
      if (item.children && item.children.length > 0) {
        return (
          <Menu as="div" key={item.key} className="relative">
            <Menu.Button
              className={cn(
                'group flex w-full items-center rounded-md px-2 py-2 text-sm',
                'hover:bg-gray-100 hover:text-gray-900',
                'ui-active:bg-gray-100 ui-active:text-gray-900',
                item.disabled && 'opacity-50 cursor-not-allowed'
              )}
              disabled={item.disabled}
            >
              {item.icon && (
                <span className="mr-3 h-5 w-5 text-gray-400 group-hover:text-gray-500">
                  {item.icon}
                </span>
              )}
              <span className="flex-1 text-left">{item.label}</span>
              <ChevronDownIcon
                className="ml-2 -mr-1 h-5 w-5 text-gray-400"
                aria-hidden="true"
              />
            </Menu.Button>
            
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items className="absolute left-full top-0 ml-2 w-56 origin-top-left rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                <div className="py-1">
                  {renderMenuItems(item.children, level + 1)}
                </div>
              </Menu.Items>
            </Transition>
          </Menu>
        )
      }
      
      // Regular item
      return (
        <Menu.Item key={item.key} disabled={item.disabled}>
          {({ active }) => {
            const handleClick = () => {
              if (item.onClick) {
                item.onClick()
              }
              if (item.href) {
                window.location.href = item.href
              }
            }
            
            const itemContent = renderItem ? (
              renderItem(item, active)
            ) : (
              <>
                {item.icon && (
                  <span className={cn(
                    'mr-3 h-5 w-5',
                    item.danger
                      ? 'text-red-400 group-hover:text-red-500'
                      : 'text-gray-400 group-hover:text-gray-500'
                  )}>
                    {item.icon}
                  </span>
                )}
                <div className="flex-1">
                  <div className={cn(
                    item.danger && 'text-red-600 group-hover:text-red-700'
                  )}>
                    {item.label}
                  </div>
                  {item.description && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {item.description}
                    </p>
                  )}
                </div>
                {item.selected && (
                  <CheckIcon className="ml-2 h-5 w-5 text-green-600" aria-hidden="true" />
                )}
              </>
            )
            
            const baseClasses = cn(
              'group flex w-full items-center rounded-md px-2 py-2 text-sm',
              active && !item.danger && 'bg-gray-100 text-gray-900',
              active && item.danger && 'bg-red-50 text-red-900',
              item.disabled && 'opacity-50 cursor-not-allowed',
              !item.disabled && 'cursor-pointer'
            )
            
            if (item.href && !item.disabled) {
              return (
                <a
                  href={item.href}
                  className={baseClasses}
                  onClick={item.onClick}
                >
                  {itemContent}
                </a>
              )
            }
            
            return (
              <button
                type="button"
                className={baseClasses}
                onClick={handleClick}
                disabled={item.disabled}
              >
                {itemContent}
              </button>
            )
          }}
        </Menu.Item>
      )
    })
  }
  
  return (
    <Menu as="div" className="relative inline-block text-left">
      {({ open }) => {
        if (open !== isOpen) {
          handleOpenChange(open)
        }
        
        return (
          <>
            <Menu.Button
              ref={buttonRef}
              as={trigger ? Fragment : Button}
              disabled={disabled}
              className={triggerClassName}
              {...(!trigger && {
                variant,
                size,
                rightIcon: showChevron && <ChevronDownIcon className="-mr-1" />,
                leftIcon: icon,
                children: label,
              })}
            >
              {trigger}
            </Menu.Button>
            
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items
                className={cn(
                  'absolute mt-2 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50',
                  placementClasses[placement],
                  menuWidth === 'auto' && 'w-56',
                  menuClassName
                )}
                style={menuStyle}
              >
                <div className="py-1">
                  {renderMenuItems(items)}
                </div>
              </Menu.Items>
            </Transition>
          </>
        )
      }}
    </Menu>
  )
}

/**
 * DropdownButton - Convenience component for common dropdown button pattern
 */
export function DropdownButton(props: DropdownProps) {
  return <Dropdown {...props} />
}

/**
 * ActionMenu - Dropdown optimized for action lists
 */
export function ActionMenu({
  actions,
  ...props
}: {
  actions: Array<{
    label: string
    onClick: () => void
    icon?: ReactNode
    danger?: boolean
    disabled?: boolean
  }>
} & Omit<DropdownProps, 'items'>) {
  const items: DropdownItem[] = actions.map((action, index) => ({
    key: `action-${index}`,
    label: action.label,
    onClick: action.onClick,
    icon: action.icon,
    danger: action.danger,
    disabled: action.disabled,
  }))
  
  return <Dropdown items={items} {...props} />
}