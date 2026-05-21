import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChecklistTodoItem } from '@/lib/event-checklist'

vi.mock('@/app/actions/event-checklist', () => ({
  toggleEventChecklistTask: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// Full, lightweight mock of the design-system barrel so the test does not load the heavy shell.
vi.mock('@/ds', async () => {
  const React = await import('react')
  return {
    Card: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    CardHeader: ({ title, subtitle }: { title?: string; subtitle?: string }) =>
      React.createElement('div', null, title, subtitle ? React.createElement('p', null, subtitle) : null),
    CardBody: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    Badge: ({ tone, children }: { tone?: string; children: React.ReactNode }) =>
      React.createElement('span', { 'data-tone': tone }, children),
    Checkbox: ({
      onChange,
      checked,
      ...rest
    }: {
      onChange?: (v: boolean) => void
      checked?: boolean
      'aria-label'?: string
    }) =>
      React.createElement('button', {
        type: 'button',
        role: 'checkbox',
        'aria-checked': Boolean(checked),
        'aria-label': rest['aria-label'],
        onClick: () => onChange?.(!checked),
      }),
    toast: { error: vi.fn(), success: vi.fn() },
  }
})

import EventTodosWidget from './EventTodosWidget'
import { toggleEventChecklistTask } from '@/app/actions/event-checklist'
import { toast } from '@/ds'

const mockToggle = vi.mocked(toggleEventChecklistTask)
const TODAY = '2026-05-21'

function makeItem(overrides: Partial<ChecklistTodoItem> = {}): ChecklistTodoItem {
  return {
    key: 'write_event_brief',
    label: 'Write event brief',
    offsetDays: -28,
    channel: 'Admin',
    required: true,
    order: 1,
    eventId: 'evt-1',
    dueDate: '2026-05-18',
    dueDateFormatted: '18 May 2026',
    completed: false,
    completedAt: null,
    status: 'overdue',
    eventName: 'Draft Quiz Night',
    eventDate: '2026-06-15',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EventTodosWidget', () => {
  it('renders todos in the order received with correct urgency tone, including draft-event items', () => {
    const items = [
      makeItem({ key: 'a', label: 'Alpha task', status: 'overdue', dueDate: '2026-05-18', eventName: 'Draft Quiz Night' }),
      makeItem({ key: 'b', label: 'Beta task', status: 'due_today', dueDate: '2026-05-21', eventName: 'Scheduled Gig' }),
    ]
    render(<EventTodosWidget initialTodos={items} canManage todayIso={TODAY} />)

    const labels = screen.getAllByText(/ task$/).map((el) => el.textContent)
    expect(labels).toEqual(['Alpha task', 'Beta task'])

    expect(screen.getByText('Overdue by 3d')).toHaveAttribute('data-tone', 'danger')
    expect(screen.getByText('Due today')).toHaveAttribute('data-tone', 'warning')
    // Draft-event item is shown (widget must not filter by event_status).
    expect(screen.getByText('Draft Quiz Night')).toBeInTheDocument()
  })

  it('shows the caught-up empty state when there are no todos and no error', () => {
    render(<EventTodosWidget initialTodos={[]} canManage todayIso={TODAY} />)
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument()
  })

  it('shows a load-error state instead of the caught-up state when loadError is set', () => {
    render(<EventTodosWidget initialTodos={[]} canManage todayIso={TODAY} loadError="boom" />)
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument()
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
  })

  it('hides checkboxes when the user cannot manage', () => {
    render(<EventTodosWidget initialTodos={[makeItem()]} canManage={false} todayIso={TODAY} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('gives each checkbox an accessible name', () => {
    render(<EventTodosWidget initialTodos={[makeItem({ label: 'Write event brief' })]} canManage todayIso={TODAY} />)
    expect(
      screen.getByRole('checkbox', { name: 'Mark "Write event brief" complete' }),
    ).toBeInTheDocument()
  })

  it('optimistically removes a todo on successful completion', async () => {
    mockToggle.mockResolvedValue({ success: true })
    const user = userEvent.setup()
    render(<EventTodosWidget initialTodos={[makeItem({ label: 'Write event brief' })]} canManage todayIso={TODAY} />)

    await user.click(screen.getByRole('checkbox', { name: 'Mark "Write event brief" complete' }))

    await waitFor(() => expect(screen.queryByText('Write event brief')).not.toBeInTheDocument())
    expect(mockToggle).toHaveBeenCalledWith('evt-1', 'write_event_brief', true)
  })

  it('restores the todo and shows a toast when completion fails', async () => {
    mockToggle.mockResolvedValue({ success: false, error: 'nope' })
    const user = userEvent.setup()
    render(<EventTodosWidget initialTodos={[makeItem({ label: 'Write event brief' })]} canManage todayIso={TODAY} />)

    await user.click(screen.getByRole('checkbox', { name: 'Mark "Write event brief" complete' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('nope'))
    expect(screen.getByText('Write event brief')).toBeInTheDocument()
  })

  it('restores the todo and shows a toast when the action throws/rejects', async () => {
    mockToggle.mockRejectedValue(new Error('network'))
    const user = userEvent.setup()
    render(<EventTodosWidget initialTodos={[makeItem({ label: 'Write event brief' })]} canManage todayIso={TODAY} />)

    await user.click(screen.getByRole('checkbox', { name: 'Mark "Write event brief" complete' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByText('Write event brief')).toBeInTheDocument()
  })

  it('restores only the failed item when an earlier completion fails after a later one succeeds', async () => {
    let rejectFirst!: (reason?: unknown) => void
    const firstPromise = new Promise<{ success: boolean; error?: string }>((_resolve, reject) => {
      rejectFirst = reject
    })
    mockToggle.mockImplementation((_eventId: string, key: string) =>
      key === 'first' ? firstPromise : Promise.resolve({ success: true }),
    )
    const items = [
      makeItem({ key: 'first', label: 'First task', dueDate: '2026-05-18' }),
      makeItem({ key: 'second', label: 'Second task', dueDate: '2026-05-19' }),
    ]
    const user = userEvent.setup()
    render(<EventTodosWidget initialTodos={items} canManage todayIso={TODAY} />)

    // Begin completing "first" (request stays pending), then complete "second" (succeeds).
    await user.click(screen.getByRole('checkbox', { name: 'Mark "First task" complete' }))
    await user.click(screen.getByRole('checkbox', { name: 'Mark "Second task" complete' }))
    await waitFor(() => expect(screen.queryByText('Second task')).not.toBeInTheDocument())

    // Now fail "first": only it should be restored; "second" must stay removed.
    rejectFirst(new Error('network'))
    await waitFor(() => expect(screen.getByText('First task')).toBeInTheDocument())
    expect(screen.queryByText('Second task')).not.toBeInTheDocument()
  })
})
