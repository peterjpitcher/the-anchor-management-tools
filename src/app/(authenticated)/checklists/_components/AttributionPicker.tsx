'use client'

import { useMemo, useState } from 'react'
import { Button, Badge, Input, Spinner } from '@/ds'
import { Icon } from '@/ds/icons'
import type { AttributionCandidate } from '@/app/actions/checklists'

export interface Identity {
  employeeId: string
  name: string
}

interface AttributionPickerProps {
  identity: Identity | null
  candidates: AttributionCandidate[]
  loading: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (identity: Identity) => void
}

export function AttributionPicker({
  identity,
  candidates,
  loading,
  open,
  onOpenChange,
  onSelect,
}: AttributionPickerProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) => c.name.toLowerCase().includes(q))
  }, [candidates, query])

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="user" size={18} className="shrink-0 text-muted" />
          <span className="shrink-0 text-sm text-muted">Completing as:</span>
          <span className="truncate text-sm font-medium">
            {identity ? identity.name : 'Nobody chosen yet'}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
        >
          {identity ? 'Change' : 'Choose'}
        </Button>
      </div>

      {!identity && !open && (
        <p className="mt-1 text-xs text-muted">Choose who you are, then tick your tasks.</p>
      )}

      {open && (
        <div className="mt-2 rounded-lg border border-border bg-surface p-2 shadow-sm">
          <Input
            type="search"
            placeholder="Search staff by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search staff by name"
            fullWidth
          />
          <div className="mt-2 max-h-72 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 p-3 text-sm text-muted">
                <Spinner /> Loading staff
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-sm text-muted">No staff match that search.</p>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((c) => (
                  <li key={c.employeeId}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect({ employeeId: c.employeeId, name: c.name })
                        setQuery('')
                      }}
                      className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md px-2 py-3 text-left hover:bg-surface-2"
                    >
                      <span className="truncate text-sm">{c.name}</span>
                      {c.clockedIn ? (
                        <Badge tone="success">Clocked in</Badge>
                      ) : c.rostered ? (
                        <Badge tone="info">Rostered</Badge>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
