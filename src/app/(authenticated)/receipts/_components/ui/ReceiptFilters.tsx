'use client'

import { useEffect, useMemo, useState, FormEvent, ChangeEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Input, Select, Checkbox } from '@/ds'
import type { ReceiptWorkspaceFilters } from '@/app/actions/receipts'
import type { ReceiptTransaction } from '@/types/database'

interface ReceiptFiltersProps {
  filters: {
    status: ReceiptWorkspaceFilters['status'] | 'all'
    direction: 'in' | 'out' | 'all'
    sourceType: 'bank' | 'amex' | 'all'
    cardMember: string
    showOnlyOutstanding: boolean
    groupByVendor: boolean
    missingVendorOnly: boolean
    missingExpenseOnly: boolean
    search: string
    month?: string
  }
  availableMonths: string[]
  availableCardMembers: string[]
}

type LocalFilters = ReceiptFiltersProps['filters']

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

export function ReceiptFilters({ filters, availableMonths, availableCardMembers }: ReceiptFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [localFilters, setLocalFilters] = useState<LocalFilters>(filters)

  useEffect(() => {
    setLocalFilters(filters)
  }, [
    filters.status,
    filters.direction,
    filters.sourceType,
    filters.cardMember,
    filters.showOnlyOutstanding,
    filters.groupByVendor,
    filters.missingVendorOnly,
    filters.missingExpenseOnly,
    filters.search,
    filters.month,
  ])

  const monthOptions = useMemo(() => {
    const result: string[] = []
    const seen = new Set<string>()
      ; (availableMonths ?? []).forEach((value) => {
        if (!value || seen.has(value)) return
        seen.add(value)
        result.push(value)
      })
    if (localFilters.month && !seen.has(localFilters.month)) {
      result.push(localFilters.month)
    }
    return result.sort((a, b) => b.localeCompare(a))
  }, [availableMonths, localFilters.month])

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

  const sourceOptions = useMemo(() => (
    [
      { value: 'all', label: 'All sources' },
      { value: 'bank', label: 'Bank' },
      { value: 'amex', label: 'Amex' },
    ]
  ), [])

  const cardMemberOptions = useMemo(() => (
    [
      { value: '', label: 'All cardholders' },
      ...availableCardMembers.map((name) => ({ value: name, label: name })),
    ]
  ), [availableCardMembers])

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

  function applyFilters(nextFilters: LocalFilters) {
    setLocalFilters(nextFilters)
    updateQuery({
      status: nextFilters.status ?? null,
      direction: nextFilters.direction,
      source: nextFilters.sourceType,
      cardMember: nextFilters.cardMember || null,
      outstanding: nextFilters.showOnlyOutstanding ? null : '0',
      groupByVendor: nextFilters.groupByVendor ? null : '0',
      needsVendor: nextFilters.missingVendorOnly ? '1' : null,
      needsExpense: nextFilters.missingExpenseOnly ? '1' : null,
      search: nextFilters.search.trim() || null,
      month: nextFilters.month ?? null,
    })
  }

  function handleStatusChange(event: ChangeEvent<HTMLSelectElement>) {
    applyFilters({ ...localFilters, status: event.target.value as LocalFilters['status'] })
  }

  function handleDirectionChange(event: ChangeEvent<HTMLSelectElement>) {
    applyFilters({ ...localFilters, direction: event.target.value as LocalFilters['direction'] })
  }

  function handleSourceChange(event: ChangeEvent<HTMLSelectElement>) {
    const newSourceType = event.target.value as LocalFilters['sourceType']
    const shouldClearCardMember = newSourceType !== 'amex'
    applyFilters({
      ...localFilters,
      sourceType: newSourceType,
      cardMember: shouldClearCardMember ? '' : localFilters.cardMember,
    })
  }

  function handleCardMemberChange(event: ChangeEvent<HTMLSelectElement>) {
    applyFilters({ ...localFilters, cardMember: event.target.value })
  }

  function handleMonthSelect(value: string) {
    if (!value || value === localFilters.month) return
    applyFilters({ ...localFilters, month: value })
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    applyFilters({ ...localFilters, search: localFilters.search.trim() })
  }

  function handleOutstandingToggle(checked: boolean) {
    applyFilters({ ...localFilters, showOnlyOutstanding: checked })
  }

  function handleGroupByVendorToggle(checked: boolean) {
    applyFilters({ ...localFilters, groupByVendor: checked })
  }

  function handleMissingVendorToggle(checked: boolean) {
    applyFilters({ ...localFilters, missingVendorOnly: checked })
  }

  function handleMissingExpenseToggle(checked: boolean) {
    applyFilters({ ...localFilters, missingExpenseOnly: checked })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select value={localFilters.status ?? 'all'} onChange={handleStatusChange} className="w-40" options={statusOptions} />
        <Select value={localFilters.direction ?? 'all'} onChange={handleDirectionChange} className="w-40" options={directionOptions} />
        <Select value={localFilters.sourceType ?? 'all'} onChange={handleSourceChange} className="w-40" options={sourceOptions} />
        {availableCardMembers.length > 0 && localFilters.sourceType === 'amex' && (
          <Select value={localFilters.cardMember ?? ''} onChange={handleCardMemberChange} className="w-40" options={cardMemberOptions} />
        )}
      </div>

      {monthOptions.length > 0 && (
        <div
          className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <Button
            variant={!localFilters.month ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => applyFilters({ ...localFilters, month: undefined })}
            className="whitespace-nowrap flex-shrink-0"
          >
            All time
          </Button>
          {monthOptions.map((monthValue) => {
            const isActive = monthValue === localFilters.month
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
            value={localFilters.search ?? ''}
            onChange={(event) => setLocalFilters((current) => ({ ...current, search: event.target.value }))}
            className="sm:w-64"
          />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
          <Checkbox
            label="Outstanding only"
            checked={localFilters.showOnlyOutstanding}
            onChange={handleOutstandingToggle}
          />
          <Checkbox
            label="Group by vendor"
            checked={localFilters.groupByVendor}
            onChange={handleGroupByVendorToggle}
          />
          <Checkbox
            label="Missing vendor"
            checked={localFilters.missingVendorOnly}
            onChange={handleMissingVendorToggle}
          />
          <Checkbox
            label="Missing expense"
            checked={localFilters.missingExpenseOnly}
            onChange={handleMissingExpenseToggle}
          />
        </div>
      </div>
    </div>
  )
}
