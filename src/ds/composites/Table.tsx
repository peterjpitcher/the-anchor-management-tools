'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { Icon, type IconName } from '@/ds/icons'

/* ------------------------------------------------------------------ */
/*  Table: compound component with styled header, body, rows, cells   */
/*                                                                    */
/*  Needs 'use client' because TableHead (sortable) and               */
/*  TablePagination use event handlers.                               */
/* ------------------------------------------------------------------ */

/* --- Table wrapper --- */

interface TableProps {
  children: React.ReactNode
  className?: string
}

export function Table({ children, className }: TableProps) {
  return (
    <div className={cn('-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', className)}>
      <table className="w-full min-w-[560px] border-collapse sm:min-w-0">
        {children}
      </table>
    </div>
  )
}

/* --- TableHeader --- */

interface TableHeaderProps {
  children: React.ReactNode
  className?: string
}

export function TableHeader({ children, className }: TableHeaderProps) {
  return (
    <thead className={cn('bg-surface-2', className)}>
      {children}
    </thead>
  )
}

/* --- TableBody --- */

interface TableBodyProps {
  children: React.ReactNode
  className?: string
}

export function TableBody({ children, className }: TableBodyProps) {
  return (
    <tbody className={cn('divide-y divide-border', className)}>
      {children}
    </tbody>
  )
}

/* --- TableRow --- */

interface TableRowProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

export function TableRow({ children, className, onClick }: TableRowProps) {
  return (
    <tr
      className={cn(
        'hover:bg-surface-hover transition-colors',
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  )
}

/* --- TableHead (sortable) --- */

export type TableSortDirection = 'asc' | 'desc' | null

export interface TableHeadProps {
  children?: React.ReactNode
  className?: string
  /**
   * Makes the header a sort control: the label renders as a real `<button>` inside the
   * `<th>`, so it is reachable by keyboard, and the `<th>` carries `aria-sort`.
   */
  sortable?: boolean
  /** This column's current sort: `asc`, `desc`, or `null` when the table is sorted by another column. */
  sortDirection?: TableSortDirection
  /** Called when the header button is pressed. The caller decides the next direction. */
  onSort?: () => void
  /** Left-align (default) or right-align */
  align?: 'left' | 'right' | 'center'
}

const ARIA_SORT: Record<'asc' | 'desc' | 'none', 'ascending' | 'descending' | 'none'> = {
  asc: 'ascending',
  desc: 'descending',
  none: 'none',
}

export function TableHead({
  children,
  className,
  sortable = false,
  sortDirection,
  onSort,
  align = 'left',
}: TableHeadProps) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  const sortIcon: IconName | null =
    sortDirection === 'asc' ? 'chevronUp' :
    sortDirection === 'desc' ? 'chevronDown' :
    null

  const sortIndicator = sortIcon ? (
    <Icon name={sortIcon} size={12} />
  ) : (
    <span className="w-3" aria-hidden="true" /> /* Placeholder to prevent layout shift */
  )

  if (sortable) {
    return (
      <th scope="col"
        aria-sort={ARIA_SORT[sortDirection ?? 'none']}
        className={cn(
          'px-4 py-2 text-xs font-medium text-text-muted uppercase tracking-wider select-none',
          alignClass,
          className,
        )}
      >
        {/* The button inherits the header's colour, so a caller's highlight class on the <th>
            still shows. Inset ring: a scrolling table would clip an outer one (Rules: Focus). */}
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1 rounded-sm uppercase tracking-wider',
            'transition-colors hover:text-text',
            'focus-visible:outline-hidden focus-visible:shadow-ring-inset',
          )}
        >
          {children}
          {sortIndicator}
        </button>
      </th>
    )
  }

  return (
    <th scope="col"
      className={cn(
        'px-4 py-2 text-xs font-medium text-text-muted uppercase tracking-wider',
        alignClass,
        className,
      )}
    >
      {children}
    </th>
  )
}

/* --- TableCell --- */

interface TableCellProps {
  children?: React.ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
  colSpan?: number
}

export function TableCell({ children, className, align = 'left', colSpan }: TableCellProps) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  return (
    <td
      colSpan={colSpan}
      className={cn(
        'px-4 py-cell-y text-ui text-text whitespace-nowrap',
        alignClass,
        className,
      )}
    >
      {children}
    </td>
  )
}

/* --- TablePagination --- */

interface TablePaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  pageSize?: number
  totalItems?: number
  className?: string
}

export function TablePagination({
  page,
  totalPages,
  onPageChange,
  pageSize,
  totalItems,
  className,
}: TablePaginationProps) {
  const start = pageSize ? (page - 1) * pageSize + 1 : null
  const end = pageSize && totalItems ? Math.min(page * pageSize, totalItems) : null

  return (
    <div className={cn('flex items-center justify-between px-4 py-3 border-t border-border', className)}>
      {/* Item count */}
      <div className="text-xs text-text-muted">
        {start !== null && end !== null && totalItems !== undefined
          ? `Showing ${start}-${end} of ${totalItems}`
          : `Page ${page} of ${totalPages}`}
      </div>

      {/* Page buttons */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          className="px-2 py-1 text-xs font-medium text-text-muted rounded-default border border-border hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          onClick={() => onPageChange(page - 1)}
        >
          <Icon name="chevronLeft" size={14} />
        </button>

        {/* Render up to 5 page number buttons around the current page */}
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter((p) => {
            if (totalPages <= 5) return true
            if (p === 1 || p === totalPages) return true
            return Math.abs(p - page) <= 1
          })
          .map((p, idx, arr) => {
            // Insert ellipsis if gap
            const prev = arr[idx - 1]
            const needsEllipsis = prev !== undefined && p - prev > 1

            return (
              <React.Fragment key={p}>
                {needsEllipsis && (
                  <span className="px-1 text-xs text-text-subtle">...</span>
                )}
                <button
                  type="button"
                  className={cn(
                    'min-w-[28px] px-2 py-1 text-xs font-medium rounded-default border transition-colors',
                    p === page
                      ? 'bg-primary text-primary-fg border-primary'
                      : 'text-text-muted border-border hover:bg-surface-hover',
                  )}
                  onClick={() => onPageChange(p)}
                >
                  {p}
                </button>
              </React.Fragment>
            )
          })}

        <button
          type="button"
          aria-label="Next page"
          disabled={page >= totalPages}
          className="px-2 py-1 text-xs font-medium text-text-muted rounded-default border border-border hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          onClick={() => onPageChange(page + 1)}
        >
          <Icon name="chevronRight" size={14} />
        </button>
      </div>
    </div>
  )
}
