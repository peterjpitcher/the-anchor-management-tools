'use client'

/**
 * GlobalSearch — command-palette style search across customers, bookings, events and invoices.
 *
 * Trigger: Cmd+K (Mac) / Ctrl+K (Windows), or click the search button in the sidebar.
 * Fetches from /api/search with a 300 ms debounce (min 2 chars).
 * Results are grouped by entity type with keyboard navigation via the existing CommandPalette.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  UserGroupIcon,
  BuildingOfficeIcon,
  CalendarIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import { CommandPalette, useCommandPalette } from './navigation/CommandPalette'
import type { CommandItem } from './navigation/CommandPalette'
import type { SearchResult } from '@/app/api/search/route'

// ─── icon map ────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<SearchResult['type'], React.ReactNode> = {
  customer: <UserGroupIcon className="h-4 w-4" />,
  booking:  <BuildingOfficeIcon className="h-4 w-4" />,
  event:    <CalendarIcon className="h-4 w-4" />,
  invoice:  <DocumentTextIcon className="h-4 w-4" />,
}

const TYPE_LABEL: Record<SearchResult['type'], string> = {
  customer: 'Customers',
  booking:  'Private Bookings',
  event:    'Events',
  invoice:  'Invoices',
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function toCommandItem(result: SearchResult): CommandItem {
  return {
    id: `${result.type}-${result.id}`,
    title: result.title,
    subtitle: [result.subtitle, result.meta].filter(Boolean).join(' · '),
    icon: TYPE_ICON[result.type],
    category: TYPE_LABEL[result.type],
    href: result.href,
  }
}

// ─── component ───────────────────────────────────────────────────────────────

export function GlobalSearch() {
  const router = useRouter()
  const { isOpen, open, close } = useCommandPalette()

  const [query, setQuery]         = useState('')
  const [commands, setCommands]   = useState<CommandItem[]>([])
  const [loading, setLoading]     = useState(false)

  // Debounced fetch — 300 ms
  useEffect(() => {
    if (query.length < 2) {
      setCommands([])
      setLoading(false)
      return
    }

    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}`,
          { credentials: 'same-origin' }
        )
        if (!res.ok) {
          setCommands([])
          return
        }
        const json = await res.json() as { results: SearchResult[]; total: number }
        setCommands(json.results.map(toCommandItem))
      } catch {
        setCommands([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  // Reset query when palette closes
  const handleClose = useCallback(() => {
    setQuery('')
    setCommands([])
    close()
  }, [close])

  // Custom filter: since results already come from the server filtered to `query`,
  // just return them as-is — no client-side re-filtering needed.
  const noopFilter = useCallback((items: CommandItem[]) => items, [])

  // Intercept navigation so we can use Next.js router instead of hard redirect
  const handleItemAction = useCallback(
    (href: string) => {
      handleClose()
      router.push(href)
    },
    [handleClose, router]
  )

  // Wrap commands so each item uses handleItemAction
  const commandsWithAction: CommandItem[] = commands.map((cmd) => ({
    ...cmd,
    action: cmd.href ? () => handleItemAction(cmd.href!) : undefined,
    href: undefined, // prevent CommandPalette from doing window.location itself
  }))

  return (
    <>
      {/* Trigger button — shown in sidebar above nav items */}
      <button
        type="button"
        onClick={open}
        aria-label="Open global search (Cmd+K)"
        className="group flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-gray-300 hover:bg-green-700 hover:text-white transition-colors duration-150"
      >
        <MagnifyingGlassIcon className="h-5 w-5 flex-shrink-0 text-green-300 group-hover:text-white" aria-hidden="true" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-green-600 px-1 text-[10px] text-green-400 group-hover:border-green-300 group-hover:text-green-200">
          ⌘K
        </kbd>
      </button>

      <CommandPalette
        open={isOpen}
        onClose={handleClose}
        commands={commandsWithAction}
        placeholder="Search customers, bookings, events, invoices…"
        loading={loading}
        showRecent={false}
        showCategories={query.length >= 2}
        filterFunction={noopFilter}
        footer={
          <p className="text-xs text-gray-400">
            {query.length >= 2
              ? `${commands.length} result${commands.length !== 1 ? 's' : ''}`
              : 'Type at least 2 characters to search'}
          </p>
        }
      />
    </>
  )
}
