import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNavigationPreferences } from '../useNavigationPreferences'
import { ShortcutPicker } from '../ShortcutPicker'
import type { NavGroup } from '../SidebarNav'

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
    expect(result.current.pinned).toBe(true)
    expect(result.current.shortcutIds).toEqual(['rota'])
    expect(result.current.collapsedGroups).toEqual(['Finance', 'Admin'])
    expect(write).not.toHaveBeenCalled()
  })

  it('isolates account changes, including the first render for a new account', () => {
    localStorage.setItem('user-a', JSON.stringify({ pinned: true, shortcutIds: ['rota'] }))
    const seen: string[][] = []
    const { result, rerender } = renderHook(({ storageKey }) => {
      const preferences = useNavigationPreferences(storageKey)
      if (storageKey === 'user-b') seen.push(preferences.shortcutIds)
      return preferences
    }, { initialProps: { storageKey: 'user-a' } })
    rerender({ storageKey: 'user-b' })
    expect(seen.every(ids => ids.length === 0)).toBe(true)
    act(() => result.current.setShortcutIds(['tables']))
    expect(JSON.parse(localStorage.getItem('user-a')!).shortcutIds).toEqual(['rota'])
    expect(JSON.parse(localStorage.getItem('user-b')!).shortcutIds).toEqual(['tables'])
  })

  it('handles malformed storage and limits unique shortcuts to four', () => {
    localStorage.setItem('broken', '{')
    const { result } = renderHook(() => useNavigationPreferences('broken'))
    expect(result.current.pinned).toBe(false)
    act(() => result.current.setShortcutIds(['a', 'a', 'b', 'c', 'd', 'e']))
    expect(result.current.shortcutIds).toEqual(['a', 'b', 'c', 'd'])
  })

  it('rejects invalid stored fields', () => {
    localStorage.setItem('invalid', JSON.stringify({ pinned: 'true', shortcutIds: ['a', null, 'a', '', 1, 'b', 'c', 'd', 'e'], collapsedGroups: false }))
    const { result } = renderHook(() => useNavigationPreferences('invalid'))
    expect(result.current.pinned).toBe(false)
    expect(result.current.shortcutIds).toEqual(['a', 'b', 'c', 'd'])
    expect(result.current.collapsedGroups).toEqual(['Admin'])
  })

  it('keeps controls usable when browser storage fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full') })
    const { result } = renderHook(() => useNavigationPreferences('private'))
    act(() => { result.current.setPinned(true); result.current.setCollapsedGroups(['Team']) })
    expect(result.current.pinned).toBe(true)
    expect(result.current.collapsedGroups).toEqual(['Team'])
  })
})

describe('shortcut chooser', () => {
  const navGroups: NavGroup[] = [{ label: 'Team', items: ['rota', 'employees', 'recruitment', 'checklists', 'messages'].map(id => ({ id, label: id, href: `/${id}`, icon: 'home' })) }]

  it('shows only supplied permission-filtered destinations and removes stale IDs on change', () => {
    const onChange = vi.fn()
    render(<ShortcutPicker navGroups={navGroups} shortcutIds={['restricted']} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose shortcuts' }))
    expect(screen.queryByLabelText('restricted')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('rota'))
    expect(onChange).toHaveBeenCalledWith(['rota'])
    fireEvent.click(screen.getByRole('button', { name: 'Use default shortcuts' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('caps choices at four while allowing existing choices to be removed', () => {
    const onChange = vi.fn()
    render(<ShortcutPicker navGroups={navGroups} shortcutIds={['rota', 'employees', 'recruitment', 'checklists']} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose shortcuts' }))
    expect(screen.getByLabelText('messages')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('rota'))
    expect(onChange).toHaveBeenCalledWith(['employees', 'recruitment', 'checklists'])
  })
})
