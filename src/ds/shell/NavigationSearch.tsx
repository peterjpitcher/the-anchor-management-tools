'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import Link from 'next/link'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { Icon, type IconName } from '@/ds/icons'
import type { NavGroup } from './SidebarNav'

interface NavigationSearchProps {
  /** Only destinations already filtered for the current user's permissions. */
  navGroups: NavGroup[]
  onOpen?: () => void
}

const SEARCH_ALIASES: Record<string, string> = {
  rota: 'payroll shifts schedule timesheets',
  tables: 'reservations',
  messages: 'inbox sms texts',
  mgd: 'machine games duty',
}

export function NavigationSearch({ navGroups, onOpen }: NavigationSearchProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const show = () => {
      onOpen?.()
      setQuery('')
      setOpen(true)
    }
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        show()
      }
    }
    window.addEventListener('open-global-search', show)
    window.addEventListener('keydown', shortcut)
    return () => {
      window.removeEventListener('open-global-search', show)
      window.removeEventListener('keydown', shortcut)
    }
  }, [onOpen])

  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  // Search only permitted destinations, ranking page matches above group matches.
  const rank = (item: NavGroup['items'][number], group: NavGroup): number => {
    if (!terms.length) return 1
    const label = item.label.toLowerCase()
    if (label === query.trim().toLowerCase()) return 3
    const direct = `${label} ${item.href.replace(/[-/]/g, ' ')} ${SEARCH_ALIASES[item.id] ?? ''}`.toLowerCase()
    if (terms.every(term => direct.includes(term))) return 2
    return terms.every(term => `${group.label?.toLowerCase() ?? ''} ${direct}`.includes(term)) ? 1 : 0
  }
  const groups = navGroups.map(group => ({
    ...group,
    items: group.items.filter(item => rank(item, group) > 0)
      .sort((a, b) => rank(b, group) - rank(a, group)),
  })).filter(group => group.items.length > 0)
    .sort((a, b) => rank(b.items[0], b) - rank(a.items[0], a))

  const handleKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
    const links = Array.from(resultsRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])
    const index = links.indexOf(document.activeElement as HTMLAnchorElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!links.length) return
      const next = event.key === 'ArrowDown'
        ? (index + 1) % links.length
        : (index <= 0 ? links.length - 1 : index - 1)
      links[next].focus()
      links[next].scrollIntoView?.({ block: 'nearest' })
    } else if (event.key === 'Enter' && event.target === inputRef.current && !event.nativeEvent.isComposing) {
      event.preventDefault()
      links[0]?.click()
    }
  }

  return (
    <Dialog open={open} onClose={() => setOpen(false)} initialFocus={inputRef} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-text/50" />
      <div className="fixed inset-0 flex items-start justify-center px-3 pt-[12vh]">
        <DialogPanel onKeyDown={handleKeyboard} className="flex max-h-[75dvh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-default)] border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between px-4 pt-3">
            <DialogTitle className="text-sm font-semibold text-text">Find a page</DialogTitle>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation search" className="rounded-sm p-1 text-text-muted hover:text-text">
              <Icon name="x" size={18} />
            </button>
          </div>
          <div className="p-3">
            <label htmlFor="navigation-search-input" className="sr-only">Search pages</label>
            <input id="navigation-search-input" ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Find or go to..." autoComplete="off" className="w-full rounded-[var(--radius-default)] border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <nav ref={resultsRef} aria-label="Search results" className="overflow-y-auto px-2 pb-2">
            {groups.map((group, index) => (
              <section key={`${group.label}-${index}`} aria-label={group.label ?? 'Pages'}>
                {group.label && <h3 className="px-2 pb-1 pt-2 text-xs font-semibold text-text-muted">{group.label}</h3>}
                {group.items.map(item => (
                  <Link key={item.id} href={item.href} onClick={event => {
                    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) setOpen(false)
                  }} className="flex items-center gap-2 rounded-[var(--radius-default)] px-2 py-1.5 text-sm text-text hover:bg-surface-hover focus:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-primary">
                    <Icon name={item.icon as IconName} size={18} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </section>
            ))}
            {!groups.length && <p role="status" className="px-2 py-4 text-sm text-text-muted">No pages found. Try another search.</p>}
          </nav>
          <p className="border-t border-border px-4 py-2 text-xs text-text-muted">Use arrow keys to choose, Enter to open and Escape to close.</p>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
