'use client'

/**
 * Menu Component
 * 
 * Context menu and application menu with keyboard navigation.
 * Supports nested menus, icons, shortcuts, and dividers.
 */

import { useState, useRef, useEffect, ReactNode, KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { CheckIcon, ChevronRightIcon } from '@heroicons/react/20/solid'

export interface MenuItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  selected?: boolean
  onClick?: () => void
  href?: string
  children?: MenuItem[]
  type?: 'item' | 'divider' | 'header'
  description?: ReactNode
}

export interface MenuProps {
  /**
   * Menu items
   */
  items: MenuItem[]
  
  /**
   * Currently selected item key
   */
  selectedKey?: string
  
  /**
   * Callback when item is selected
   */
  onSelect?: (key: string) => void
  
  /**
   * Menu mode
   * @default 'vertical'
   */
  mode?: 'vertical' | 'horizontal' | 'inline'
  
  /**
   * Menu theme
   * @default 'light'
   */
  theme?: 'light' | 'dark'
  
  /**
   * Whether menu is collapsed (vertical only)
   * @default false
   */
  collapsed?: boolean
  
  /**
   * Default open keys for nested menus
   */
  defaultOpenKeys?: string[]
  
  /**
   * Open keys (controlled)
   */
  openKeys?: string[]
  
  /**
   * Callback when open keys change
   */
  onOpenChange?: (keys: string[]) => void
  
  /**
   * Whether to show icons
   * @default true
   */
  showIcons?: boolean
  
  /**
   * Whether to show shortcuts
   * @default true
   */
  showShortcuts?: boolean
  
  /**
   * Additional classes
   */
  className?: string
  
  /**
   * Item classes
   */
  itemClassName?: string
  
  /**
   * Custom item renderer
   */
  renderItem?: (item: MenuItem, isActive: boolean) => ReactNode
  
  /**
   * Whether to trigger on hover (horizontal mode)
   * @default false
   */
  triggerOnHover?: boolean
  
  /**
   * Level of nesting (internal)
   */
  level?: number
}

export function Menu({
  items,
  selectedKey,
  onSelect,
  mode = 'vertical',
  theme = 'light',
  collapsed = false,
  defaultOpenKeys = [],
  openKeys: controlledOpenKeys,
  onOpenChange,
  showIcons = true,
  showShortcuts = true,
  className,
  itemClassName,
  renderItem,
  triggerOnHover = false,
  level = 0,
}: MenuProps) {
  const [uncontrolledOpenKeys, setUncontrolledOpenKeys] = useState<string[]>(defaultOpenKeys)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map())
  
  // Use controlled or uncontrolled open keys
  const openKeys = controlledOpenKeys ?? uncontrolledOpenKeys
  
  // Toggle submenu
  const toggleSubmenu = (key: string) => {
    const newKeys = openKeys.includes(key)
      ? openKeys.filter(k => k !== key)
      : [...openKeys, key]
    
    setUncontrolledOpenKeys(newKeys)
    onOpenChange?.(newKeys)
  }
  
  // Handle item click
  const handleItemClick = (item: MenuItem) => {
    if (item.disabled || item.type === 'header' || item.type === 'divider') return
    
    if (item.children && item.children.length > 0) {
      toggleSubmenu(item.key)
    } else {
      item.onClick?.()
      onSelect?.(item.key)
      
      if (item.href) {
        window.location.href = item.href
      }
    }
  }
  
  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent, currentIndex: number) => {
    const visibleItems = items.filter(item => item.type !== 'divider')
    let newIndex = currentIndex
    
    switch (e.key) {
      case 'ArrowDown':
        if (mode === 'vertical' || mode === 'inline') {
          e.preventDefault()
          newIndex = Math.min(currentIndex + 1, visibleItems.length - 1)
        }
        break
      case 'ArrowUp':
        if (mode === 'vertical' || mode === 'inline') {
          e.preventDefault()
          newIndex = Math.max(currentIndex - 1, 0)
        }
        break
      case 'ArrowRight':
        if (mode === 'horizontal') {
          e.preventDefault()
          newIndex = Math.min(currentIndex + 1, visibleItems.length - 1)
        } else {
          // Open submenu
          const item = visibleItems[currentIndex]
          if (item.children && !openKeys.includes(item.key)) {
            toggleSubmenu(item.key)
          }
        }
        break
      case 'ArrowLeft':
        if (mode === 'horizontal') {
          e.preventDefault()
          newIndex = Math.max(currentIndex - 1, 0)
        } else {
          // Close submenu
          const item = visibleItems[currentIndex]
          if (item.children && openKeys.includes(item.key)) {
            toggleSubmenu(item.key)
          }
        }
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        const item = visibleItems[currentIndex]
        handleItemClick(item)
        break
      case 'Home':
        e.preventDefault()
        newIndex = 0
        break
      case 'End':
        e.preventDefault()
        newIndex = visibleItems.length - 1
        break
      default:
        return
    }
    
    // Focus new item
    if (newIndex !== currentIndex) {
      const newItem = visibleItems[newIndex]
      const ref = itemRefs.current.get(newItem.key)
      ref?.focus()
      setFocusedIndex(newIndex)
    }
  }
  
  // Theme classes
  const themeClasses = {
    light: {
      base: 'bg-white',
      item: 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
      activeItem: 'bg-gray-100 text-gray-900',
      selectedItem: 'bg-green-50 text-green-700',
      icon: 'text-gray-400',
      divider: 'bg-gray-200',
      header: 'text-gray-500',
    },
    dark: {
      base: 'bg-gray-900',
      item: 'text-gray-300 hover:bg-gray-800 hover:text-white',
      activeItem: 'bg-gray-800 text-white',
      selectedItem: 'bg-green-900 text-green-300',
      icon: 'text-gray-500',
      divider: 'bg-gray-700',
      header: 'text-gray-600',
    },
  }
  
  const currentTheme = themeClasses[theme]
  
  // Render menu items
  const renderMenuItems = () => {
    return items.map((item, index) => {
      const visibleIndex = items.slice(0, index).filter(i => i.type !== 'divider').length
      const isOpen = openKeys.includes(item.key)
      const isSelected = item.key === selectedKey
      const hasChildren = item.children && item.children.length > 0
      const isFocused = focusedIndex === visibleIndex
      
      // Divider
      if (item.type === 'divider') {
        return (
          <li
            key={`divider-${index}`}
            className={cn('my-1 h-px', currentTheme.divider)}
            role="separator"
          />
        )
      }
      
      // Header
      if (item.type === 'header') {
        return (
          <li
            key={item.key}
            className={cn(
              'px-3 py-2 text-xs font-semibold uppercase tracking-wider',
              currentTheme.header
            )}
          >
            {item.label}
          </li>
        )
      }
      
      // Regular item
      const itemContent = (
        <>
          {showIcons && (
            <span className={cn(
              'flex-shrink-0',
              mode === 'horizontal' ? 'mr-2 h-4 w-4' : 'mr-3 h-5 w-5',
              item.danger ? 'text-red-500' : currentTheme.icon
            )}>
              {item.icon || (hasChildren && mode === 'inline' && <span className="w-5" />)}
            </span>
          )}
          
          {(!collapsed || mode === 'horizontal') && (
            <>
              <span className={cn(
                'flex-1',
                item.danger && 'text-red-600'
              )}>
                {item.label}
              </span>
              
              {item.selected && (
                <CheckIcon className="ml-auto h-4 w-4 text-green-600" />
              )}
              
              {showShortcuts && item.shortcut && (
                <kbd className="ml-auto text-xs text-gray-400">
                  {item.shortcut}
                </kbd>
              )}
              
              {hasChildren && mode !== 'inline' && (
                <ChevronRightIcon
                  className={cn(
                    'ml-auto h-4 w-4 transition-transform',
                    isOpen && 'rotate-90'
                  )}
                />
              )}
            </>
          )}
        </>
      )
      
      const baseItemClasses = cn(
        'flex items-center rounded-md transition-colors cursor-pointer select-none',
        mode === 'horizontal' ? 'px-3 py-2' : 'px-2 py-2 my-0.5',
        !item.disabled && currentTheme.item,
        isSelected && !item.disabled && currentTheme.selectedItem,
        item.disabled && 'opacity-50 cursor-not-allowed',
        isFocused && 'ring-2 ring-green-500 ring-inset',
        itemClassName
      )
      
      return (
        <li key={item.key}>
          {renderItem ? (
            <div
              ref={ref => {
                if (ref) itemRefs.current.set(item.key, ref)
              }}
              tabIndex={item.disabled ? -1 : 0}
              onClick={() => handleItemClick(item)}
              onKeyDown={(e) => handleKeyDown(e, visibleIndex)}
              onFocus={() => setFocusedIndex(visibleIndex)}
              onMouseEnter={() => triggerOnHover && hasChildren && toggleSubmenu(item.key)}
              className={baseItemClasses}
            >
              {renderItem(item, isFocused)}
            </div>
          ) : (
            <div
              ref={ref => {
                if (ref) itemRefs.current.set(item.key, ref)
              }}
              tabIndex={item.disabled ? -1 : 0}
              role="menuitem"
              aria-disabled={item.disabled}
              aria-expanded={hasChildren ? isOpen : undefined}
              onClick={() => handleItemClick(item)}
              onKeyDown={(e) => handleKeyDown(e, visibleIndex)}
              onFocus={() => setFocusedIndex(visibleIndex)}
              onMouseEnter={() => triggerOnHover && hasChildren && toggleSubmenu(item.key)}
              className={baseItemClasses}
            >
              {itemContent}
            </div>
          )}
          
          {/* Nested menu */}
          {hasChildren && (mode === 'inline' || isOpen) && (
            <ul
              className={cn(
                mode === 'inline' && 'ml-4 mt-1',
                mode !== 'inline' && 'ml-8'
              )}
            >
              <Menu
                items={item.children || []}
                selectedKey={selectedKey}
                onSelect={onSelect}
                mode={mode}
                theme={theme}
                collapsed={collapsed}
                openKeys={openKeys}
                onOpenChange={onOpenChange}
                showIcons={showIcons}
                showShortcuts={showShortcuts}
                itemClassName={itemClassName}
                renderItem={renderItem}
                level={level + 1}
              />
            </ul>
          )}
        </li>
      )
    })
  }
  
  return (
    <ul
      className={cn(
        'list-none',
        mode === 'horizontal' && 'flex items-center gap-1',
        level === 0 && currentTheme.base,
        level === 0 && mode !== 'horizontal' && 'p-2',
        className
      )}
      role="menu"
    >
      {renderMenuItems()}
    </ul>
  )
}

/**
 * ContextMenu - Right-click context menu
 */
export function ContextMenu({
  children,
  items,
  onSelect,
}: {
  children: ReactNode
  items: MenuItem[]
  onSelect?: (key: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)
  
  // Handle context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setPosition({ x: e.clientX, y: e.clientY })
    setIsOpen(true)
  }
  
  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    
    if (isOpen) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [isOpen])
  
  return (
    <>
      <div onContextMenu={handleContextMenu}>
        {children}
      </div>
      
      {isOpen && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[200px] rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5"
          style={{
            left: position.x,
            top: position.y,
          }}
        >
          <Menu
            items={items}
            onSelect={(key) => {
              onSelect?.(key)
              setIsOpen(false)
            }}
            className="p-1"
          />
        </div>
      )}
    </>
  )
}