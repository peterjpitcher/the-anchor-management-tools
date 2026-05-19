'use client'

import { useState, ReactNode, createContext, useContext } from 'react'
import { cn } from '@/lib/utils'
import { ChevronRightIcon, ChevronDownIcon } from '@heroicons/react/20/solid'
import { Transition } from '@headlessui/react'

export interface AccordionItem {
  key: string
  title: ReactNode
  content: ReactNode
  icon?: ReactNode
  disabled?: boolean
  extra?: ReactNode
}

export interface AccordionProps {
  items: AccordionItem[]
  activeKeys?: string[]
  defaultActiveKeys?: string[]
  onChange?: (keys: string[]) => void
  multiple?: boolean
  collapsible?: boolean
  variant?: 'default' | 'bordered' | 'separated' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  iconPosition?: 'start' | 'end'
  expandIcon?: ReactNode
  showArrow?: boolean
  destroyInactive?: boolean
  className?: string
  headerClassName?: string
  contentClassName?: string
  renderHeader?: (item: AccordionItem, isExpanded: boolean) => ReactNode
  fullWidth?: boolean
}

const AccordionContext = createContext<{ level: number }>({ level: 0 })

export function Accordion({
  items,
  activeKeys: controlledActiveKeys,
  defaultActiveKeys = [],
  onChange,
  multiple = false,
  collapsible = true,
  variant = 'default',
  size = 'md',
  iconPosition = 'start',
  expandIcon,
  showArrow = true,
  destroyInactive = false,
  className,
  headerClassName,
  contentClassName,
  renderHeader,
  fullWidth = true,
}: AccordionProps) {
  const [uncontrolledActiveKeys, setUncontrolledActiveKeys] =
    useState<string[]>(defaultActiveKeys)
  const context = useContext(AccordionContext)
  const level = context.level

  const activeKeys = controlledActiveKeys ?? uncontrolledActiveKeys

  const togglePanel = (key: string) => {
    let newKeys: string[]
    if (multiple) {
      newKeys = activeKeys.includes(key)
        ? activeKeys.filter((k) => k !== key)
        : [...activeKeys, key]
    } else {
      newKeys = activeKeys.includes(key) && collapsible ? [] : [key]
    }
    setUncontrolledActiveKeys(newKeys)
    onChange?.(newKeys)
  }

  const sizeClasses = {
    sm: { header: 'px-3 py-2 text-sm', content: 'px-3 py-2 text-sm', icon: 'h-4 w-4' },
    md: { header: 'px-4 py-3', content: 'px-4 py-3', icon: 'h-5 w-5' },
    lg: { header: 'px-5 py-4 text-lg', content: 'px-5 py-4', icon: 'h-6 w-6' },
  }

  const variantClasses = {
    default: {
      container: 'border border-gray-200 divide-y divide-gray-200 rounded-lg overflow-hidden',
      item: '',
      header: 'bg-white hover:bg-gray-50',
      activeHeader: 'bg-gray-50',
      content: 'bg-white border-t border-gray-200',
    },
    bordered: {
      container: 'space-y-3',
      item: 'border border-gray-200 rounded-lg overflow-hidden',
      header: 'bg-white hover:bg-gray-50',
      activeHeader: 'bg-gray-50',
      content: 'bg-white border-t border-gray-200',
    },
    separated: {
      container: 'space-y-3',
      item: 'border border-gray-200 rounded-lg shadow-sm overflow-hidden',
      header: 'bg-white hover:bg-gray-50',
      activeHeader: 'bg-gray-50',
      content: 'bg-gray-50 border-t border-gray-200',
    },
    ghost: {
      container: 'space-y-1',
      item: '',
      header: 'hover:bg-gray-100 rounded-lg',
      activeHeader: 'bg-gray-100',
      content: '',
    },
  }

  const currentSize = sizeClasses[size]
  const currentVariant = variantClasses[variant]

  return (
    <AccordionContext.Provider value={{ level: level + 1 }}>
      <div
        className={cn(fullWidth && 'w-full', currentVariant.container, className)}
        role="region"
      >
        {items.map((item) => {
          const isExpanded = activeKeys.includes(item.key)
          const ArrowIcon = showArrow
            ? iconPosition === 'start'
              ? ChevronRightIcon
              : ChevronDownIcon
            : null

          return (
            <div key={item.key} className={currentVariant.item}>
              <button
                type="button"
                onClick={() => !item.disabled && togglePanel(item.key)}
                disabled={item.disabled}
                aria-expanded={isExpanded}
                aria-controls={`accordion-panel-${item.key}`}
                className={cn(
                  'w-full flex items-center justify-between transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-inset',
                  currentSize.header,
                  currentVariant.header,
                  isExpanded && currentVariant.activeHeader,
                  item.disabled && 'opacity-50 cursor-not-allowed',
                  !item.disabled && 'cursor-pointer',
                  headerClassName,
                )}
              >
                {renderHeader ? (
                  renderHeader(item, isExpanded)
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      {showArrow && iconPosition === 'start' && (
                        <span
                          className={cn(
                            'transition-transform duration-200',
                            currentSize.icon,
                            isExpanded && 'rotate-90',
                          )}
                        >
                          {expandIcon || (ArrowIcon && <ArrowIcon />)}
                        </span>
                      )}
                      {item.icon && (
                        <span className={cn('flex-shrink-0', currentSize.icon)}>{item.icon}</span>
                      )}
                      <span className="text-left font-medium">{item.title}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {item.extra}
                      {showArrow && iconPosition === 'end' && (
                        <span
                          className={cn(
                            'transition-transform duration-200',
                            currentSize.icon,
                            isExpanded && 'rotate-180',
                          )}
                        >
                          {expandIcon || (ArrowIcon && <ArrowIcon />)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </button>

              {(!destroyInactive || isExpanded) && (
                <Transition
                  show={isExpanded}
                  enter="transition-all duration-200 ease-out"
                  enterFrom="transform opacity-0 max-h-0"
                  enterTo="transform opacity-100 max-h-screen"
                  leave="transition-all duration-200 ease-out"
                  leaveFrom="transform opacity-100 max-h-screen"
                  leaveTo="transform opacity-0 max-h-0"
                >
                  <div
                    id={`accordion-panel-${item.key}`}
                    role="region"
                    aria-labelledby={`accordion-header-${item.key}`}
                    className={cn(
                      'overflow-hidden',
                      currentSize.content,
                      currentVariant.content,
                      contentClassName,
                    )}
                  >
                    {item.content}
                  </div>
                </Transition>
              )}
            </div>
          )
        })}
      </div>
    </AccordionContext.Provider>
  )
}
