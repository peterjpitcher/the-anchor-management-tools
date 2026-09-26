'use client'

import React from 'react'
import { Alert, Button, Card, Input } from '@/ds'
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
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch()
        }}
      >
        {/* Kiosk-sized field: the wrapper lets it fill the row beside the Find button. */}
        <div className="min-w-0 flex-1">
          <Input
            id={inputId}
            label={label}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="AN-2607-0001"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-14 px-4 font-mono text-xl tracking-widest"
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={searching}
          className="h-14 shrink-0 px-5 text-base"
        >
          {searching ? 'Finding...' : 'Find'}
        </Button>
      </form>

      <div aria-live="polite">
        {message && (
          <Alert tone="warning" role="status" className="mt-2">
            {message}
          </Alert>
        )}

        {results && results.length > 1 && (
          <Card padding="none" className="mt-2">
            <ul className="divide-y divide-border">
              {results.map((item) => (
                <li key={item.number}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onSelect(item)}
                    className={cn(
                      'h-auto w-full min-h-touch justify-between gap-3 rounded-none px-4 py-3 text-left font-normal focus-visible:shadow-ring-inset',
                      selectedNumber === item.number && 'bg-primary-soft'
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
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  )
}
