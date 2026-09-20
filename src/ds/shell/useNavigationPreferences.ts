'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Preferences {
  collapsedGroups: string[]
}

interface NavigationPreferences extends Preferences {
  setCollapsedGroups: (groups: string[]) => void
}

const defaults = (): Preferences => ({ collapsedGroups: ['Admin'] })
const stringList = (value: unknown, limit: number): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))].slice(0, limit)
  : []

function readPreferences(key: string): Preferences {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults()
    const record = value as Record<string, unknown>
    return {
      // Apply the new default once to older saved preferences, preserving other choices.
      collapsedGroups: record.version === 2
        ? stringList(record.collapsedGroups, 30)
        : [...new Set([...stringList(record.collapsedGroups, 30), 'Admin'])],
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
      window.localStorage.setItem(storageKey, JSON.stringify({ ...next.value, version: 2 }))
    } catch {
      // Keep controls usable when storage is unavailable or full.
    }
  }, [storageKey])

  return {
    ...(saved?.key === storageKey ? saved.value : defaults()),
    setCollapsedGroups: useCallback((groups: string[]) => update({ collapsedGroups: stringList(groups, 30) }), [update]),
  }
}
