'use client'

import { SearchInput, Select, DateTimePicker } from '@/ds'
import type { EventCategory } from '@/types/event-categories'

export interface EventFilters {
  searchTerm: string
  category: string
  status: string
  dateFrom: string
  dateTo: string
}

interface EventFilterPanelProps {
  filters: EventFilters
  onFilterChange: (filters: EventFilters) => void
  categories: EventCategory[]
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'postponed', label: 'Postponed' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'sold_out', label: 'Sold Out' },
]

export function EventFilterPanel({ filters, onFilterChange, categories }: EventFilterPanelProps) {
  const categoryOptions = [
    { value: 'all', label: 'All Categories' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ]

  function update(patch: Partial<EventFilters>) {
    onFilterChange({ ...filters, ...patch })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-56">
        <SearchInput
          value={filters.searchTerm}
          onChange={(v) => update({ searchTerm: v })}
          placeholder="Search events..."
        />
      </div>

      <div className="w-40">
        <Select
          options={categoryOptions}
          value={filters.category}
          onChange={(e) => update({ category: e.target.value })}
        />
      </div>

      <div className="w-40">
        <Select
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={(e) => update({ status: e.target.value })}
        />
      </div>

      <div className="w-36">
        <DateTimePicker
          type="date"
          value={filters.dateFrom}
          onChange={(v) => update({ dateFrom: v })}
          placeholder="From date"
        />
      </div>

      <div className="w-36">
        <DateTimePicker
          type="date"
          value={filters.dateTo}
          onChange={(v) => update({ dateTo: v })}
          placeholder="To date"
        />
      </div>
    </div>
  )
}
