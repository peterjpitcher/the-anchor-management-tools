'use client'

import { useMemo, FormEvent, ChangeEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Input, Select, Checkbox } from '@/ds'
import type { ReceiptWorkspaceFilters } from '@/app/actions/receipts'
import type { ReceiptTransaction } from '@/types/database'

interface ReceiptFiltersProps {
  filters: {
    status: ReceiptWorkspaceFilters['status'] | 'all'
    direction: 'in' | 'out' | 'all'
    showOnlyOutstanding: boolean
    groupByVendor: boolean
    missingVendorOnly: boolean
    missingExpenseOnly: boolean
    search: string
    month?: string
  }
  availableMonths: string[]
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split('-').map((part) => Number.parseInt(part, 10))
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return value
  }
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, 1))
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function ReceiptFilters({ filters, availableMonths }: ReceiptFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const monthOptions = useMemo(() => {
    const result: string[] = []
    const seen = new Set<string>()
      ; (availableMonths ?? []).forEach((value) => {
        if (!value || seen.has(value)) return
        seen.add(value)
        result.push(value)
      })
    if (filters.month && !seen.has(filters.month)) {
      result.push(filters.month)
    }
    return result.sort((a, b) => b.localeCompare(a))
  }, [availableMonths, filters.month])

  const statusOptions = useMemo(() => (
    [
      { value: 'all', label: 'All statuses' },
      { value: 'pending', label: 'Pending' },
      { value: 'completed', label: 'Completed' },
      { value: 'auto_completed', label: 'Auto completed' },
      { value: 'no_receipt_required', label: 'No receipt required' },
      { value: 'cant_find', label: "Can't find" },
    ]
  ), [])

  const directionOptions = useMemo(() => (
    [
      { value: 'all', label: 'All directions' },
      { value: 'out', label: 'Money out' },
      { value: 'in', label: 'Money in' },
    ]
  ), [])

  function updateQuery(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    Object.entries(next).forEach(([key, value]) => {
      if (value === null || value === '' || value === 'all') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    })
    params.delete('page')
    const query = params.toString()
    router.replace(`/receipts${query ? `?${query}` : ''}`, { scroll: false })
  }

  function handleStatusChange(event: ChangeEvent<HTMLSelectElement>) {
    updateQuery({ status: event.target.value })
  }

  function handleDirectionChange(event: ChangeEvent<HTMLSelectElement>) {
    updateQuery({ direction: event.target.value })
  }

  function handleMonthSelect(value: string) {
    if (!value || value === filters.month) return
    updateQuery({ month: value })
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const query = (formData.get('search') as string)?.trim() ?? ''
    updateQuery({ search: query || null })
  }

  function handleOutstandingToggle(checked: boolean) {
    updateQuery({ outstanding: checked ? null : '0' })
  }

  function handleGroupByVendorToggle(checked: boolean) {
    updateQuery({ groupByVendor: checked ? null : '0' })
  }

  function handleMissingVendorToggle(checked: boolean) {
    updateQuery({ needsVendor: checked ? '1' : null })
  }

  function handleMissingExpenseToggle(checked: boolean) {
    updateQuery({ needsExpense: checked ? '1' : null })
  }

  return (
    <div className="mb-4 space-y-3">
      <div className="flex items-center justify-end gap-2">
        <Select value={filters.status ?? 'all'} onChange={handleStatusChange} className="w-40" options={statusOptions} />
        <Select value={filters.direction ?? 'all'} onChange={handleDirectionChange} className="w-40" options={directionOptions} />
      </div>

      {monthOptions.length > 0 && (
        <div
          className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <Button
            variant={!filters.month ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => updateQuery({ month: null })}
            className="whitespace-nowrap flex-shrink-0"
          >
            All time
          </Button>
          {monthOptions.map((monthValue) => {
            const isActive = monthValue === filters.month
            return (
              <Button
                key={monthValue}
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={isActive}
                onClick={() => handleMonthSelect(monthValue)}
                className="whitespace-nowrap flex-shrink-0"
              >
                {formatMonthLabel(monthValue)}
              </Button>
            )
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Input
            name="search"
            placeholder="Search description or type"
            defaultValue={filters.search ?? ''}
            className="sm:w-64"
          />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
          <Checkbox
            label="Outstanding only"
            checked={filters.showOnlyOutstanding}
            onChange={handleOutstandingToggle}
          />
          <Checkbox
            label="Group by vendor"
            checked={filters.groupByVendor}
            onChange={handleGroupByVendorToggle}
          />
          <Checkbox
            label="Missing vendor"
            checked={filters.missingVendorOnly}
            onChange={handleMissingVendorToggle}
          />
          <Checkbox
            label="Missing expense"
            checked={filters.missingExpenseOnly}
            onChange={handleMissingExpenseToggle}
          />
        </div>
      </div>
    </div>
  )
}
