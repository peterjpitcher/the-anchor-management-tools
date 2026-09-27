'use client'

import { useMemo, useState } from 'react'
import { Button, Badge, Input, PageLoading } from '@/ds'
import { Icon } from '@/ds/icons'
import { CHECKLIST_PRESENCE_STATUS } from '../_shared/status-ui'
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
          <Icon name="user" size={18} className="shrink-0 text-text-muted" />
          <span className="shrink-0 text-sm text-text-muted">Completing as:</span>
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
        <p className="mt-1 text-xs text-text-muted">Choose who you are, then tick your tasks.</p>
      )}

      {/* The list opens in place, under a divider, inside the sticky bar it belongs to. */}
      {open && (
        <div className="mt-2 border-t border-border pt-2">
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
              <PageLoading inline label="Loading staff" />
            ) : filtered.length === 0 ? (
              <p className="p-3 text-sm text-text-muted">No staff match that search.</p>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((c) => {
                  const presence = c.clockedIn
                    ? CHECKLIST_PRESENCE_STATUS.clockedIn
                    : c.rostered
                      ? CHECKLIST_PRESENCE_STATUS.rostered
                      : null
                  return (
                    <li key={c.employeeId}>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          onSelect({ employeeId: c.employeeId, name: c.name })
                          setQuery('')
                        }}
                        className="h-auto min-h-touch w-full justify-between px-2 py-3 text-left font-normal focus-visible:shadow-ring-inset"
                      >
                        <span className="truncate text-sm">{c.name}</span>
                        {presence && <Badge tone={presence.tone}>{presence.label}</Badge>}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
