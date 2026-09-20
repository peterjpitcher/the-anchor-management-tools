import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNavigationPreferences } from '../useNavigationPreferences'

beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('navigation preferences', () => {
  it('starts Admin collapsed and remembers an explicit expansion after reload', () => {
    const first = renderHook(() => useNavigationPreferences('new-user'))
    expect(first.result.current.collapsedGroups).toEqual(['Admin'])
    act(() => first.result.current.setCollapsedGroups([]))
    first.unmount()
    const restored = renderHook(() => useNavigationPreferences('new-user'))
    expect(restored.result.current.collapsedGroups).toEqual([])
  })

  it('restores saved preferences without overwriting them during hydration', () => {
    localStorage.setItem('user-a', JSON.stringify({ pinned: true, shortcutIds: ['rota'], collapsedGroups: ['Finance'] }))
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useNavigationPreferences('user-a'))
    expect(result.current).not.toHaveProperty('pinned')
    expect(result.current).not.toHaveProperty('shortcutIds')
    expect(result.current.collapsedGroups).toEqual(['Finance', 'Admin'])
    expect(write).not.toHaveBeenCalled()
  })

  it('isolates account changes, including the first render for a new account', () => {
    localStorage.setItem('user-a', JSON.stringify({ version: 2, collapsedGroups: ['Finance'] }))
    const seen: string[][] = []
    const { result, rerender } = renderHook(({ storageKey }) => {
      const preferences = useNavigationPreferences(storageKey)
      if (storageKey === 'user-b') seen.push(preferences.collapsedGroups)
      return preferences
    }, { initialProps: { storageKey: 'user-a' } })
    rerender({ storageKey: 'user-b' })
    expect(seen.every(groups => !groups.includes('Finance'))).toBe(true)
    act(() => result.current.setCollapsedGroups(['Staff']))
    expect(JSON.parse(localStorage.getItem('user-a')!).collapsedGroups).toEqual(['Finance'])
    expect(JSON.parse(localStorage.getItem('user-b')!).collapsedGroups).toEqual(['Staff'])
  })

  it('handles malformed storage and deduplicates collapsed groups', () => {
    localStorage.setItem('broken', '{')
    const { result } = renderHook(() => useNavigationPreferences('broken'))
    expect(result.current.collapsedGroups).toEqual(['Admin'])
    act(() => result.current.setCollapsedGroups(['Admin', 'Admin', 'Finance']))
    expect(result.current.collapsedGroups).toEqual(['Admin', 'Finance'])
  })

  it('rejects invalid stored fields', () => {
    localStorage.setItem('invalid', JSON.stringify({ pinned: 'true', shortcutIds: ['a', null, 'a', '', 1, 'b', 'c', 'd', 'e'], collapsedGroups: false }))
    const { result } = renderHook(() => useNavigationPreferences('invalid'))
    expect(result.current.collapsedGroups).toEqual(['Admin'])
  })

  it('keeps controls usable when browser storage fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full') })
    const { result } = renderHook(() => useNavigationPreferences('private'))
    act(() => result.current.setCollapsedGroups(['Team']))
    expect(result.current).not.toHaveProperty('pinned')
    expect(result.current.collapsedGroups).toEqual(['Team'])
  })
})
