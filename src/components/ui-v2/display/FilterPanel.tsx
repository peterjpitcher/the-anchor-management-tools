'use client'

/**
 * FilterPanel Component
 * 
 * Used on 28/107 pages (26%)
 * 
 * Provides advanced filtering UI for data tables and lists.
 * Supports multiple filter types, saved filters, and mobile-optimized display.
 */

import { ReactNode, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { 
  FunnelIcon, 
  XMarkIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  BookmarkIcon,
  TrashIcon
} from '@heroicons/react/20/solid'
import { Badge } from './Badge'
import { Button } from '../forms/Button'
import { Input } from '../forms/Input'
import { Select } from '../forms/Select'
import { Checkbox } from '../forms/Checkbox'
import { DatePicker, DateRangePicker } from '../forms/DateTimePicker'
import { Popover } from '../overlay/Popover'
import { Drawer, DrawerActions } from '../overlay/Drawer'

export interface FilterDefinition {
  /**
   * Unique identifier for the filter
   */
  id: string
  
  /**
   * Display label
   */
  label: string
  
  /**
   * Type of filter control
   */
  type: 'text' | 'select' | 'multiselect' | 'date' | 'daterange' | 'number' | 'boolean'
  
  /**
   * Options for select/multiselect
   */
  options?: Array<{ value: string; label: string }>
  
  /**
   * Placeholder text
   */
  placeholder?: string
  
  /**
   * Icon to display
   */
  icon?: ReactNode
  
  /**
   * Whether this filter is always visible
   * @default false
   */
  pinned?: boolean
  
  /**
   * Custom render function
   */
  render?: (value: any, onChange: (value: any) => void) => ReactNode
}

export interface FilterValue {
  [key: string]: any
}

export interface SavedFilter {
  id: string
  name: string
  filters: FilterValue
  isDefault?: boolean
}

export interface FilterPanelProps {
  /**
   * Available filter definitions
   */
  filters: FilterDefinition[]
  
  /**
   * Current filter values
   */
  values: FilterValue
  
  /**
   * Callback when filters change
   */
  onChange: (values: FilterValue) => void
  
  /**
   * Saved filter presets
   */
  savedFilters?: SavedFilter[]
  
  /**
   * Callback to save current filters
   */
  onSaveFilter?: (name: string) => void
  
  /**
   * Callback to delete saved filter
   */
  onDeleteSavedFilter?: (id: string) => void
  
  /**
   * Callback to load saved filter
   */
  onLoadSavedFilter?: (filter: SavedFilter) => void
  
  /**
   * Whether to show search field
   * @default true
   */
  showSearch?: boolean
  
  /**
   * Search value
   */
  searchValue?: string
  
  /**
   * Callback when search changes
   */
  onSearchChange?: (value: string) => void
  
  /**
   * Search placeholder
   */
  searchPlaceholder?: string
  
  /**
   * Layout variant
   * @default 'horizontal'
   */
  layout?: 'horizontal' | 'vertical' | 'compact'
  
  /**
   * Whether to show clear all button
   * @default true
   */
  showClearAll?: boolean
  
  /**
   * Whether to show filter count
   * @default true
   */
  showFilterCount?: boolean
  
  /**
   * Maximum filters to show before collapsing
   * @default 3
   */
  maxVisibleFilters?: number
  
  /**
   * Additional class names
   */
  className?: string
  
  /**
   * Whether panel is loading
   * @default false
   */
  loading?: boolean
  
  /**
   * Callback when filters are reset
   */
  onReset?: () => void
}

export function FilterPanel({
  filters,
  values,
  onChange,
  savedFilters = [],
  onSaveFilter,
  onDeleteSavedFilter,
  onLoadSavedFilter,
  showSearch = true,
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Search...',
  layout = 'horizontal',
  showClearAll = true,
  showFilterCount = true,
  maxVisibleFilters = 3,
  className,
  loading = false,
  onReset,
}: FilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [saveFilterName, setSaveFilterName] = useState('')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  
  // Get active filter count
  const activeFilterCount = Object.entries(values).filter(([key, value]) => {
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'string') return value.trim() !== ''
    return value != null
  }).length
  
  // Get pinned and unpinned filters
  const pinnedFilters = filters.filter(f => f.pinned)
  const unpinnedFilters = filters.filter(f => !f.pinned)
  const visibleFilters = isExpanded ? filters : [...pinnedFilters, ...unpinnedFilters.slice(0, maxVisibleFilters - pinnedFilters.length)]
  
  // Handle filter change
  const handleFilterChange = (filterId: string, value: any) => {
    onChange({
      ...values,
      [filterId]: value
    })
  }
  
  // Handle clear all
  const handleClearAll = () => {
    onChange({})
    if (onSearchChange) onSearchChange('')
    if (onReset) onReset()
  }
  
  // Handle save filter
  const handleSaveFilter = () => {
    if (saveFilterName && onSaveFilter) {
      onSaveFilter(saveFilterName)
      setSaveFilterName('')
      setShowSaveDialog(false)
    }
  }
  
  // Render filter control
  const renderFilterControl = (filter: FilterDefinition) => {
    const value = values[filter.id]
    
    if (filter.render) {
      return filter.render(value, (newValue) => handleFilterChange(filter.id, newValue))
    }
    
    switch (filter.type) {
      case 'text':
        return (
          <Input
            value={value || ''}
            onChange={(e) => handleFilterChange(filter.id, e.target.value)}
            placeholder={filter.placeholder || `Filter by ${filter.label.toLowerCase()}`}
            inputSize="sm"
            leftIcon={filter.icon}
          />
        )
        
      case 'select':
        return (
          <Select
            value={value || ''}
            onChange={(e) => handleFilterChange(filter.id, e.target.value)}
            selectSize="sm"
          >
            <option value="">{filter.placeholder || `All ${filter.label}`}</option>
            {filter.options?.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )
        
      case 'multiselect':
        return (
          <div className="space-y-2">
            {filter.options?.map(option => (
              <Checkbox
                key={option.value}
                checked={(value || []).includes(option.value)}
                onChange={(e) => {
                  const currentValues = value || []
                  const newValues = e.target.checked
                    ? [...currentValues, option.value]
                    : currentValues.filter((v: string) => v !== option.value)
                  handleFilterChange(filter.id, newValues)
                }}
                label={option.label}
              />
            ))}
          </div>
        )
        
      case 'date':
        return (
          <DatePicker
            value={value}
            onChange={(date) => handleFilterChange(filter.id, date)}
            placeholder={filter.placeholder || 'Select date'}
          />
        )
        
      case 'daterange':
        return (
          <DateRangePicker
            startDate={value?.start}
            endDate={value?.end}
            onStartDateChange={(date) => handleFilterChange(filter.id, { ...value, start: date })}
            onEndDateChange={(date) => handleFilterChange(filter.id, { ...value, end: date })}
          />
        )
        
      case 'number':
        return (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={value?.min || ''}
              onChange={(e) => handleFilterChange(filter.id, { ...value, min: e.target.value })}
              placeholder="Min"
              inputSize="sm"
            />
            <span className="text-gray-500">-</span>
            <Input
              type="number"
              value={value?.max || ''}
              onChange={(e) => handleFilterChange(filter.id, { ...value, max: e.target.value })}
              placeholder="Max"
              inputSize="sm"
            />
          </div>
        )
        
      case 'boolean':
        return (
          <Checkbox
            checked={value || false}
            onChange={(e) => handleFilterChange(filter.id, e.target.checked)}
            label={filter.label}
          />
        )
        
      default:
        return null
    }
  }
  
  // Render desktop filter
  const renderDesktopFilter = (filter: FilterDefinition) => {
    const value = values[filter.id]
    const hasValue = Array.isArray(value) ? value.length > 0 : value != null && value !== ''
    
    if (layout === 'compact') {
      return (
        <Popover
          key={filter.id}
          trigger={
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border',
                'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500',
                hasValue
                  ? 'border-green-300 bg-green-50 text-green-700'
                  : 'border-gray-300 text-gray-700'
              )}
            >
              {filter.icon && <span className="w-4 h-4">{filter.icon}</span>}
              {filter.label}
              {hasValue && (
                <Badge size="sm" variant="success">
                  {Array.isArray(value) ? value.length : '1'}
                </Badge>
              )}
              <ChevronDownIcon className="w-4 h-4 ml-1" />
            </button>
          }
        >
          <div className="p-4 min-w-[200px]">
            <h4 className="font-medium text-sm mb-3">{filter.label}</h4>
            {renderFilterControl(filter)}
          </div>
        </Popover>
      )
    }
    
    return (
      <div key={filter.id} className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          {filter.label}
        </label>
        {renderFilterControl(filter)}
      </div>
    )
  }
  
  // Render horizontal layout
  const renderHorizontalLayout = () => (
    <div className={cn(
      'bg-white border-b border-gray-200',
      className
    )}>
      <div className="p-4 space-y-4">
        {/* Top row: Search and saved filters */}
        <div className="flex items-center gap-4">
          {showSearch && onSearchChange && (
            <div className="flex-1 max-w-md">
              <Input
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                leftIcon={<MagnifyingGlassIcon />}
                inputSize="sm"
              />
            </div>
          )}
          
          {savedFilters.length > 0 && (
            <Select
              value=""
              onChange={(e) => {
                const filter = savedFilters.find(f => f.id === e.target.value)
                if (filter && onLoadSavedFilter) {
                  onLoadSavedFilter(filter)
                }
              }}
              selectSize="sm"
              className="w-48"
            >
              <option value="">Saved Filters</option>
              {savedFilters.map(filter => (
                <option key={filter.id} value={filter.id}>
                  {filter.name} {filter.isDefault && '(Default)'}
                </option>
              ))}
            </Select>
          )}
          
          <div className="flex items-center gap-2">
            {onSaveFilter && activeFilterCount > 0 && (
              <Button variant="secondary"
                size="sm"
                leftIcon={<BookmarkIcon />}
                onClick={() => setShowSaveDialog(true)}
              >
                Save
              </Button>
            )}
            
            {showClearAll && activeFilterCount > 0 && (
              <Button variant="secondary"
                size="sm"
                leftIcon={<ArrowPathIcon />}
                onClick={handleClearAll}
              >
                Clear All
              </Button>
            )}
            
            {/* Mobile filter button */}
            <Button variant="secondary"
              size="sm"
              leftIcon={<FunnelIcon />}
              onClick={() => setIsMobileOpen(true)}
              className="lg:hidden"
            >
              Filters
              {showFilterCount && activeFilterCount > 0 && (
                <Badge size="sm" variant="success" className="ml-1">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </div>
        </div>
        
        {/* Filter controls - desktop only */}
        <div className="hidden lg:block">
          <div className="flex flex-wrap items-end gap-4">
            {visibleFilters.map(filter => renderDesktopFilter(filter))}
            
            {unpinnedFilters.length > maxVisibleFilters && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                leftIcon={isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
              >
                {isExpanded ? 'Show Less' : `Show ${unpinnedFilters.length - maxVisibleFilters + pinnedFilters.length} More`}
              </Button>
            )}
          </div>
        </div>
        
        {/* Active filters display */}
        {activeFilterCount > 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Active filters:</span>
            <div className="flex flex-wrap gap-2">
              {Object.entries(values).map(([key, value]) => {
                if (!value || (Array.isArray(value) && value.length === 0)) return null
                const filter = filters.find(f => f.id === key)
                if (!filter) return null
                
                return (
                  <Badge
                    key={key}
                    variant="secondary"
                    size="sm"
                    removable
                    onRemove={() => handleFilterChange(key, null)}
                  >
                    {filter.label}: {Array.isArray(value) ? `${value.length} selected` : String(value)}
                  </Badge>
                )
              })}
            </div>
          </div>
        )}
      </div>
      
      {/* Save filter dialog */}
      {showSaveDialog && (
        <Popover
          open={showSaveDialog}
          onOpenChange={setShowSaveDialog}
          trigger={<div />}
        >
          <div className="p-4 space-y-3 w-64">
            <h4 className="font-medium">Save Current Filters</h4>
            <Input
              value={saveFilterName}
              onChange={(e) => setSaveFilterName(e.target.value)}
              placeholder="Filter name"
              inputSize="sm"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSaveFilterName('')
                  setShowSaveDialog(false)
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveFilter}
                disabled={!saveFilterName}
              >
                Save
              </Button>
            </div>
          </div>
        </Popover>
      )}
    </div>
  )
  
  // Render vertical layout
  const renderVerticalLayout = () => (
    <div className={cn(
      'bg-white border-r border-gray-200 h-full',
      className
    )}>
      <div className="p-4 space-y-4">
        <h3 className="font-semibold flex items-center justify-between">
          Filters
          {showFilterCount && activeFilterCount > 0 && (
            <Badge size="sm" variant="success">
              {activeFilterCount}
            </Badge>
          )}
        </h3>
        
        {showSearch && onSearchChange && (
          <Input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            leftIcon={<MagnifyingGlassIcon />}
            inputSize="sm"
          />
        )}
        
        <div className="space-y-4">
          {filters.map(filter => (
            <div key={filter.id} className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                {filter.label}
              </label>
              {renderFilterControl(filter)}
            </div>
          ))}
        </div>
        
        {showClearAll && activeFilterCount > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClearAll}
            fullWidth
          >
            Clear All Filters
          </Button>
        )}
      </div>
    </div>
  )
  
  // Mobile drawer
  const renderMobileDrawer = () => (
    <Drawer
      open={isMobileOpen}
      onClose={() => setIsMobileOpen(false)}
      title="Filters"
      position="right"
    >
      <div className="p-4 space-y-4">
        {showSearch && onSearchChange && (
          <Input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            leftIcon={<MagnifyingGlassIcon />}
          />
        )}
        
        <div className="space-y-4">
          {filters.map(filter => (
            <div key={filter.id} className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                {filter.label}
              </label>
              {renderFilterControl(filter)}
            </div>
          ))}
        </div>
      </div>
      
      <DrawerActions>
        <Button
          variant="secondary"
          onClick={() => {
            handleClearAll()
            setIsMobileOpen(false)
          }}
          disabled={activeFilterCount === 0}
        >
          Clear All
        </Button>
        <Button
          variant="primary"
          onClick={() => setIsMobileOpen(false)}
        >
          Apply Filters
        </Button>
      </DrawerActions>
    </Drawer>
  )
  
  if (layout === 'vertical') {
    return renderVerticalLayout()
  }
  
  return (
    <>
      {renderHorizontalLayout()}
      {renderMobileDrawer()}
    </>
  )
}

/**
 * QuickFilters - Simplified filter UI for common use cases
 */
export function QuickFilters({
  filters,
  onChange,
  className,
}: {
  filters: Array<{
    label: string
    value: string
    count?: number
  }>
  onChange: (value: string) => void
  className?: string
}) {
  const [selected, setSelected] = useState<string>('')
  
  const handleSelect = (value: string) => {
    const newValue = value === selected ? '' : value
    setSelected(newValue)
    onChange(newValue)
  }
  
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {filters.map(filter => (
        <button
          key={filter.value}
          type="button"
          onClick={() => handleSelect(filter.value)}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full',
            'border transition-colors',
            selected === filter.value
              ? 'border-green-600 bg-green-50 text-green-700'
              : 'border-gray-300 hover:border-gray-400 text-gray-700'
          )}
        >
          {filter.label}
          {filter.count != null && (
            <span className="text-xs opacity-70">
              ({filter.count})
            </span>
          )}
        </button>
      ))}
    </div>
  )
}