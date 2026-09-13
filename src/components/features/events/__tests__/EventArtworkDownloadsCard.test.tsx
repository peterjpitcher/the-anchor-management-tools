import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Event } from '@/types/database'
import { EventArtworkDownloadsCard } from '../EventArtworkDownloadsCard'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const EVENT_ID = '3f1d9e2c-7b4a-4c8e-9a11-2d5f6b7c8d90'
const PUBLIC = 'https://cdn.test/storage/v1/object/public/event-images/'

function eventWith(fields: Partial<Event>): Event {
  return { id: EVENT_ID, name: 'Quiz Night', ...fields } as Event
}

describe('EventArtworkDownloadsCard', () => {
  it('offers the A4 print sheet beside a branded table talker', () => {
    render(
      <EventArtworkDownloadsCard
        event={eventWith({
          table_talker_url: `${PUBLIC}events/${EVENT_ID}/table_talker/branded/1-table_talker.png`,
        })}
      />
    )

    expect(screen.getByText('Table talker (print)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Print sheet \(A4\)/ })).toBeEnabled()
  })

  it('holds the sheet back while the table talker is unbranded', () => {
    render(
      <EventArtworkDownloadsCard
        event={eventWith({
          table_talker_url: `${PUBLIC}events/${EVENT_ID}/table_talker/1788881600000_talker.png`,
        })}
      />
    )

    expect(screen.getByRole('button', { name: /Print sheet \(A4\)/ })).toBeDisabled()
  })

  it('offers no sheet for any other artwork', () => {
    render(
      <EventArtworkDownloadsCard
        event={eventWith({
          print_poster_url: `${PUBLIC}events/${EVENT_ID}/print_poster/branded/1-print_poster.png`,
        })}
      />
    )

    expect(screen.queryByRole('button', { name: /Print sheet/ })).toBeNull()
  })
})
