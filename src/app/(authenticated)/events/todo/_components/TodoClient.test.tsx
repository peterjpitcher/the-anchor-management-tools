import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ChecklistTodoItem } from '@/lib/event-checklist'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }))

vi.mock('@/app/actions/event-checklist', () => ({
  toggleEventChecklistTask: vi.fn(),
}))

vi.mock('@/ds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ds')>()),
  toast,
}))

import TodoClient from './TodoClient'
import { toggleEventChecklistTask } from '@/app/actions/event-checklist'

const mockToggle = vi.mocked(toggleEventChecklistTask)

function makeItem(overrides: Partial<ChecklistTodoItem> = {}): ChecklistTodoItem {
  return {
    key: 'write_event_brief',
    label: 'Write the Event Brief',
    offsetDays: -56,
    channel: 'Admin',
    required: true,
    order: 1,
    eventId: 'evt-1',
    dueDate: '2026-09-20',
    dueDateFormatted: '20 Sep 2026',
    completed: false,
    completedAt: null,
    status: 'overdue',
    eventName: 'Quiz Night',
    eventDate: '2026-10-02',
    ...overrides,
  }
}

describe('TodoClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the event date in words, not as a raw ISO date', () => {
    render(<TodoClient initialTodos={[makeItem()]} />)

    expect(screen.getByText(/^Fri,? 2 Oct 2026$/)).toBeInTheDocument()
    expect(screen.queryByText('2026-10-02')).toBeNull()
  })

  it('keeps the tick when the save succeeds', async () => {
    mockToggle.mockResolvedValue({ success: true })
    render(<TodoClient initialTodos={[makeItem()]} />)

    const checkbox = screen.getByRole('checkbox', { name: 'Write the Event Brief' })
    fireEvent.click(checkbox)

    await waitFor(() => expect(mockToggle).toHaveBeenCalledWith('evt-1', 'write_event_brief', true))
    expect(checkbox).toBeChecked()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('puts the tick back and says why when the save is refused', async () => {
    mockToggle.mockResolvedValue({ success: false, error: 'Insufficient permissions' })
    render(<TodoClient initialTodos={[makeItem()]} />)

    const checkbox = screen.getByRole('checkbox', { name: 'Write the Event Brief' })
    fireEvent.click(checkbox)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Insufficient permissions'))
    expect(checkbox).not.toBeChecked()
  })

  it('puts the tick back and says so when the request fails', async () => {
    mockToggle.mockRejectedValue(new Error('Failed to fetch'))
    render(<TodoClient initialTodos={[makeItem()]} />)

    const checkbox = screen.getByRole('checkbox', { name: 'Write the Event Brief' })
    fireEvent.click(checkbox)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update todo'))
    expect(checkbox).not.toBeChecked()
  })
})
