'use client'

/**
 * CommandPalette Component
 * 
 * Global command interface for quick navigation and actions.
 * Supports search, keyboard navigation, and nested commands.
 */

import { useState, useEffect, useRef, useMemo, ReactNode, Fragment } from 'react'
import { Combobox, Dialog, Transition } from '@headlessui/react'
import { cn } from '@/lib/utils'
import { 
  MagnifyingGlassIcon,
  ChevronRightIcon,
  HomeIcon,
  DocumentIcon,
  FolderIcon,
  UserIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  ArrowRightIcon,
  ClockIcon,
  StarIcon
} from '@heroicons/react/20/solid'
import { useDebounce } from '../hooks/useDebounce'

export interface CommandItem {
  id: string
  title: string
  subtitle?: string
  icon?: ReactNode
  shortcut?: string
  action?: () => void | Promise<void>
  href?: string
  children?: CommandItem[]
  keywords?: string[]
  category?: string
  recent?: boolean
  favorite?: boolean
  disabled?: boolean
}

export interface CommandPaletteProps {
  /**
   * Whether the command palette is open
   */
  open: boolean
  
  /**
   * Callback when palette should close
   */
  onClose: () => void
  
  /**
   * Available commands
   */
  commands: CommandItem[]
  
  /**
   * Placeholder text
   * @default 'Search commands...'
   */
  placeholder?: string
  
  /**
   * Whether to show recent commands
   * @default true
   */
  showRecent?: boolean
  
  /**
   * Recent command IDs
   */
  recentCommands?: string[]
  
  /**
   * Callback when a recent command is selected
   */
  onRecentSelect?: (commandId: string) => void
  
  /**
   * Whether to show categories
   * @default true
   */
  showCategories?: boolean
  
  /**
   * Custom empty state
   */
  emptyState?: ReactNode
  
  /**
   * Loading state
   * @default false
   */
  loading?: boolean
  
  /**
   * Custom footer
   */
  footer?: ReactNode
  
  /**
   * Maximum height
   * @default '400px'
   */
  maxHeight?: string
  
  /**
   * Custom filter function
   */
  filterFunction?: (commands: CommandItem[], query: string) => CommandItem[]
  
  /**
   * Whether to close on select
   * @default true
   */
  closeOnSelect?: boolean
}

export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = 'Search commands...',
  showRecent = true,
  recentCommands = [],
  onRecentSelect,
  showCategories = true,
  emptyState,
  loading = false,
  footer,
  maxHeight = '400px',
  filterFunction,
  closeOnSelect = true,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedCommand, setSelectedCommand] = useState<CommandItem | null>(null)
  const [navigationStack, setNavigationStack] = useState<CommandItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  
  const debouncedQuery = useDebounce(query, 150)
  
  // Get current commands based on navigation
  const currentCommands = navigationStack.length > 0
    ? navigationStack[navigationStack.length - 1].children || []
    : commands
  
  // Default filter function
  const defaultFilter = (items: CommandItem[], searchQuery: string) => {
    const lowerQuery = searchQuery.toLowerCase()
    
    return items.filter(item => {
      // Check title
      if (item.title.toLowerCase().includes(lowerQuery)) return true
      
      // Check subtitle
      if (item.subtitle?.toLowerCase().includes(lowerQuery)) return true
      
      // Check keywords
      if (item.keywords?.some(keyword => keyword.toLowerCase().includes(lowerQuery))) return true
      
      // Check category
      if (item.category?.toLowerCase().includes(lowerQuery)) return true
      
      return false
    })
  }
  
  // Filter commands
  const filteredCommands = useMemo(() => {
    if (!debouncedQuery && showRecent && recentCommands.length > 0) {
      // Show recent commands
      const recentItems = recentCommands
        .map(id => commands.find(cmd => cmd.id === id))
        .filter(Boolean) as CommandItem[]
      
      return recentItems.map(cmd => ({ ...cmd, recent: true }))
    }
    
    const filterFn = filterFunction || defaultFilter
    return filterFn(currentCommands, debouncedQuery)
  }, [currentCommands, debouncedQuery, recentCommands, showRecent, commands, filterFunction])
  
  // Group commands by category
  const groupedCommands = useMemo(() => {
    if (!showCategories) return { '': filteredCommands }
    
    return filteredCommands.reduce((acc, command) => {
      const category = command.category || 'Other'
      if (!acc[category]) acc[category] = []
      acc[category].push(command)
      return acc
    }, {} as Record<string, CommandItem[]>)
  }, [filteredCommands, showCategories])
  
  // Handle command selection
  const handleSelect = async (command: CommandItem) => {
    if (command.disabled) return
    
    // Update recent commands
    if (onRecentSelect && !navigationStack.length) {
      onRecentSelect(command.id)
    }
    
    // Handle nested commands
    if (command.children && command.children.length > 0) {
      setNavigationStack([...navigationStack, command])
      setQuery('')
      return
    }
    
    // Execute action
    if (command.action) {
      await command.action()
    }
    
    // Navigate to href
    if (command.href) {
      window.location.href = command.href
    }
    
    // Close palette
    if (closeOnSelect) {
      handleClose()
    }
  }
  
  // Handle close
  const handleClose = () => {
    setQuery('')
    setNavigationStack([])
    setSelectedCommand(null)
    onClose()
  }
  
  // Handle back navigation
  const handleBack = () => {
    setNavigationStack(navigationStack.slice(0, -1))
    setQuery('')
  }
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return
      
      // Back navigation
      if (e.key === 'Backspace' && !query && navigationStack.length > 0) {
        e.preventDefault()
        handleBack()
      }
      
      // Close on Escape
      if (e.key === 'Escape') {
        if (navigationStack.length > 0) {
          handleBack()
        } else {
          handleClose()
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, query, navigationStack])
  
  // Focus input when opened
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])
  
  return (
    <Transition.Root show={open} as={Fragment} afterLeave={handleClose}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={handleClose}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-25 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto p-4 sm:p-6 md:p-20">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="mx-auto max-w-2xl transform overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black ring-opacity-5 transition-all">
              <Combobox value={selectedCommand} onChange={handleSelect}>
                <div className="relative">
                  {/* Search input */}
                  <div className="relative">
                    <MagnifyingGlassIcon
                      className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-gray-400"
                      aria-hidden="true"
                    />
                    <Combobox.Input
                      ref={inputRef}
                      className="h-12 w-full border-0 bg-transparent pl-11 pr-4 text-gray-900 placeholder-gray-400 focus:ring-0 sm:text-sm"
                      placeholder={placeholder}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {navigationStack.length > 0 && (
                      <button
                        type="button"
                        onClick={handleBack}
                        className="absolute right-4 top-3.5 text-gray-400 hover:text-gray-600"
                      >
                        Back
                      </button>
                    )}
                  </div>
                  
                  {/* Breadcrumb */}
                  {navigationStack.length > 0 && (
                    <div className="flex items-center gap-1 px-4 pb-2 text-xs text-gray-500">
                      <span>Commands</span>
                      {navigationStack.map((item, index) => (
                        <Fragment key={item.id}>
                          <ChevronRightIcon className="h-3 w-3" />
                          <span>{item.title}</span>
                        </Fragment>
                      ))}
                    </div>
                  )}
                  
                  {/* Results */}
                  {loading ? (
                    <div className="px-4 py-14 text-center sm:px-14">
                      <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-green-600" />
                      <p className="mt-4 text-sm text-gray-900">Loading...</p>
                    </div>
                  ) : filteredCommands.length === 0 && query !== '' ? (
                    <div className="px-4 py-14 text-center sm:px-14">
                      {emptyState || (
                        <>
                          <MagnifyingGlassIcon className="mx-auto h-6 w-6 text-gray-400" />
                          <p className="mt-4 text-sm text-gray-900">
                            No results found for "{query}"
                          </p>
                        </>
                      )}
                    </div>
                  ) : (
                    <Combobox.Options
                      static
                      className="max-h-80 scroll-py-2 divide-y divide-gray-100 overflow-y-auto"
                      style={{ maxHeight }}
                    >
                      {Object.entries(groupedCommands).map(([category, items]) => (
                        <li key={category}>
                          {category && (
                            <h2 className="bg-gray-50 px-4 py-2 text-xs font-medium text-gray-900">
                              {category}
                            </h2>
                          )}
                          <ul className="text-sm text-gray-700">
                            {items.map((command) => (
                              <Combobox.Option
                                key={command.id}
                                value={command}
                                className={({ active }) =>
                                  cn(
                                    'flex cursor-pointer select-none items-center px-4 py-2',
                                    active && 'bg-green-50 text-green-900',
                                    command.disabled && 'opacity-50 cursor-not-allowed'
                                  )
                                }
                                disabled={command.disabled}
                              >
                                {({ active }) => (
                                  <>
                                    {command.icon && (
                                      <div className={cn(
                                        'mr-3 flex h-6 w-6 flex-shrink-0 items-center justify-center',
                                        active ? 'text-green-600' : 'text-gray-400'
                                      )}>
                                        {command.icon}
                                      </div>
                                    )}
                                    <div className="flex-1">
                                      <div className="flex items-center">
                                        <span className={cn(
                                          'font-medium',
                                          command.recent && 'flex items-center gap-1'
                                        )}>
                                          {command.recent && (
                                            <ClockIcon className="h-3 w-3 text-gray-400" />
                                          )}
                                          {command.favorite && (
                                            <StarIcon className="h-3 w-3 text-yellow-400" />
                                          )}
                                          {command.title}
                                        </span>
                                        {command.children && (
                                          <ChevronRightIcon className="ml-1 h-4 w-4 text-gray-400" />
                                        )}
                                      </div>
                                      {command.subtitle && (
                                        <span className="text-xs text-gray-500">
                                          {command.subtitle}
                                        </span>
                                      )}
                                    </div>
                                    {command.shortcut && (
                                      <kbd className={cn(
                                        'ml-3 flex h-5 items-center gap-1 rounded border px-1.5 text-xs',
                                        active
                                          ? 'border-green-600 text-green-600'
                                          : 'border-gray-300 text-gray-500'
                                      )}>
                                        {command.shortcut}
                                      </kbd>
                                    )}
                                  </>
                                )}
                              </Combobox.Option>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </Combobox.Options>
                  )}
                  
                  {/* Footer */}
                  {footer && (
                    <div className="border-t border-gray-100 px-4 py-2">
                      {footer}
                    </div>
                  )}
                </div>
              </Combobox>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition.Root>
  )
}

/**
 * useCommandPalette - Hook for managing command palette state
 */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false)
  const [recentCommands, setRecentCommands] = useState<string[]>([])
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(true)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  
  const handleRecentSelect = (commandId: string) => {
    setRecentCommands(prev => {
      const filtered = prev.filter(id => id !== commandId)
      return [commandId, ...filtered].slice(0, 5)
    })
  }
  
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen(prev => !prev),
    recentCommands,
    handleRecentSelect,
  }
}

/**
 * CommandPaletteFooter - Common footer with keyboard shortcuts
 */
export function CommandPaletteFooter() {
  return (
    <div className="flex items-center justify-between text-xs text-gray-500">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-gray-300 px-1">↑↓</kbd>
          Navigate
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-gray-300 px-1">↵</kbd>
          Select
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-gray-300 px-1">esc</kbd>
          Close
        </span>
      </div>
      <span className="flex items-center gap-1">
        Press
        <kbd className="rounded border border-gray-300 px-1">⌘K</kbd>
        to open
      </span>
    </div>
  )
}