'use client'

import { cn } from '@/lib/utils'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
} from '@heroicons/react/20/solid'

export interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
  onPageChange: (page: number) => void
  onItemsPerPageChange?: (itemsPerPage: number) => void
  itemsPerPageOptions?: number[]
  showItemsPerPage?: boolean
  showPageJumper?: boolean
  showFirstLastButtons?: boolean
  showItemCount?: boolean
  maxPagesToShow?: number
  size?: 'sm' | 'md' | 'lg'
  position?: 'start' | 'center' | 'end' | 'between'
  className?: string
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
  const {
    previous = 'Previous',
    next = 'Next',
    first = 'First',
    last = 'Last',
    page = 'Page',
    of = 'of',
    itemsPerPage: itemsPerPageLabel = 'Items per page',
    jumpToPage = 'Go to page',
    showing = 'Showing',
    to = 'to',
    results = 'results',
  } = labels

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  const sizeClasses = {
    sm: {
      button: 'px-2 py-1 text-xs min-h-[32px]',
      iconButton: 'p-1 min-h-[32px] min-w-[32px]',
      icon: 'h-4 w-4',
      text: 'text-xs',
    },
    md: {
      button: 'px-3 py-2 text-sm min-h-[40px]',
      iconButton: 'p-2 min-h-[40px] min-w-[40px]',
      icon: 'h-5 w-5',
      text: 'text-sm',
    },
    lg: {
      button: 'px-4 py-2.5 text-base min-h-[44px]',
      iconButton: 'p-2.5 min-h-[44px] min-w-[44px]',
      icon: 'h-6 w-6',
      text: 'text-base',
    },
  }

  const positionClasses = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
  }

  const getPageNumbers = (): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = []
    const halfRange = Math.floor(maxPagesToShow / 2)

    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (currentPage > halfRange + 2) pages.push('ellipsis')
      const start = Math.max(2, currentPage - halfRange)
      const end = Math.min(totalPages - 1, currentPage + halfRange)
      for (let i = start; i <= end; i++) pages.push(i)
      if (currentPage < totalPages - halfRange - 1) pages.push('ellipsis')
      if (totalPages > 1) pages.push(totalPages)
    }

    return pages
  }

  const buttonClasses = cn(
    'inline-flex items-center justify-center font-medium rounded-md',
    'border border-gray-300 bg-white text-gray-700',
    'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white',
    'transition-colors',
    sizeClasses[size].button,
  )

  const iconButtonClasses = cn(
    'inline-flex items-center justify-center rounded-md',
    'border border-gray-300 bg-white text-gray-500',
    'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white',
    'transition-colors',
    sizeClasses[size].iconButton,
  )

  const pageButtonClasses = (isActive: boolean) =>
    cn(
      'inline-flex items-center justify-center font-medium',
      'border transition-colors',
      isActive
        ? 'bg-green-50 border-green-500 text-green-600 z-10'
        : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50',
      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
      sizeClasses[size].button,
      'min-w-[40px]',
    )

  /* Mobile view */
  const mobileView = (
    <div className="flex flex-1 justify-between items-center sm:hidden">
      <button
        type="button"
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
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={buttonClasses}
      >
        {next}
        <ChevronRightIcon className={cn(sizeClasses[size].icon, 'ml-1')} />
      </button>
    </div>
  )

  /* Desktop view */
  const desktopView = (
    <div className={cn('hidden sm:flex sm:flex-1 sm:items-center', positionClasses[position])}>
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
            <select
              id="items-per-page"
              value={itemsPerPage}
              onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
              className="rounded-md border-gray-300 text-sm shadow-sm focus:border-green-500 focus:ring-green-500 w-20"
            >
              {itemsPerPageOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

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
                const p = Number(e.target.value)
                if (p >= 1 && p <= totalPages) onPageChange(p)
              }}
              className="rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-sm w-20"
            />
          </div>
        )}

        <nav
          className="isolate inline-flex -space-x-px rounded-md shadow-sm"
          aria-label="Pagination"
        >
          {showFirstLastButtons && (
            <button
              type="button"
              onClick={() => onPageChange(1)}
              disabled={currentPage === 1}
              className={cn(iconButtonClasses, 'rounded-l-md')}
              aria-label={first}
            >
              <ChevronDoubleLeftIcon className={sizeClasses[size].icon} />
            </button>
          )}

          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className={cn(iconButtonClasses, !showFirstLastButtons && 'rounded-l-md')}
            aria-label={previous}
          >
            <ChevronLeftIcon className={sizeClasses[size].icon} />
          </button>

          {getPageNumbers().map((pageNum, index) => {
            if (pageNum === 'ellipsis') {
              return (
                <span
                  key={`ellipsis-${index}`}
                  className={cn(
                    'inline-flex items-center border border-gray-300 bg-white',
                    sizeClasses[size].button,
                    'cursor-default',
                  )}
                >
                  ...
                </span>
              )
            }
            return (
              <button
                type="button"
                key={pageNum}
                onClick={() => onPageChange(pageNum)}
                aria-current={currentPage === pageNum ? 'page' : undefined}
                className={pageButtonClasses(currentPage === pageNum)}
              >
                {pageNum}
              </button>
            )
          })}

          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className={cn(iconButtonClasses, !showFirstLastButtons && 'rounded-r-md')}
            aria-label={next}
          >
            <ChevronRightIcon className={sizeClasses[size].icon} />
          </button>

          {showFirstLastButtons && (
            <button
              type="button"
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
