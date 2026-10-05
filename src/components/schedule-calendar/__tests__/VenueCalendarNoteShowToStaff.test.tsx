// The "Show to staff" tick on the calendar note dialog: it decides whether a note is listed on
// the staff portal, so the dialog must show the stored value and send exactly what is ticked.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { VenueCalendar, type VenueCalendarNote } from '../VenueCalendar'
import { DEFAULT_CALENDAR_NOTE_COLOUR } from '../appearance'
import { createCalendarNote, updateCalendarNote } from '@/app/actions/calendar-notes'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }))

// jsdom has no matchMedia; false keeps the desktop month grid.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/events',
  // Anchored to September 2026 so the notes are on the grid wherever this runs.
  useSearchParams: () => new URLSearchParams('calMonth=2026-09'),
}))

vi.mock('@/app/actions/calendar-notes', () => ({
  createCalendarNote: vi.fn(),
  updateCalendarNote: vi.fn(),
  deleteCalendarNote: vi.fn(),
}))

vi.mock('@/ds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ds')>()),
  toast,
}))

function note(overrides: Partial<VenueCalendarNote>): VenueCalendarNote {
  return {
    id: 'note-1',
    note_date: '2026-09-17',
    end_date: '2026-09-17',
    title: 'Kitchen closed',
    notes: null,
    source: 'manual',
    start_time: null,
    end_time: null,
    color: DEFAULT_CALENDAR_NOTE_COLOUR,
    show_to_staff: true,
    ...overrides,
  }
}

function openNote(calendarNote: VenueCalendarNote) {
  render(
    <VenueCalendar
      events={[]}
      privateBookings={[]}
      calendarNotes={[calendarNote]}
      parkingBookings={[]}
      canManageCalendarNotes
      onNotesChanged={vi.fn()}
    />,
  )
  fireEvent.click(document.querySelector('[data-entry-kind="calendar_note"]') as HTMLElement)
}

function tick(): HTMLInputElement {
  return screen.getByRole('checkbox', { name: 'Show to staff' }) as HTMLInputElement
}

describe('VenueCalendar note "Show to staff" tick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateCalendarNote).mockResolvedValue({ data: undefined })
    vi.mocked(createCalendarNote).mockResolvedValue({ data: undefined })
  })

  it('opens ticked for a note staff can see', () => {
    openNote(note({ show_to_staff: true }))
    expect(tick().checked).toBe(true)
  })

  it('opens unticked for a managers-only note', () => {
    openNote(note({ title: 'School half term', show_to_staff: false }))
    expect(tick().checked).toBe(false)
  })

  it('saves a managers-only note as managers-only when only the title is edited', async () => {
    openNote(note({ title: 'School half term', show_to_staff: false }))
    fireEvent.change(screen.getByDisplayValue('School half term'), { target: { value: 'Half term' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateCalendarNote).toHaveBeenCalledTimes(1))
    expect(updateCalendarNote).toHaveBeenCalledWith(
      'note-1',
      expect.objectContaining({ title: 'Half term', show_to_staff: false }),
    )
  })

  it('sends the new value when the tick is cleared', async () => {
    openNote(note({ show_to_staff: true }))
    fireEvent.click(tick())
    expect(tick().checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateCalendarNote).toHaveBeenCalledTimes(1))
    expect(updateCalendarNote).toHaveBeenCalledWith('note-1', expect.objectContaining({ show_to_staff: false }))
  })

  it('tells the manager the note still goes to the Google calendar', () => {
    openNote(note({}))
    expect(screen.getByText(/goes to the Google calendar either way/i)).toBeTruthy()
  })
})
