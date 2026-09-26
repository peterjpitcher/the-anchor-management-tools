// The cross-event todo list labels each event with its date. events.date is a Postgres date
// column, and the badge showed it raw ("2026-10-02") rather than as a readable London date.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TodoClient from '@/app/(authenticated)/events/todo/_components/TodoClient'
import type { ChecklistTodoItem } from '@/lib/event-checklist'

vi.mock('@/app/actions/event-checklist', () => ({
  toggleEventChecklistTask: vi.fn(),
}))

const todo: ChecklistTodoItem = {
  key: 'send_whatsapp_reminder',
  label: 'WhatsApp Reminder (3 Days Before)',
  offsetDays: -3,
  channel: 'WhatsApp',
  required: true,
  order: 7,
  eventId: 'event-1',
  dueDate: '2026-09-29',
  dueDateFormatted: 'September 29, 2026',
  completed: false,
  completedAt: null,
  status: 'upcoming',
  eventName: 'Quiz Night',
  eventDate: '2026-10-02',
}

describe('TodoClient, event date badge', () => {
  it('shows the event date as a readable date', () => {
    render(<TodoClient initialTodos={[todo]} />)

    expect(screen.getByText('Fri, 2 Oct 2026')).toBeInTheDocument()
    expect(screen.queryByText('2026-10-02')).not.toBeInTheDocument()
  })
})
