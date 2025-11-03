'use client'

/**
 * DataTable Component
 * 
 * Used on 42/107 pages (39%)
 * 
 * Responsive data table with mobile card view, sorting, and selection support.
 * Provides consistent table styling and behavior across the application.
 */

import { ReactNode, HTMLAttributes, useState, useEffect, Fragment } from 'react'
import { cn } from '@/lib/utils'
import { ChevronUpIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
import { Checkbox } from '../forms/Checkbox'
import { Skeleton, SkeletonCard } from '../feedback/Skeleton'
import { EmptyState } from './EmptyState'

export interface Column<T = unknown> {
  /**
   * Unique key for the column
   */
  key: string
  
  /**
   * Display header for the column
   */
  header: string | ReactNode
  
  /**
   * Function to render cell content
   */
  cell: (row: T) => ReactNode
  
  /**
   * Whether the column is sortable
   * @default false
   */
  sortable?: boolean
  
  /**
   * Custom sort function
   */
  sortFn?: (a: T, b: T) => number
  
  /**
   * Column width (CSS value)
   */
  width?: string
  
  /**
   * Text alignment
   * @default 'left'
   */
  align?: 'left' | 'center' | 'right'
  
  /**
   * Whether to hide on mobile
   * @default false
   */
  hideOnMobile?: boolean
  
  /**
   * Custom class for the column
   */
  className?: string
}

export interface DataTableProps<T = unknown> extends HTMLAttributes<HTMLDivElement> {
  /**
   * Array of data to display
   */
  data: T[]
  
  /**
   * Column definitions
   */
  columns: Column<T>[]
  
  /**
   * Function to get unique key for each row
   */
  getRowKey: (row: T) => string | number
  
  /**
   * Whether to show loading state
   * @default false
   */
  loading?: boolean
  
  /**
   * Number of skeleton rows to show when loading
   * @default 5
   */
  skeletonRows?: number
  
  /**
   * Empty state message
   */
  emptyMessage?: string
  
  /**
   * Empty state description
   */
  emptyDescription?: string
  
  /**
   * Empty state action
   */
  emptyAction?: ReactNode
 
  /**
   * Whether rows are selectable
   * @default false
   */
  selectable?: boolean
  
  /**
   * Optional class name generator for each row
   */
  rowClassName?: (row: T) => string | undefined
 
  /**
   * Selected row keys (controlled)
   */
  selectedKeys?: Set<string | number>
  
  /**
   * Callback when selection changes
   */
  onSelectionChange?: (keys: Set<string | number>) => void
  
  /**
   * Callback when row is clicked
   */
  onRowClick?: (row: T) => void
  
  /**
   * Whether to make rows clickable
   * @default false
   */
  clickableRows?: boolean
  
  /**
   * Sticky header
   * @default false
   */
  stickyHeader?: boolean
  
  /**
   * Table size
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether to show borders
   * @default true
   */
  bordered?: boolean
  
  /**
   * Whether to show striped rows
   * @default false
   */
  striped?: boolean
  
  /**
   * Mobile breakpoint
   * @default 768
   */
  mobileBreakpoint?: number
  
  /**
   * Custom mobile card renderer
   */
  renderMobileCard?: (row: T) => ReactNode

  /**
   * Whether rows can be expanded to reveal extra content
   */
  expandable?: boolean

  /**
   * Renderer for expanded row content
   */
  renderExpandedContent?: (row: T) => ReactNode

  /**
   * Keys that should be expanded initially
   */
  defaultExpandedKeys?: Array<string | number>
}

export function DataTable<T = unknown>({
  data,
  columns,
  getRowKey,
  loading = false,
  skeletonRows = 5,
  emptyMessage = 'No data found',
  emptyDescription,
  emptyAction,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  onRowClick,
  clickableRows = false,
  stickyHeader = false,
  size = 'md',
  bordered = true,
  striped = false,
  mobileBreakpoint = 768,
  renderMobileCard,
  expandable = false,
  renderExpandedContent,
  defaultExpandedKeys = [],
  rowClassName,
  className,
  ...props
}: DataTableProps<T>) {
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [isMobile, setIsMobile] = useState(false)
  const [internalSelectedKeys, setInternalSelectedKeys] = useState<Set<string | number>>(
    selectedKeys || new Set()
  )
  const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(
    new Set(defaultExpandedKeys)
  )
  
  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < mobileBreakpoint)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [mobileBreakpoint])
  
  // Update internal selection when controlled selection changes
  useEffect(() => {
    if (selectedKeys !== undefined) {
      setInternalSelectedKeys(selectedKeys)
    }
  }, [selectedKeys])

  // Keep expanded keys in sync with row data
  useEffect(() => {
    const availableKeys = new Set(data.map(row => getRowKey(row)))
    setExpandedKeys(prev => {
      const next = new Set<string | number>()
      prev.forEach(key => {
        if (availableKeys.has(key)) {
          next.add(key)
        }
      })
      return next
    })
  }, [data, getRowKey])
  
  // Sort data
  const sortedData = [...data].sort((a, b) => {
    if (!sortColumn) return 0
    
    const column = columns.find(col => col.key === sortColumn)
    if (!column) return 0
    
    if (column.sortFn) {
      return sortDirection === 'asc' ? column.sortFn(a, b) : column.sortFn(b, a)
    }
    
    // Default string/number sorting
    const aValue = (a as any)[column.key]
    const bValue = (b as any)[column.key]
    
    if (aValue === bValue) return 0
    if (aValue == null) return 1
    if (bValue == null) return -1
    
    const result = aValue < bValue ? -1 : 1
    return sortDirection === 'asc' ? result : -result
  })
  
  // Handle sort
  const handleSort = (column: Column<T>) => {
    if (!column.sortable) return
    
    if (sortColumn === column.key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column.key)
      setSortDirection('asc')
    }
  }
  
  // Handle selection
  const handleSelectAll = (checked: boolean) => {
    const newSelection = checked
      ? new Set(data.map(row => getRowKey(row)))
      : new Set<string | number>()
    
    setInternalSelectedKeys(newSelection)
    onSelectionChange?.(newSelection)
  }
  
  const handleSelectRow = (key: string | number, checked: boolean) => {
    const newSelection = new Set(internalSelectedKeys)
    if (checked) {
      newSelection.add(key)
    } else {
      newSelection.delete(key)
    }
    
    setInternalSelectedKeys(newSelection)
    onSelectionChange?.(newSelection)
  }
  
  // Size classes
  const sizeClasses = {
    sm: {
      cell: 'px-4 py-2 text-xs',
      header: 'px-4 py-2 text-xs',
    },
    md: {
      cell: 'px-6 py-3 text-sm',
      header: 'px-6 py-3 text-sm',
    },
    lg: {
      cell: 'px-6 py-4 text-base',
      header: 'px-6 py-4 text-base',
    },
  }

  const toggleExpand = (key: string | number) => {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Loading state
  if (loading) {
    return (
      <div className={cn('w-full', className)} {...props}>
        {isMobile ? (
          <div className="space-y-4">
            {Array.from({ length: skeletonRows }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (
          <div className={cn('overflow-hidden rounded-lg', bordered && 'shadow ring-1 ring-black ring-opacity-5')}>
            <table className="min-w-full divide-y divide-gray-300">
              <thead className="bg-gray-50">
                <tr>
                  {selectable && (
                    <th className={cn('text-left', sizeClasses[size].header)}>
                      <Skeleton className="h-4 w-4" />
                    </th>
                  )}
                  {expandable && renderExpandedContent && (
                    <th className={cn(sizeClasses[size].header)} />
                  )}
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={cn('text-left', sizeClasses[size].header)}
                    >
                      <Skeleton className="h-4 w-24" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {Array.from({ length: skeletonRows }).map((_, i) => (
                  <tr key={i}>
                    {selectable && (
                      <td className={sizeClasses[size].cell}>
                        <Skeleton className="h-4 w-4" />
                      </td>
                    )}
                    {expandable && renderExpandedContent && (
                      <td className={sizeClasses[size].cell}>
                        <Skeleton className="h-4 w-4" />
                      </td>
                    )}
                    {columns.map((column) => (
                      <td key={column.key} className={sizeClasses[size].cell}>
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }
  
  // Empty state
  if (data.length === 0) {
    return (
      <div className={cn('w-full', className)} {...props}>
        <EmptyState
          title={emptyMessage}
          description={emptyDescription}
          action={emptyAction}
        />
      </div>
    )
  }
  
  // Mobile view
  if (isMobile) {
    return (
      <div className={cn('w-full space-y-4', className)} {...props}>
        {sortedData.map((row) => {
          const key = getRowKey(row)
          const isSelected = internalSelectedKeys.has(key)
          const isExpanded = expandedKeys.has(key)
          
          if (renderMobileCard) {
            return (
              <div key={key} onClick={() => onRowClick?.(row)}>
                {renderMobileCard(row)}
              </div>
            )
          }
          
          return (
            <div
              key={key}
              className={cn(
                'bg-white shadow rounded-lg p-4 space-y-3',
                clickableRows && 'cursor-pointer hover:shadow-md transition-shadow',
                isSelected && 'ring-2 ring-green-500'
              )}
              onClick={() => onRowClick?.(row)}
            >
              {selectable && (
                <div className="flex items-center justify-between">
                  <Checkbox
                    checked={isSelected}
                    onChange={(e) => {
                      e.stopPropagation()
                      handleSelectRow(key, e.target.checked)
                    }}
                  />
                  <span className="text-xs text-gray-500">Select</span>
                </div>
              )}
              
              {columns
                .filter(column => !column.hideOnMobile)
                .map((column) => (
                  <div key={column.key} className="flex justify-between items-start">
                    <span className="text-xs font-medium text-gray-500">
                      {column.header}
                    </span>
                    <span className="text-sm text-gray-900 text-right">
                      {column.cell(row)}
                    </span>
                  </div>
                ))}
              
              {expandable && renderExpandedContent && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExpand(key)
                    }}
                    className="inline-flex items-center gap-2 text-sm font-medium text-green-700 hover:text-green-800 focus:outline-none focus:ring-2 focus:ring-green-500"
                    aria-expanded={isExpanded}
                  >
                    <ChevronRightIcon
                      className={cn(
                        'h-4 w-4 transition-transform duration-200',
                        isExpanded && 'rotate-90'
                      )}
                    />
                    {isExpanded ? 'Hide details' : 'View details'}
                  </button>
                  {isExpanded && (
                    <div className="mt-3 border-t border-gray-200 pt-3 text-sm text-gray-700">
                      {renderExpandedContent(row)}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    )
  }
  
  // Desktop view
  return (
    <div className={cn('w-full', className)} {...props}>
      <div className={cn('overflow-hidden rounded-lg', bordered && 'shadow ring-1 ring-black ring-opacity-5')}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-300">
            <thead className={cn('bg-gray-50', stickyHeader && 'sticky top-0 z-10')}>
              <tr>
                {selectable && (
                  <th
                    scope="col"
                    className={cn(
                      'relative',
                      sizeClasses[size].header
                    )}
                  >
                    <Checkbox
                      checked={
                        data.length > 0 &&
                        data.every(row => internalSelectedKeys.has(getRowKey(row)))
                      }
                      indeterminate={
                        internalSelectedKeys.size > 0 &&
                        internalSelectedKeys.size < data.length
                      }
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </th>
                )}

                {expandable && renderExpandedContent && (
                  <th
                    scope="col"
                    className={cn(sizeClasses[size].header, 'w-10')}
                  />
                )}

                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'font-semibold text-gray-900',
                      sizeClasses[size].header,
                      column.align === 'center' && 'text-center',
                      column.align === 'right' && 'text-right',
                      column.sortable && 'cursor-pointer select-none hover:bg-gray-100',
                     column.className
                    )}
                    style={{ width: column.width }}
                    onClick={() => handleSort(column)}
                  >
                    <div className={cn(
                      'flex items-center gap-1',
                      column.align === 'center' && 'justify-center',
                      column.align === 'right' && 'justify-end'
                    )}>
                      {column.header}
                      {column.sortable && (
                        <div className="flex flex-col">
                          <ChevronUpIcon
                            className={cn(
                              'h-3 w-3 -mb-1',
                              sortColumn === column.key && sortDirection === 'asc'
                                ? 'text-gray-900'
                                : 'text-gray-400'
                            )}
                          />
                          <ChevronDownIcon
                            className={cn(
                              'h-3 w-3 -mt-1',
                              sortColumn === column.key && sortDirection === 'desc'
                                ? 'text-gray-900'
                                : 'text-gray-400'
                            )}
                          />
                        </div>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            
            <tbody className={cn(
              'divide-y divide-gray-200 bg-white',
              striped && '[&>tr:nth-child(odd)]:bg-gray-50'
            )}>
              {sortedData.map((row) => {
                const key = getRowKey(row)
                const isSelected = internalSelectedKeys.has(key)
                const isExpanded = expandedKeys.has(key)
                
                const customRowClass = rowClassName?.(row)

                return (
                  <Fragment key={key}>
                    <tr
                      className={cn(
                        clickableRows && 'cursor-pointer hover:bg-gray-50',
                        isSelected && 'bg-green-50',
                        customRowClass
                      )}
                      onClick={() => onRowClick?.(row)}
                    >
                      {selectable && (
                        <td className={cn('relative', sizeClasses[size].cell)}>
                          <Checkbox
                            checked={isSelected}
                            onChange={(e) => {
                              e.stopPropagation()
                              handleSelectRow(key, e.target.checked)
                            }}
                          />
                        </td>
                      )}

                      {expandable && renderExpandedContent && (
                        <td className={cn(sizeClasses[size].cell, 'w-10')}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleExpand(key)
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500"
                            aria-expanded={isExpanded}
                          >
                            <ChevronRightIcon
                              className={cn(
                                'h-4 w-4 transition-transform duration-200',
                                isExpanded && 'rotate-90'
                              )}
                            />
                          </button>
                        </td>
                      )}
                      
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn(
                            'text-gray-900',
                            sizeClasses[size].cell,
                            column.align === 'center' && 'text-center',
                            column.align === 'right' && 'text-right',
                            column.className
                          )}
                        >
                          {column.cell(row)}
                        </td>
                      ))}
                    </tr>
                    {expandable && renderExpandedContent && isExpanded && (
                      <tr className="bg-gray-50">
                        {selectable && <td />}
                        <td
                          colSpan={columns.length + (expandable ? 1 : 0)}
                          className={cn('px-6 py-4 text-sm text-gray-700')}
                        >
                          {renderExpandedContent(row)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

DataTable.displayName = 'DataTable'
