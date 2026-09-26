import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildEventChecklist, getOutstandingTodos } from '@/lib/event-checklist'

// The WhatsApp reminder is due three days before the event, so for an event on 5 October it is
// due on 2 October. 23:30 UTC on 1 October 2026 is 00:30 on 2 October in London (BST), when the
// UTC date is still the 1st.
const EVENT = { id: 'event-1', name: 'Quiz Night', date: '2026-10-05' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T23:30:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('event checklist without an explicit today', () => {
  it('works out due today from the London date', () => {
    const reminder = buildEventChecklist(EVENT).find(({ key }) => key === 'send_whatsapp_reminder')

    expect(reminder).toMatchObject({ dueDate: '2026-10-02', status: 'due_today' })
  })

  it('gives outstanding todos the same London status', () => {
    const reminder = getOutstandingTodos(EVENT).find(({ key }) => key === 'send_whatsapp_reminder')

    expect(reminder?.status).toBe('due_today')
  })
})
