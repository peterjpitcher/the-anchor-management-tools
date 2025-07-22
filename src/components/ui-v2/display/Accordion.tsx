'use client'

/**
 * Accordion Component
 * 
 * Collapsible content panels for organizing information.
 * Supports single/multiple expansion, icons, and animations.
 */

import { useState, ReactNode, createContext, useContext } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
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
  /**
   * Accordion items
   */
  items: AccordionItem[]
  
  /**
   * Active keys (controlled mode)
   */
  activeKeys?: string[]
  
  /**
   * Default active keys (uncontrolled mode)
   */
  defaultActiveKeys?: string[]
  
  /**
   * Callback when active keys change
   */
  onChange?: (keys: string[]) => void
  
  /**
   * Whether to allow multiple panels open
   * @default false
   */
  multiple?: boolean
  
  /**
   * Whether to allow all panels to be closed
   * @default true
   */
  collapsible?: boolean
  
  /**
   * Accordion style variant
   * @default 'default'
   */
  variant?: 'default' | 'bordered' | 'separated' | 'ghost'
  
  /**
   * Accordion size
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Icon position
   * @default 'start'
   */
  iconPosition?: 'start' | 'end'
  
  /**
   * Custom expand icon
   */
  expandIcon?: ReactNode
  
  /**
   * Whether to show arrow
   * @default true
   */
  showArrow?: boolean
  
  /**
   * Whether to destroy inactive panels
   * @default false
   */
  destroyInactive?: boolean
  
  /**
   * Additional container classes
   */
  className?: string
  
  /**
   * Additional header classes
   */
  headerClassName?: string
  
  /**
   * Additional content classes
   */
  contentClassName?: string
  
  /**
   * Custom header renderer
   */
  renderHeader?: (item: AccordionItem, isExpanded: boolean) => ReactNode
  
  /**
   * Whether accordion fills container width
   * @default true
   */
  fullWidth?: boolean
}

// Context for nested accordions
const AccordionContext = createContext<{
  level: number
}>({ level: 0 })

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
  const [uncontrolledActiveKeys, setUncontrolledActiveKeys] = useState<string[]>(defaultActiveKeys)
  const context = useContext(AccordionContext)
  const level = context.level
  
  // Use controlled or uncontrolled active keys
  const activeKeys = controlledActiveKeys ?? uncontrolledActiveKeys
  
  // Toggle panel
  const togglePanel = (key: string) => {
    let newKeys: string[]
    
    if (multiple) {
      // Multiple mode - toggle individual panel
      if (activeKeys.includes(key)) {
        newKeys = activeKeys.filter(k => k !== key)
      } else {
        newKeys = [...activeKeys, key]
      }
    } else {
      // Single mode
      if (activeKeys.includes(key) && collapsible) {
        newKeys = []
      } else {
        newKeys = [key]
      }
    }
    
    setUncontrolledActiveKeys(newKeys)
    onChange?.(newKeys)
  }
  
  // Size classes
  const sizeClasses = {
    sm: {
      header: 'px-3 py-2 text-sm',
      content: 'px-3 py-2 text-sm',
      icon: 'h-4 w-4',
    },
    md: {
      header: 'px-4 py-3',
      content: 'px-4 py-3',
      icon: 'h-5 w-5',
    },
    lg: {
      header: 'px-5 py-4 text-lg',
      content: 'px-5 py-4',
      icon: 'h-6 w-6',
    },
  }
  
  // Variant classes
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
        className={cn(
          fullWidth && 'w-full',
          currentVariant.container,
          className
        )}
        role="region"
        aria-multiselectable={multiple}
      >
        {items.map((item, index) => {
          const isExpanded = activeKeys.includes(item.key)
          const Icon = showArrow ? (iconPosition === 'start' ? ChevronRightIcon : ChevronDownIcon) : null
          
          return (
            <div
              key={item.key}
              className={currentVariant.item}
            >
              {/* Header */}
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
                  headerClassName
                )}
              >
                {renderHeader ? (
                  renderHeader(item, isExpanded)
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      {showArrow && iconPosition === 'start' && (
                        <span className={cn(
                          'transition-transform duration-200',
                          currentSize.icon,
                          isExpanded && 'rotate-90'
                        )}>
                          {expandIcon || (Icon && <Icon />)}
                        </span>
                      )}
                      
                      {item.icon && (
                        <span className={cn('flex-shrink-0', currentSize.icon)}>
                          {item.icon}
                        </span>
                      )}
                      
                      <span className="text-left font-medium">
                        {item.title}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      {item.extra}
                      
                      {showArrow && iconPosition === 'end' && (
                        <span className={cn(
                          'transition-transform duration-200',
                          currentSize.icon,
                          isExpanded && 'rotate-180'
                        )}>
                          {expandIcon || (Icon && <Icon />)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </button>
              
              {/* Content */}
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
                      contentClassName
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

/**
 * SimpleAccordion - Accordion with title/content pattern
 */
export function SimpleAccordion({
  items,
  ...props
}: {
  items: Array<{
    key: string
    title: string
    content: string | ReactNode
  }>
} & Omit<AccordionProps, 'items'>) {
  return (
    <Accordion
      items={items.map(item => ({
        ...item,
        content: typeof item.content === 'string' ? (
          <p className="text-gray-600">{item.content}</p>
        ) : item.content
      }))}
      {...props}
    />
  )
}

/**
 * FAQAccordion - Accordion optimized for FAQ sections
 */
export function FAQAccordion({
  faqs,
  ...props
}: {
  faqs: Array<{
    question: string
    answer: string
  }>
} & Omit<AccordionProps, 'items'>) {
  return (
    <Accordion
      items={faqs.map((faq, index) => ({
        key: `faq-${index}`,
        title: faq.question,
        content: (
          <div className="prose prose-sm max-w-none text-gray-600">
            {faq.answer}
          </div>
        )
      }))}
      variant="bordered"
      showArrow={true}
      iconPosition="end"
      {...props}
    />
  )
}

/**
 * useAccordion - Hook for managing accordion state
 */
export function useAccordion(defaultKeys: string[] = [], multiple = false) {
  const [activeKeys, setActiveKeys] = useState<string[]>(defaultKeys)
  
  const toggle = (key: string) => {
    if (multiple) {
      setActiveKeys(prev =>
        prev.includes(key)
          ? prev.filter(k => k !== key)
          : [...prev, key]
      )
    } else {
      setActiveKeys(prev =>
        prev.includes(key) ? [] : [key]
      )
    }
  }
  
  const expand = (key: string) => {
    if (multiple) {
      setActiveKeys(prev =>
        prev.includes(key) ? prev : [...prev, key]
      )
    } else {
      setActiveKeys([key])
    }
  }
  
  const collapse = (key: string) => {
    setActiveKeys(prev => prev.filter(k => k !== key))
  }
  
  const expandAll = (keys: string[]) => {
    setActiveKeys(keys)
  }
  
  const collapseAll = () => {
    setActiveKeys([])
  }
  
  return {
    activeKeys,
    setActiveKeys,
    toggle,
    expand,
    collapse,
    expandAll,
    collapseAll,
    isExpanded: (key: string) => activeKeys.includes(key),
  }
}