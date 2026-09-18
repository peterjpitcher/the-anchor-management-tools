'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import type { FohVoucherLookupItem } from '../lib'
import { statusLabel } from './voucher-status'

type NumberSearchProps = {
  idPrefix: string
  label: string
  query: string
  onQueryChange: (value: string) => void
  onSearch: () => void
  searching: boolean
  results: FohVoucherLookupItem[] | null
  message: string | null
  onSelect: (item: FohVoucherLookupItem) => void
  selectedNumber?: string | null
}

// Big number entry + pick list (spec section 4): large input for the iPad,
// results and errors announced politely for screen readers (F46).
export function NumberSearch({
  idPrefix,
  label,
  query,
  onQueryChange,
  onSearch,
  searching,
  results,
  message,
  onSelect,
  selectedNumber
}: NumberSearchProps) {
  const inputId = `${idPrefix}-number`

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-text">
        {label}
      </label>
      <form
        className="mt-1 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch()
        }}
      >
        <input
          id={inputId}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="AN-2607-0001"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="block h-14 w-full min-w-0 rounded-lg border border-border-strong bg-surface px-4 font-mono text-xl tracking-widest text-text placeholder:text-text-subtle focus:border-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/40"
        />
        <button
          type="submit"
          disabled={searching}
          className="h-14 shrink-0 rounded-lg bg-sidebar px-5 text-base font-semibold text-white hover:bg-sidebar/90 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? 'Finding...' : 'Find'}
        </button>
      </form>

      <div aria-live="polite">
        {message && (
          <p role="status" className="mt-2 rounded-md border border-amber-200 bg-warning-soft px-3 py-2 text-sm text-warning-fg">
            {message}
          </p>
        )}

        {results && results.length > 1 && (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
            {results.map((item) => (
              <li key={item.number}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className={cn(
                    'flex min-h-touch w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sidebar/40',
                    selectedNumber === item.number && 'bg-success-soft'
                  )}
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-base font-semibold text-text">
                      {item.number}
                    </span>
                    <span className="block truncate text-sm text-text-muted">{item.typeTitle}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-text">
                    {statusLabel(item.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
