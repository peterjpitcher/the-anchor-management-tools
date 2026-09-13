import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MaintenanceTimeline } from '@/app/(authenticated)/maintenance/_components/MaintenanceTimeline'

const getMaintenanceTimelineMock = vi.hoisted(() => vi.fn())
const addMaintenanceNoteMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/app/actions/maintenance', () => ({
  getMaintenanceTimeline: getMaintenanceTimelineMock,
  addMaintenanceNote: addMaintenanceNoteMock,
}))

const ITEM_ID = '22222222-2222-4222-8222-222222222222'

const noteEntry = {
  kind: 'note' as const,
  id: 'note-1',
  occurredAt: '2026-09-04T10:00:00.000Z',
  actorEmail: 'peter@example.com',
  note: {
    id: 'note-1',
    itemId: ITEM_ID,
    content: 'Chased the electrician again.',
    createdBy: null,
    createdByEmail: 'peter@example.com',
    createdAt: '2026-09-04T10:00:00.000Z',
  },
}

const historyEntry = {
  kind: 'history' as const,
  id: 'history-1',
  occurredAt: '2026-09-03T10:00:00.000Z',
  actorEmail: null,
  history: {
    id: 'history-1',
    itemId: ITEM_ID,
    changedAt: '2026-09-03T10:00:00.000Z',
    changedBy: null,
    changedByEmail: null,
    field: 'status',
    oldValue: 'reported',
    newValue: 'quoting',
  },
}

describe('MaintenanceTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMaintenanceTimelineMock.mockResolvedValue({
      success: true,
      data: { entries: [noteEntry, historyEntry], nextCursor: null, hasMore: false },
    })
  })

  it('shows notes first and keeps system events behind a toggle', async () => {
    render(<MaintenanceTimeline itemId={ITEM_ID} />)

    await waitFor(() =>
      expect(screen.getByText('Chased the electrician again.')).toBeInTheDocument()
    )

    const toggle = screen.getByRole('button', { name: 'Show system events (1)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide system events' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    // Statuses read as their labels, not as raw column values.
    expect(screen.getByText('Getting quotes')).toBeInTheDocument()
    expect(screen.getByText('the system', { exact: false })).toBeInTheDocument()
  })

  it('shows a broken history read as an error, never as an empty trail', async () => {
    getMaintenanceTimelineMock.mockResolvedValue({
      success: false,
      error: 'Could not load the history for this item.',
    })

    render(<MaintenanceTimeline itemId={ITEM_ID} />)

    await waitFor(() =>
      expect(screen.getByText('Could not load the history for this item.')).toBeInTheDocument()
    )
    expect(screen.queryByText('No notes yet.', { exact: false })).toBeNull()
  })

  it('keeps the draft when a note fails to save', async () => {
    addMaintenanceNoteMock.mockResolvedValue({
      success: false,
      error: 'Could not save that note.',
    })

    render(<MaintenanceTimeline itemId={ITEM_ID} />)
    await waitFor(() => expect(getMaintenanceTimelineMock).toHaveBeenCalled())

    const box = screen.getByLabelText('Add a note') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Rang the landlord.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))

    await waitFor(() => expect(screen.getByText('Could not save that note.')).toBeInTheDocument())
    expect(box.value).toBe('Rang the landlord.')
  })

  it('adds a saved note to the top of the list', async () => {
    addMaintenanceNoteMock.mockResolvedValue({
      success: true,
      data: {
        id: 'note-2',
        itemId: ITEM_ID,
        content: 'Rang the landlord.',
        createdBy: null,
        createdByEmail: 'peter@example.com',
        createdAt: '2026-09-06T09:00:00.000Z',
      },
    })

    render(<MaintenanceTimeline itemId={ITEM_ID} />)
    await waitFor(() => expect(getMaintenanceTimelineMock).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Rang the landlord.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))

    await waitFor(() => expect(screen.getByText('Rang the landlord.')).toBeInTheDocument())
    expect((screen.getByLabelText('Add a note') as HTMLTextAreaElement).value).toBe('')
  })

  it('re-enables the note button and keeps the draft when the save never comes back', async () => {
    // The connection drops mid-save, so the promise rejects. Without a catch the
    // button spins for ever, the savingNote guard blocks the retry, and the typing
    // is lost on the next reload.
    addMaintenanceNoteMock.mockRejectedValue(new Error('Failed to fetch'))

    render(<MaintenanceTimeline itemId={ITEM_ID} />)
    await waitFor(() => expect(getMaintenanceTimelineMock).toHaveBeenCalled())

    const box = screen.getByLabelText('Add a note') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Rang the landlord.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))

    await waitFor(() =>
      expect(
        screen.getByText('Could not save the note. Check your connection and try again.')
      ).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Save note' })).not.toBeDisabled()
    expect(box.value).toBe('Rang the landlord.')

    // And the retry actually goes through, rather than being swallowed by the guard.
    addMaintenanceNoteMock.mockResolvedValue({
      success: true,
      data: {
        id: 'note-2',
        itemId: ITEM_ID,
        content: 'Rang the landlord.',
        createdBy: null,
        createdByEmail: 'peter@example.com',
        createdAt: '2026-09-06T09:00:00.000Z',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(addMaintenanceNoteMock).toHaveBeenCalledTimes(2))
  })

  it('shows a history read that never came back as an error, never as an empty trail', async () => {
    getMaintenanceTimelineMock.mockRejectedValue(new Error('Failed to fetch'))

    render(<MaintenanceTimeline itemId={ITEM_ID} />)

    await waitFor(() =>
      expect(
        screen.getByText('Could not load the history. Check your connection and try again.')
      ).toBeInTheDocument()
    )
    expect(screen.queryByText('No notes yet.', { exact: false })).toBeNull()
  })
})
