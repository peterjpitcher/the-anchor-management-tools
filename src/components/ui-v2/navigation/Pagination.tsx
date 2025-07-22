/**
 * Pagination Component
 * 
 * Used on 42/107 pages (39%)
 * 
 * Enhanced pagination with improved mobile experience, accessibility, and flexibility.
 * Replaces the existing pagination component with better patterns.
 */

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ChevronLeftIcon, ChevronRightIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon } from '@heroicons/react/20/solid'
import { Select } from '../forms/Select'

export interface PaginationProps {
  /**
   * Current page number (1-indexed)
   */
  currentPage: number
  
  /**
   * Total number of pages
   */
  totalPages: number
  
  /**
   * Total number of items
   */
  totalItems: number
  
  /**
   * Number of items per page
   */
  itemsPerPage: number
  
  /**
   * Callback when page changes
   */
  onPageChange: (page: number) => void
  
  /**
   * Callback when items per page changes
   */
  onItemsPerPageChange?: (itemsPerPage: number) => void
  
  /**
   * Options for items per page selector
   * @default [10, 20, 50, 100]
   */
  itemsPerPageOptions?: number[]
  
  /**
   * Whether to show items per page selector
   * @default false
   */
  showItemsPerPage?: boolean
  
  /**
   * Whether to show page jumper input
   * @default false
   */
  showPageJumper?: boolean
  
  /**
   * Whether to show first/last page buttons
   * @default false
   */
  showFirstLastButtons?: boolean
  
  /**
   * Whether to show item count
   * @default true
   */
  showItemCount?: boolean
  
  /**
   * Maximum pages to show before ellipsis
   * @default 7
   */
  maxPagesToShow?: number
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Position variant
   * @default 'between'
   */
  position?: 'start' | 'center' | 'end' | 'between'
  
  /**
   * Additional CSS classes
   */
  className?: string
  
  /**
   * Custom labels
   */
  labels?: {
    previous?: string
    next?: string
    first?: string
    last?: string
    page?: string
    of?: string
    items?: string
    itemsPerPage?: string
    jumpToPage?: string
    showing?: string
    to?: string
    results?: string
  }
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  itemsPerPageOptions = [10, 20, 50, 100],
  showItemsPerPage = false,
  showPageJumper = false,
  showFirstLastButtons = false,
  showItemCount = true,
  maxPagesToShow = 7,
  size = 'md',
  position = 'between',
  className,
  labels = {},
}: PaginationProps) {
  // Default labels
  const {
    previous = 'Previous',
    next = 'Next',
    first = 'First',
    last = 'Last',
    page = 'Page',
    of = 'of',
    items = 'items',
    itemsPerPage: itemsPerPageLabel = 'Items per page',
    jumpToPage = 'Go to page',
    showing = 'Showing',
    to = 'to',
    results = 'results',
  } = labels
  
  // Calculate displayed items range
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)
  
  // Size classes
  const sizeClasses = {
    sm: {
      button: 'px-2 py-1 text-xs min-h-[32px]',
      iconButton: 'p-1 min-h-[32px] min-w-[32px]',
      icon: 'h-4 w-4',
      text: 'text-xs',
      select: 'text-xs',
      input: 'text-xs px-2 py-1',
    },
    md: {
      button: 'px-3 py-2 text-sm min-h-[40px]',
      iconButton: 'p-2 min-h-[40px] min-w-[40px]',
      icon: 'h-5 w-5',
      text: 'text-sm',
      select: 'text-sm',
      input: 'text-sm px-3 py-2',
    },
    lg: {
      button: 'px-4 py-2.5 text-base min-h-[44px]',
      iconButton: 'p-2.5 min-h-[44px] min-w-[44px]',
      icon: 'h-6 w-6',
      text: 'text-base',
      select: 'text-base',
      input: 'text-base px-4 py-2.5',
    },
  }
  
  // Position classes
  const positionClasses = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
  }
  
  // Generate page numbers to display
  const getPageNumbers = (): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = []
    const halfRange = Math.floor(maxPagesToShow / 2)
    
    if (totalPages <= maxPagesToShow) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // Always show first page
      pages.push(1)
      
      if (currentPage > halfRange + 2) {
        pages.push('ellipsis')
      }
      
      // Calculate start and end of page range around current page
      const start = Math.max(2, currentPage - halfRange)
      const end = Math.min(totalPages - 1, currentPage + halfRange)
      
      for (let i = start; i <= end; i++) {
        pages.push(i)
      }
      
      if (currentPage < totalPages - halfRange - 1) {
        pages.push('ellipsis')
      }
      
      // Always show last page
      if (totalPages > 1) {
        pages.push(totalPages)
      }
    }
    
    return pages
  }
  
  // Button classes
  const buttonClasses = cn(
    'inline-flex items-center justify-center font-medium rounded-md',
    'border border-gray-300 bg-white text-gray-700',
    'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white',
    'transition-colors',
    sizeClasses[size].button
  )
  
  const iconButtonClasses = cn(
    'inline-flex items-center justify-center rounded-md',
    'border border-gray-300 bg-white text-gray-500',
    'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white',
    'transition-colors',
    sizeClasses[size].iconButton
  )
  
  const pageButtonClasses = (isActive: boolean) => cn(
    'inline-flex items-center justify-center font-medium',
    'border transition-colors',
    isActive
      ? 'bg-green-50 border-green-500 text-green-600 z-10'
      : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50',
    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
    sizeClasses[size].button,
    'min-w-[40px]'
  )
  
  // Mobile view
  const mobileView = (
    <div className="flex flex-1 justify-between items-center sm:hidden">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={buttonClasses}
      >
        <ChevronLeftIcon className={cn(sizeClasses[size].icon, 'mr-1')} />
        {previous}
      </button>
      
      <span className={cn(sizeClasses[size].text, 'text-gray-700')}>
        {page} {currentPage} {of} {totalPages}
      </span>
      
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={buttonClasses}
      >
        {next}
        <ChevronRightIcon className={cn(sizeClasses[size].icon, 'ml-1')} />
      </button>
    </div>
  )
  
  // Desktop view
  const desktopView = (
    <div className={cn('hidden sm:flex sm:flex-1 sm:items-center', positionClasses[position])}>
      {/* Left side - Item count and items per page */}
      <div className="flex items-center gap-4">
        {showItemCount && totalItems > 0 && (
          <p className={cn(sizeClasses[size].text, 'text-gray-700')}>
            {showing} <span className="font-medium">{startItem}</span> {to}{' '}
            <span className="font-medium">{endItem}</span> {of}{' '}
            <span className="font-medium">{totalItems}</span> {results}
          </p>
        )}
        
        {showItemsPerPage && onItemsPerPageChange && (
          <div className="flex items-center gap-2">
            <label htmlFor="items-per-page" className={cn(sizeClasses[size].text, 'text-gray-700')}>
              {itemsPerPageLabel}:
            </label>
            <Select
              id="items-per-page"
              value={itemsPerPage}
              onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
              selectSize={size}
              className="w-20"
            >
              {itemsPerPageOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      
      {/* Right side - Page navigation */}
      <div className="flex items-center gap-2">
        {showPageJumper && (
          <div className="flex items-center gap-2 mr-4">
            <label htmlFor="page-jumper" className={cn(sizeClasses[size].text, 'text-gray-700')}>
              {jumpToPage}:
            </label>
            <input
              id="page-jumper"
              type="number"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const page = Number(e.target.value)
                if (page >= 1 && page <= totalPages) {
                  onPageChange(page)
                }
              }}
              className={cn(
                'rounded-md border-gray-300 shadow-sm',
                'focus:border-green-500 focus:ring-green-500',
                sizeClasses[size].input,
                'w-20'
              )}
            />
          </div>
        )}
        
        <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
          {/* First page button */}
          {showFirstLastButtons && (
            <button
              onClick={() => onPageChange(1)}
              disabled={currentPage === 1}
              className={cn(iconButtonClasses, 'rounded-l-md')}
              aria-label={first}
            >
              <ChevronDoubleLeftIcon className={sizeClasses[size].icon} />
            </button>
          )}
          
          {/* Previous page button */}
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className={cn(
              iconButtonClasses,
              !showFirstLastButtons && 'rounded-l-md'
            )}
            aria-label={previous}
          >
            <ChevronLeftIcon className={sizeClasses[size].icon} />
          </button>
          
          {/* Page numbers */}
          {getPageNumbers().map((pageNum, index) => {
            if (pageNum === 'ellipsis') {
              return (
                <span
                  key={`ellipsis-${index}`}
                  className={cn(
                    'inline-flex items-center border border-gray-300 bg-white',
                    sizeClasses[size].button,
                    'cursor-default'
                  )}
                >
                  ...
                </span>
              )
            }
            
            return (
              <button
                key={pageNum}
                onClick={() => onPageChange(pageNum)}
                aria-current={currentPage === pageNum ? 'page' : undefined}
                className={pageButtonClasses(currentPage === pageNum)}
              >
                {pageNum}
              </button>
            )
          })}
          
          {/* Next page button */}
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className={cn(
              iconButtonClasses,
              !showFirstLastButtons && 'rounded-r-md'
            )}
            aria-label={next}
          >
            <ChevronRightIcon className={sizeClasses[size].icon} />
          </button>
          
          {/* Last page button */}
          {showFirstLastButtons && (
            <button
              onClick={() => onPageChange(totalPages)}
              disabled={currentPage === totalPages}
              className={cn(iconButtonClasses, 'rounded-r-md')}
              aria-label={last}
            >
              <ChevronDoubleRightIcon className={sizeClasses[size].icon} />
            </button>
          )}
        </nav>
      </div>
    </div>
  )
  
  return (
    <div className={cn('bg-white px-4 py-3 border-t border-gray-200 sm:px-6', className)}>
      {mobileView}
      {desktopView}
    </div>
  )
}

/**
 * SimplePagination - Minimal pagination for simple use cases
 */
export function SimplePagination({
  currentPage,
  totalPages,
  onPageChange,
  className,
}: {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="p-2 rounded-md border border-gray-300 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      
      <span className="text-sm text-gray-700">
        Page {currentPage} of {totalPages}
      </span>
      
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="p-2 rounded-md border border-gray-300 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ChevronRightIcon className="h-5 w-5" />
      </button>
    </div>
  )
}

/**
 * LoadMorePagination - Infinite scroll style pagination
 */
export function LoadMorePagination({
  hasMore,
  loading,
  onLoadMore,
  className,
  label = 'Load more',
}: {
  hasMore: boolean
  loading?: boolean
  onLoadMore: () => void
  className?: string
  label?: string
}) {
  if (!hasMore) return null
  
  return (
    <div className={cn('flex justify-center', className)}>
      <button
        onClick={onLoadMore}
        disabled={loading}
        className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading...
          </>
        ) : (
          label
        )}
      </button>
    </div>
  )
}