// Deleting a calendar note from the note dialog: the delete is confirmed in a DS ConfirmDialog
// stacked on the note dialog, and a failed delete keeps both open so nothing is lost.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { VenueCalendar, type VenueCalendarNote } from '../VenueCalendar'
import { DEFAULT_CALENDAR_NOTE_COLOUR } from '../appearance'
import { deleteCalendarNote } from '@/app/actions/calendar-notes'

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
  // Anchored to September 2026 so the note is on the grid wherever this runs.
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

const NOTE: VenueCalendarNote = {
  id: 'note-1',
  note_date: '2026-09-17',
  end_date: '2026-09-17',
  title: 'Cellar delivery',
  notes: null,
  source: 'manual',
  start_time: null,
  end_time: null,
  color: DEFAULT_CALENDAR_NOTE_COLOUR,
  show_to_staff: true,
}

function openNote(onNotesChanged = vi.fn()) {
  render(
    <VenueCalendar
      events={[]}
      privateBookings={[]}
      calendarNotes={[NOTE]}
      parkingBookings={[]}
      canManageCalendarNotes
      onNotesChanged={onNotesChanged}
    />,
  )
  const entry = document.querySelector('[data-entry-kind="calendar_note"]') as HTMLElement
  fireEvent.click(entry)
  return onNotesChanged
}

describe('VenueCalendar note delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks in a danger ConfirmDialog, and Cancel leaves the note untouched', async () => {
    openNote()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    const confirm = await screen.findByRole('dialog', { name: 'Delete Calendar Note' })
    expect(within(confirm).getByText(/removes the entry from the shared Pub Ops calendar/)).toBeInTheDocument()

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete Calendar Note' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Edit Calendar Note' })).toBeInTheDocument()
    expect(deleteCalendarNote).not.toHaveBeenCalled()
  })

  it('deletes on confirm and closes both dialogs', async () => {
    vi.mocked(deleteCalendarNote).mockResolvedValue({ success: true } as Awaited<ReturnType<typeof deleteCalendarNote>>)
    const onNotesChanged = openNote()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Calendar Note' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteCalendarNote).toHaveBeenCalledWith('note-1'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Calendar Note' })).toBeNull())
    expect(toast.success).toHaveBeenCalledWith('Calendar note deleted.')
    expect(onNotesChanged).toHaveBeenCalled()
  })

  it('keeps the note dialog and the confirm open when the delete fails, and says why', async () => {
    vi.mocked(deleteCalendarNote).mockResolvedValue({ error: 'Calendar sync failed' } as Awaited<ReturnType<typeof deleteCalendarNote>>)
    const onNotesChanged = openNote()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Calendar Note' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Calendar sync failed'))
    // The note dialog is still mounted, with the draft, under the confirm; a modal confirm on top
    // hides it from the accessibility tree until the confirm closes, hence hidden: true.
    const noteDialog = screen.getByRole('dialog', { name: 'Edit Calendar Note', hidden: true })
    expect(within(noteDialog).getByDisplayValue('Cellar delivery')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Delete Calendar Note' })).toBeInTheDocument()
    expect(onNotesChanged).not.toHaveBeenCalled()
  })
})
