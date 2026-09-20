import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NavigationSearch } from '../NavigationSearch'
import type { NavGroup } from '../SidebarNav'

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} onClick={event => { props.onClick?.(event); event.preventDefault() }}>{children}</a>,
}))

const groups: NavGroup[] = [
  { label: 'Team', items: [{ id: 'rota', label: 'Rota', icon: 'clock', href: '/rota' }] },
  { label: 'Bookings', items: [{ id: 'tables', label: 'Table bookings', icon: 'table', href: '/table-bookings' }] },
]

function openSearch() {
  act(() => window.dispatchEvent(new Event('open-global-search')))
}

describe('NavigationSearch', () => {
  it('opens by shortcut, moves through destinations and opens the focused link', async () => {
    render(<NavigationSearch navGroups={groups} />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const input = await screen.findByRole('textbox', { name: 'Search pages' })
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('link', { name: 'Rota' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(screen.getByRole('link', { name: 'Table bookings' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(screen.getByRole('link', { name: 'Rota' })).toHaveFocus()
    fireEvent.click(document.activeElement!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('filters labels, group names, href words and aliases without adding unpermitted pages', () => {
    render(<NavigationSearch navGroups={groups.slice(0, 1)} />)
    openSearch()
    const input = screen.getByRole('textbox', { name: 'Search pages' })
    for (const query of ['rota', 'team', 'payroll']) {
      fireEvent.change(input, { target: { value: query } })
      expect(screen.getByRole('link', { name: 'Rota' })).toHaveAttribute('href', '/rota')
    }
    fireEvent.change(input, { target: { value: 'Table bookings' } })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('No pages found')
  })

  it('opens the first result with Enter from the search field', async () => {
    render(<NavigationSearch navGroups={groups} />)
    openSearch()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes on Escape and resets the query when reopened with Cmd+K', async () => {
    render(<NavigationSearch navGroups={groups} />)
    openSearch()
    const input = screen.getByRole('textbox')
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.change(input, { target: { value: 'no match' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('preserves modifier-click behaviour and closes using the close control', async () => {
    render(<NavigationSearch navGroups={groups} />)
    openSearch()
    fireEvent.click(screen.getByRole('link', { name: 'Rota' }), { metaKey: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation search' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})


describe('navigation search opening coordination', () => {
  it.each(['event', 'Control', 'Meta'])('notifies the shell on %s opening so it can dismiss the mobile drawer', (method) => {
    const closeMobile = vi.fn()
    render(<NavigationSearch navGroups={groups} onOpen={closeMobile} />)
    if (method === 'event') openSearch()
    else fireEvent.keyDown(window, { key: 'k', ctrlKey: method === 'Control', metaKey: method === 'Meta' })
    expect(closeMobile).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Find a page' })).toBeInTheDocument()
  })
})

describe('page ranking', () => {
  it('places an exact page ahead of destinations matching only its group', () => {
    render(<NavigationSearch navGroups={[{ label: 'Bookings & events', items: [
      { id: 'tables', label: 'Table Bookings', icon: 'table', href: '/table-bookings' },
      { id: 'events', label: 'Events', icon: 'calendar', href: '/events' },
    ] }]} />)
    openSearch()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'events' } })
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/events')
  })
})
