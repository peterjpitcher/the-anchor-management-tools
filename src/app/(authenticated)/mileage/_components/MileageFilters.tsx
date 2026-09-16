'use client'

/**
 * Trip filters (spec 7.1). The component only proposes a new query; the trips page puts it in the
 * address. Every change returns to page 1. Search waits half a second after typing stops.
 */

import { useEffect, useState } from 'react'
import { Button, Input, SearchInput, Select } from '@/ds'
import type { MileageDriver } from '@/app/actions/mileage-drivers'
import { DEFAULT_MILEAGE_LIST_QUERY, hasActiveFilters, type MileageListQuery } from '@/lib/mileage/list-query'
import { CUSTOM_PRESET_VALUE, presetValueFor, type PeriodPresetGroup } from '@/lib/mileage/period-presets'

/** Matches the address parser's limit on search text. */
const MAX_SEARCH_CHARACTERS = 80

interface MileageFiltersProps {
  query: MileageListQuery
  presets: PeriodPresetGroup[]
  places: Array<{ id: string; name: string }>
  drivers: MileageDriver[]
  onChange: (next: MileageListQuery) => void
}

/** Trims and caps by character like the address parser, so the page never asks twice for the same search. */
function normaliseSearch(value: string): string {
  return Array.from(value.trim()).slice(0, MAX_SEARCH_CHARACTERS).join('').trim()
}

export function MileageFilters({ query, presets, places, drivers, onChange }: MileageFiltersProps): React.JSX.Element {
  const matchedPreset = presetValueFor(presets, query.from, query.to)
  const [choseCustom, setChoseCustom] = useState(false)
  const [customFrom, setCustomFrom] = useState(query.from ?? '')
  const [customTo, setCustomTo] = useState(query.to ?? '')
  const isCustom = choseCustom || matchedPreset === CUSTOM_PRESET_VALUE

  // Keep the date boxes in step when the address changes, for example after Back.
  useEffect(() => {
    setCustomFrom(query.from ?? '')
    setCustomTo(query.to ?? '')
  }, [query.from, query.to])

  function update(changes: Partial<MileageListQuery>): void {
    onChange({ ...query, ...changes, page: 1 })
  }

  function handlePeriodChange(value: string): void {
    if (value === CUSTOM_PRESET_VALUE) {
      setChoseCustom(true)
      return
    }
    setChoseCustom(false)
    const preset = presets.flatMap((group) => group.presets).find((entry) => entry.value === value)
    if (preset) update({ from: preset.from, to: preset.to })
  }

  function handleSearch(value: string): void {
    const q = normaliseSearch(value)
    if (q !== query.q) update({ q })
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          label="Period"
          value={isCustom ? CUSTOM_PRESET_VALUE : matchedPreset}
          onChange={(event) => handlePeriodChange(event.target.value)}
        >
          {presets.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.presets.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {/* SearchInput takes no label, so the label wraps it. */}
        <label className="flex min-w-0 flex-col text-[13px] font-medium text-text">
          <span className="mb-1">Search</span>
          <SearchInput value={query.q} onChange={handleSearch} debounceDelay={500} placeholder="Reason or place" />
        </label>
        <Select
          label="Place"
          value={query.placeId ?? ''}
          onChange={(event) => update({ placeId: event.target.value || null })}
          options={[{ value: '', label: 'All places' }, ...places.map((place) => ({ value: place.id, label: place.name }))]}
        />
        <Select
          label="Source"
          value={query.source ?? ''}
          onChange={(event) => {
            const value = event.target.value
            update({ source: value === 'manual' || value === 'oj_projects' ? value : null })
          }}
          options={[
            { value: '', label: 'All sources' },
            { value: 'manual', label: 'Logged' },
            { value: 'oj_projects', label: 'OJ Projects' },
          ]}
        />
        <Select
          label="Driver"
          value={query.driverId ?? ''}
          onChange={(event) => update({ driverId: event.target.value || null })}
          options={[{ value: '', label: 'All drivers' }, ...drivers.map((driver) => ({ value: driver.id, label: driver.displayName }))]}
        />
      </div>

      {isCustom && (
        <div className="flex flex-wrap items-end gap-3">
          <Input label="From" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
          <Input label="To" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
          <Button variant="secondary" size="sm" onClick={() => update({ from: customFrom || null, to: customTo || null })}>
            Apply dates
          </Button>
        </div>
      )}

      {hasActiveFilters(query) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setChoseCustom(false)
            onChange({ ...DEFAULT_MILEAGE_LIST_QUERY, sort: query.sort, dir: query.dir })
          }}
        >
          Clear filters
        </Button>
      )}
    </div>
  )
}
