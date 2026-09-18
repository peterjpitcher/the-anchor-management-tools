import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Event } from '@/types/database'
import { EventListView } from './EventListView'

// Two nights with the same name, as a weekly quiz has, so the names must carry the date.
const events = [
  { id: 'evt-1', name: 'Quiz Night', date: '2026-10-02', time: '20:00', capacity: 40, event_status: 'scheduled', price: 2 },
  { id: 'evt-2', name: 'Quiz Night', date: '2026-10-09', time: '20:00', capacity: 40, event_status: 'scheduled', price: 2 },
] as unknown as Event[]

function renderList(onSelectionChange = vi.fn()) {
  render(
    <EventListView
      events={events}
      pagination={{ totalCount: 2, currentPage: 1, pageSize: 25, totalPages: 1 }}
      selectedIds={new Set()}
      onSelectionChange={onSelectionChange}
      onEventClick={vi.fn()}
      onEditEvent={vi.fn()}
      onPageChange={vi.fn()}
      onDeleteSelected={vi.fn()}
    />,
  )
  return onSelectionChange
}

describe('EventListView selection checkboxes', () => {
  it('names the select-all checkbox for the page it selects', () => {
    renderList()

    expect(screen.getByRole('checkbox', { name: 'Select all events on this page' })).toBeInTheDocument()
  })

  it('names each row checkbox after its event and date', () => {
    renderList()

    // jsdom applies no CSS, so the desktop table and the phone list both render.
    expect(screen.getAllByRole('checkbox', { name: 'Select Quiz Night on 2 October 2026' })).toHaveLength(2)
    expect(screen.getAllByRole('checkbox', { name: 'Select Quiz Night on 9 October 2026' })).toHaveLength(2)
  })

  it('leaves no checkbox without a name', () => {
    renderList()

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(5)
    for (const checkbox of checkboxes) {
      expect(checkbox).toHaveAccessibleName()
    }
  })

  it('selects the event its checkbox names', () => {
    const onSelectionChange = renderList()

    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select Quiz Night on 9 October 2026' })[0])

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['evt-2']))
  })
})
