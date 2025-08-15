'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: string
  render: (item: T) => ReactNode
  className?: string
  hideOnMobile?: boolean
  mobileLabel?: string // Alternative label for mobile view
}

interface ResponsiveTableProps<T> {
  data: T[]
  columns: Column<T>[]
  keyExtractor: (item: T, index: number) => string
  className?: string
  emptyMessage?: string
  loading?: boolean
  mobileCardClassName?: string
}

/**
 * ResponsiveTable Component
 * 
 * Displays data as a table on desktop and as cards on mobile
 * Automatically switches between views based on viewport size
 */
export function ResponsiveTable<T>({
  data,
  columns,
  keyExtractor,
  className,
  emptyMessage = 'No data available',
  loading = false,
  mobileCardClassName,
}: ResponsiveTableProps<T>) {
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        {emptyMessage}
      </div>
    )
  }

  // Filter columns for mobile view (exclude hideOnMobile columns)
  const mobileColumns = columns.filter(col => !col.hideOnMobile)

  return (
    <>
      {/* Mobile Card View */}
      <div className="sm:hidden space-y-3">
        {data.map((item, index) => (
          <div
            key={keyExtractor(item, index)}
            className={cn(
              "bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-3",
              mobileCardClassName
            )}
          >
            {mobileColumns.map((column) => (
              <div key={column.key} className="flex justify-between items-start">
                <span className="text-sm font-medium text-gray-500 mr-2">
                  {column.mobileLabel || column.header}:
                </span>
                <span className="text-sm text-gray-900 text-right flex-1">
                  {column.render(item)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden sm:block overflow-x-auto">
        <table className={cn("min-w-full divide-y divide-gray-200", className)}>
          <thead className="bg-gray-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider",
                    column.className
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((item, index) => (
              <tr key={keyExtractor(item, index)} className="hover:bg-gray-50">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-6 py-4 whitespace-nowrap text-sm",
                      column.className
                    )}
                  >
                    {column.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/**
 * ResponsiveTableCard Component
 * 
 * Alternative card-based layout for complex data
 * Useful when table has many columns or complex content
 */
export function ResponsiveTableCard<T>({
  item,
  columns,
  className,
}: {
  item: T
  columns: Column<T>[]
  className?: string
}) {
  const mobileColumns = columns.filter(col => !col.hideOnMobile)
  
  return (
    <div className={cn(
      "bg-white rounded-lg shadow-sm border border-gray-200 p-4",
      className
    )}>
      <div className="space-y-2">
        {mobileColumns.map((column) => (
          <div key={column.key} className="flex flex-col">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              {column.mobileLabel || column.header}
            </span>
            <span className="mt-1 text-sm text-gray-900">
              {column.render(item)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * ResponsiveListItem Component
 * 
 * List-style layout for mobile, more compact than cards
 */
export function ResponsiveListItem<T>({
  item,
  primary,
  secondary,
  tertiary,
  action,
  className,
}: {
  item: T
  primary: (item: T) => ReactNode
  secondary?: (item: T) => ReactNode
  tertiary?: (item: T) => ReactNode
  action?: (item: T) => ReactNode
  className?: string
}) {
  return (
    <div className={cn(
      "flex items-center justify-between p-4 hover:bg-gray-50 border-b border-gray-200 last:border-b-0",
      className
    )}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">
          {primary(item)}
        </div>
        {secondary && (
          <div className="text-sm text-gray-500 truncate">
            {secondary(item)}
          </div>
        )}
        {tertiary && (
          <div className="text-xs text-gray-400 mt-1">
            {tertiary(item)}
          </div>
        )}
      </div>
      {action && (
        <div className="ml-4 flex-shrink-0">
          {action(item)}
        </div>
      )}
    </div>
  )
}