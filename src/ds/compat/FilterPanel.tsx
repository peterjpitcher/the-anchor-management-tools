'use client'

/**
 * FilterPanel / FilterDefinition — backward-compatible wrapper
 * @deprecated Build custom filter UI with ds/ primitives instead
 */

import { ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '../primitives/Button'
import { Input } from '../primitives/Input'
import { Select } from '../primitives/Select'
import { Badge } from '../primitives/Badge'

export interface FilterDefinition {
  id: string
  label: string
  type: 'text' | 'select' | 'multiselect' | 'date' | 'daterange' | 'number' | 'boolean'
  options?: Array<{ value: string; label: string }>
  placeholder?: string
  icon?: ReactNode
  pinned?: boolean
   
  render?: (value: any, onChange: (value: any) => void) => ReactNode
}

interface FilterValue {
   
  [key: string]: any
}

export interface FilterPanelProps {
  filters: FilterDefinition[]
  values: FilterValue
  onChange: (values: FilterValue) => void
  onClear?: () => void
  /** @deprecated Accepted for backward compatibility */
  onReset?: () => void
  showActiveCount?: boolean
  /** @deprecated Accepted for backward compatibility */
  showSearch?: boolean
  /** @deprecated Accepted for backward compatibility */
  searchValue?: string
  /** @deprecated Accepted for backward compatibility */
  onSearchChange?: (query: string) => void
  /** @deprecated Accepted for backward compatibility */
  searchPlaceholder?: string
  /** @deprecated Accepted for backward compatibility */
  layout?: string
  collapsible?: boolean
  defaultCollapsed?: boolean
  className?: string
}

export function FilterPanel({
  filters,
  values,
  onChange,
  onClear,
  onReset,
  showActiveCount = true,
  showSearch: _showSearch,
  searchValue: _searchValue,
  onSearchChange: _onSearchChange,
  searchPlaceholder: _searchPlaceholder,
  layout: _layout,
  collapsible = false,
  defaultCollapsed = false,
  className,
}: FilterPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

  const activeCount = Object.values(values).filter(
    (v) => v !== undefined && v !== null && v !== '',
  ).length

  const handleFilterChange = (id: string, value: unknown) => {
    onChange({ ...values, [id]: value })
  }

  const handleClear = () => {
    if (onClear) {
      onClear()
    } else if (onReset) {
      onReset()
    } else {
      onChange({})
    }
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={collapsible ? () => setIsCollapsed(!isCollapsed) : undefined}
            className="flex items-center gap-2 text-sm font-medium text-gray-700"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
          </button>
          {showActiveCount && activeCount > 0 && (
            <Badge tone="info">{activeCount}</Badge>
          )}
        </div>
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            Clear all
          </Button>
        )}
      </div>

      {(!collapsible || !isCollapsed) && (
        <div className="flex flex-wrap gap-3">
          {filters.map((filter) => {
            if (filter.render) {
              return (
                <div key={filter.id}>
                  {filter.render(values[filter.id], (val) => handleFilterChange(filter.id, val))}
                </div>
              )
            }

            if (filter.type === 'select' && filter.options) {
              return (
                <Select
                  key={filter.id}
                  value={values[filter.id] ?? ''}
                  onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                  options={[
                    { value: '', label: filter.placeholder || `All ${filter.label}` },
                    ...filter.options,
                  ]}
                  className="w-48"
                />
              )
            }

            return (
              <Input
                key={filter.id}
                type={filter.type === 'number' ? 'number' : 'text'}
                value={values[filter.id] ?? ''}
                onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                placeholder={filter.placeholder || filter.label}
                className="w-48"
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
