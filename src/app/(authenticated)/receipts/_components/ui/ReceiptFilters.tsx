'use client'

import { useMemo, FormEvent, ChangeEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import type { ReceiptWorkspaceFilters } from '@/app/actions/receipts'
import type { ReceiptTransaction } from '@/types/database'

interface ReceiptFiltersProps {
  filters: {
    status: ReceiptWorkspaceFilters['status'] | 'all'
    direction: 'in' | 'out' | 'all'
    showOnlyOutstanding: boolean
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

  function handleOutstandingToggle(event: ChangeEvent<HTMLInputElement>) {
    updateQuery({ outstanding: event.target.checked ? null : '0' })
  }

  function handleMissingVendorToggle(event: ChangeEvent<HTMLInputElement>) {
    updateQuery({ needsVendor: event.target.checked ? '1' : null })
  }

  function handleMissingExpenseToggle(event: ChangeEvent<HTMLInputElement>) {
    updateQuery({ needsExpense: event.target.checked ? '1' : null })
  }

  return (
    <div className="mb-4 space-y-3">
      <div className="flex items-center justify-end gap-2">
        <Select value={filters.status ?? 'all'} onChange={handleStatusChange} className="w-40">
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
        <Select value={filters.direction ?? 'all'} onChange={handleDirectionChange} className="w-40">
          {directionOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </div>

      {monthOptions.length > 0 && (
        <div
          className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <Button
            variant="ghost"
            size="xs"
            active={!filters.month}
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
                variant="ghost"
                size="xs"
                active={isActive}
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
          <label className="flex items-center gap-2">
            <Checkbox
              checked={filters.showOnlyOutstanding}
              onChange={handleOutstandingToggle}
            />
            Outstanding only
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={filters.missingVendorOnly}
              onChange={handleMissingVendorToggle}
            />
            Missing vendor
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={filters.missingExpenseOnly}
              onChange={handleMissingExpenseToggle}
            />
            Missing expense
          </label>
        </div>
      </div>
    </div>
  )
}
