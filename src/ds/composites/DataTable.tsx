'use client'

import { ReactNode, HTMLAttributes, useState, useEffect, Fragment } from 'react'
import { cn } from '@/lib/utils'
import { ChevronUpIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
import { Checkbox } from '@/ds/primitives/Checkbox'
import { Spinner } from '@/ds/primitives/Spinner'
import { Empty } from '@/ds/primitives/Empty'

const ROW_CLICK_IGNORE_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[data-row-click-ignore="true"]',
].join(',')

function shouldIgnoreRowClick(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest(ROW_CLICK_IGNORE_SELECTOR))
}

export interface Column<T = unknown> {
  key: string
  header: string | ReactNode
  cell: (row: T) => ReactNode
  sortable?: boolean
  sortFn?: (a: T, b: T) => number
  width?: string
  align?: 'left' | 'center' | 'right'
  hideOnMobile?: boolean
  className?: string
}

export interface DataTableProps<T = unknown> extends HTMLAttributes<HTMLDivElement> {
  data: T[]
  columns: Column<T>[]
  getRowKey: (row: T) => string | number
  loading?: boolean
  emptyMessage?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  selectable?: boolean
  rowClassName?: (row: T) => string | undefined
  selectedKeys?: Set<string | number>
  onSelectionChange?: (keys: Set<string | number>) => void
  onRowClick?: (row: T) => void
  clickableRows?: boolean
  stickyHeader?: boolean
  size?: 'sm' | 'md' | 'lg'
  bordered?: boolean
  striped?: boolean
  mobileBreakpoint?: number
  renderMobileCard?: (row: T) => ReactNode
  expandable?: boolean
  renderExpandedContent?: (row: T) => ReactNode
  defaultExpandedKeys?: Array<string | number>
}

export function DataTable<T = unknown>({
  data,
  columns,
  getRowKey,
  loading = false,
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
  mobileBreakpoint = 821,
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
    selectedKeys || new Set(),
  )
  const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(
    new Set(defaultExpandedKeys),
  )

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < mobileBreakpoint)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [mobileBreakpoint])

  useEffect(() => {
    if (selectedKeys !== undefined) setInternalSelectedKeys(selectedKeys)
  }, [selectedKeys])

  useEffect(() => {
    const availableKeys = new Set(data.map((row) => getRowKey(row)))
    setExpandedKeys((prev) => {
      const next = new Set<string | number>()
      prev.forEach((key) => {
        if (availableKeys.has(key)) next.add(key)
      })
      return next
    })
  }, [data, getRowKey])

  // Sort data
  const sortedData = [...data].sort((a, b) => {
    if (!sortColumn) return 0
    const column = columns.find((col) => col.key === sortColumn)
    if (!column) return 0
    if (column.sortFn) {
      return sortDirection === 'asc' ? column.sortFn(a, b) : column.sortFn(b, a)
    }
    const aValue = (a as Record<string, unknown>)[column.key]
    const bValue = (b as Record<string, unknown>)[column.key]
    if (aValue === bValue) return 0
    if (aValue == null) return 1
    if (bValue == null) return -1
    const result = aValue < bValue ? -1 : 1
    return sortDirection === 'asc' ? result : -result
  })

  const handleSort = (column: Column<T>) => {
    if (!column.sortable) return
    if (sortColumn === column.key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column.key)
      setSortDirection('asc')
    }
  }

  const handleSelectAll = (checked: boolean) => {
    const newSelection = checked
      ? new Set(data.map((row) => getRowKey(row)))
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

  const sizeClasses = {
    sm: { cell: 'px-4 py-2 text-xs', header: 'px-4 py-2 text-xs' },
    md: { cell: 'px-6 py-2.5 text-sm', header: 'px-6 py-2.5 text-sm' },
    lg: { cell: 'px-6 py-3 text-base', header: 'px-6 py-3 text-base' },
  }

  const toggleExpand = (key: string | number) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Loading state — minimal centred spinner
  if (loading) {
    const loadingIndicator = (
      <div className="flex items-center justify-center py-12" role="status">
        <Spinner size="lg" />
        <span className="sr-only">Loading…</span>
      </div>
    )

    return (
      <div className={cn('w-full', className)} {...props}>
        {isMobile ? (
          loadingIndicator
        ) : (
          <div className={cn('overflow-hidden rounded-lg', bordered && 'shadow ring-1 ring-black ring-opacity-5')}>
            <table className="min-w-full divide-y divide-gray-300">
              <thead className="bg-gray-50">
                <tr>
                  {selectable && (
                    <th scope="col" className={cn('text-left', sizeClasses[size].header)} />
                  )}
                  {expandable && renderExpandedContent && (
                    <th scope="col" className={cn(sizeClasses[size].header)} />
                  )}
                  {columns.map((column) => (
                    <th
                      scope="col"
                      key={column.key}
                      className={cn(
                        'text-left font-semibold text-gray-900',
                        sizeClasses[size].header,
                        column.align === 'center' && 'text-center',
                        column.align === 'right' && 'text-right',
                        column.className,
                      )}
                      style={{ width: column.width }}
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                <tr>
                  <td
                    colSpan={
                      columns.length +
                      (selectable ? 1 : 0) +
                      (expandable && renderExpandedContent ? 1 : 0)
                    }
                  >
                    {loadingIndicator}
                  </td>
                </tr>
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
        <Empty title={emptyMessage} description={emptyDescription} action={emptyAction} />
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
          const mobileColumns = columns.filter((column) => !column.hideOnMobile)
          const [primaryColumn, ...secondaryColumns] = mobileColumns

          if (renderMobileCard) {
            return (
              <div
                key={key}
                className={cn(clickableRows && 'cursor-pointer', isSelected && 'rounded-lg ring-2 ring-primary')}
                onClick={(event) => {
                  if (!clickableRows || !onRowClick) return
                  if (shouldIgnoreRowClick(event.target)) return
                  onRowClick(row)
                }}
              >
                {renderMobileCard(row)}
              </div>
            )
          }

          return (
            <div
              key={key}
              className={cn(
                'rounded-lg border border-border bg-surface p-4 shadow-sm',
                clickableRows && 'cursor-pointer active:bg-surface-hover',
                isSelected && 'ring-2 ring-primary',
              )}
              onClick={(event) => {
                if (!clickableRows || !onRowClick) return
                if (shouldIgnoreRowClick(event.target)) return
                onRowClick(row)
              }}
            >
              {selectable && (
                <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    label="Select"
                    checked={isSelected}
                    onChange={(checked) => {
                      handleSelectRow(key, checked)
                    }}
                  />
                </div>
              )}

              {primaryColumn && (
                <div className="border-b border-border pb-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    {primaryColumn.header}
                  </div>
                  <div className="mt-1 min-w-0 text-sm font-semibold text-text-strong">
                    {primaryColumn.cell(row)}
                  </div>
                </div>
              )}

              {secondaryColumns.length > 0 && (
                <dl className="mt-3 grid gap-2">
                  {secondaryColumns.map((column) => (
                    <div key={column.key} className="flex items-start justify-between gap-4">
                      <dt className="shrink-0 text-xs font-medium text-text-muted">{column.header}</dt>
                      <dd className="min-w-0 text-right text-sm text-text [&_*]:break-words">
                        {column.cell(row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

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
                        isExpanded && 'rotate-90',
                      )}
                    />
                    {isExpanded ? 'Hide details' : 'View details'}
                  </button>
                  {isExpanded && (
                    <div className="mt-3 border-t border-border pt-3 text-sm text-text">
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
                  <th scope="col" className={cn('relative', sizeClasses[size].header)}>
                    <Checkbox
                      label="Select all"
                      checked={
                        data.length > 0 &&
                        data.every((row) => internalSelectedKeys.has(getRowKey(row)))
                      }
                      onChange={(checked) => handleSelectAll(checked)}
                    />
                  </th>
                )}
                {expandable && renderExpandedContent && (
                  <th scope="col" className={cn(sizeClasses[size].header, 'w-10')} />
                )}
                {columns.map((column) => {
                  const isSorted = sortColumn === column.key
                  const ariaSort = column.sortable
                    ? isSorted
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                    : undefined

                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={ariaSort}
                      className={cn(
                        'font-semibold text-gray-900',
                        sizeClasses[size].header,
                        column.align === 'center' && 'text-center',
                        column.align === 'right' && 'text-right',
                        column.className,
                      )}
                      style={{ width: column.width }}
                    >
                      {column.sortable ? (
                        <button
                          type="button"
                          className={cn(
                            'flex w-full items-center gap-1 select-none rounded-sm hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500',
                            column.align === 'center' && 'justify-center',
                            column.align === 'right' && 'justify-end',
                          )}
                          onClick={() => handleSort(column)}
                        >
                          {column.header}
                          <span className="flex flex-col" aria-hidden="true">
                            <ChevronUpIcon
                              className={cn(
                                'h-3 w-3 -mb-1',
                                isSorted && sortDirection === 'asc'
                                  ? 'text-gray-900'
                                  : 'text-gray-400',
                              )}
                            />
                            <ChevronDownIcon
                              className={cn(
                                'h-3 w-3 -mt-1',
                                isSorted && sortDirection === 'desc'
                                  ? 'text-gray-900'
                                  : 'text-gray-400',
                              )}
                            />
                          </span>
                        </button>
                      ) : (
                        <div
                          className={cn(
                            'flex items-center gap-1',
                            column.align === 'center' && 'justify-center',
                            column.align === 'right' && 'justify-end',
                          )}
                        >
                          {column.header}
                        </div>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody
              className={cn(
                'divide-y divide-gray-200 bg-white',
                striped && '[&>tr:nth-child(odd)]:bg-gray-50',
              )}
            >
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
                        customRowClass,
                      )}
                      onClick={(event) => {
                        if (!clickableRows || !onRowClick) return
                        if (shouldIgnoreRowClick(event.target)) return
                        onRowClick(row)
                      }}
                    >
                      {selectable && (
                        <td className={cn('relative', sizeClasses[size].cell)} onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            label="Select"
                            checked={isSelected}
                            onChange={(checked) => {
                              handleSelectRow(key, checked)
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
                                isExpanded && 'rotate-90',
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
                            column.className,
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
                          className="px-6 py-4 text-sm text-gray-700"
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
