import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Event } from '@/types/database'
import { EventBoardView } from './EventBoardView'

const events = [
  { id: 'evt-1', name: 'Quiz Night', date: '2026-10-02', time: '20:00', event_status: 'scheduled', category: { name: 'Quiz' } },
  { id: 'evt-2', name: 'Open Mic', date: '2026-10-03', time: null, event_status: 'cancelled' },
] as unknown as Event[]

describe('EventBoardView', () => {
  it('puts each event in its stage column, with a count in the column header', () => {
    render(<EventBoardView events={events} onEventClick={vi.fn()} />)

    const planned = screen.getByRole('heading', { name: 'Planned' }).parentElement?.parentElement as HTMLElement
    expect(within(planned).getByText('1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Quiz Night/ })).toBeInTheDocument()
    expect(screen.getByText('Quiz')).toBeInTheDocument()
    expect(screen.getAllByText('No events').length).toBeGreaterThan(0)
  })

  it('opens an event from a click, Enter or Space on its tile', () => {
    const onEventClick = vi.fn()
    render(<EventBoardView events={events} onEventClick={onEventClick} />)

    const tile = screen.getByRole('button', { name: /Quiz Night/ })
    fireEvent.click(tile)
    fireEvent.keyDown(tile, { key: 'Enter' })
    fireEvent.keyDown(tile, { key: ' ' })
    fireEvent.keyDown(tile, { key: 'a' })

    expect(onEventClick).toHaveBeenCalledTimes(3)
    expect(onEventClick).toHaveBeenCalledWith(events[0])
  })
})
