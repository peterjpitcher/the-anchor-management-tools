'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Preferences {
  pinned: boolean
  shortcutIds: string[]
  collapsedGroups: string[]
}

interface NavigationPreferences extends Preferences {
  setPinned: (value: boolean) => void
  setShortcutIds: (ids: string[]) => void
  setCollapsedGroups: (groups: string[]) => void
}

const defaults = (): Preferences => ({ pinned: false, shortcutIds: [], collapsedGroups: [] })
const stringList = (value: unknown, limit: number): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))].slice(0, limit)
  : []

function readPreferences(key: string): Preferences {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults()
    const record = value as Record<string, unknown>
    return {
      pinned: record.pinned === true,
      shortcutIds: stringList(record.shortcutIds, 4),
      collapsedGroups: stringList(record.collapsedGroups, 30),
    }
  } catch {
    return defaults()
  }
}

/** Browser-only preferences. Route permissions remain the responsibility of the shell. */
export function useNavigationPreferences(storageKey: string): NavigationPreferences {
  const [saved, setSaved] = useState<{ key: string; value: Preferences } | null>(null)
  const current = useRef(saved)

  useEffect(() => {
    const restored = { key: storageKey, value: readPreferences(storageKey) }
    current.current = restored
    setSaved(restored)
  }, [storageKey])

  const update = useCallback((patch: Partial<Preferences>) => {
    const previous = current.current?.key === storageKey
      ? current.current.value
      : readPreferences(storageKey)
    const next = { key: storageKey, value: { ...previous, ...patch } }
    current.current = next
    setSaved(next)
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next.value))
    } catch {
      // Keep controls usable when storage is unavailable or full.
    }
  }, [storageKey])

  return {
    ...(saved?.key === storageKey ? saved.value : defaults()),
    setPinned: useCallback((pinned: boolean) => update({ pinned }), [update]),
    setShortcutIds: useCallback((ids: string[]) => update({ shortcutIds: stringList(ids, 4) }), [update]),
    setCollapsedGroups: useCallback((groups: string[]) => update({ collapsedGroups: stringList(groups, 30) }), [update]),
  }
}
