import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventChecklistItem } from '@/lib/event-checklist'
import { getEventChecklist, toggleEventChecklistTask } from '@/app/actions/event-checklist'
import { EventChecklistCard } from '@/components/features/events/EventChecklistCard'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('@/app/actions/event-checklist', () => ({
  getEventChecklist: vi.fn(),
  toggleEventChecklistTask: vi.fn(),
}))

vi.mock('@/ds', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/ds')>(),
  toast,
}))

vi.mock('@/lib/dateUtils', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/dateUtils')>(),
  getTodayIsoDate: () => '2026-09-06',
}))

type ToggleResult = Awaited<ReturnType<typeof toggleEventChecklistTask>>

function deferred() {
  let resolve!: (value: ToggleResult) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<ToggleResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function task(key: string, overrides: Partial<EventChecklistItem> = {}): EventChecklistItem {
  return {
    key,
    label: key,
    eventId: 'event-1',
    offsetDays: -3,
    channel: 'Admin',
    required: true,
    order: 0,
    dueDate: '2026-09-06',
    dueDateFormatted: '6 September 2026',
    completed: false,
    completedAt: null,
    status: 'due_today',
    ...overrides,
  }
}

function completeCheckbox(label: string) {
  return screen.getByRole('checkbox', { name: `Mark ${label} as complete` })
}

function reopenButton(label: string) {
  const row = screen.getByText(label).closest('.justify-between')
  if (!row) throw new Error(`No completed row for ${label}`)
  return within(row as HTMLElement).getByRole('button', { name: 'Reopen' })
}

async function renderChecklist(items = [task('First task'), task('Second task', { order: 1 })]) {
  vi.mocked(getEventChecklist).mockResolvedValue({ success: true, items })
  render(<EventChecklistCard eventId="event-1" eventName="Quiz" />)
  await screen.findByText(items[0].label)
}

describe('EventChecklistCard updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('allows overlapping completions and keeps the checklist visible without refetching', async () => {
    const first = deferred()
    const second = deferred()
    vi.mocked(toggleEventChecklistTask)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    await renderChecklist()

    fireEvent.click(completeCheckbox('First task'))
    expect(reopenButton('First task')).toBeDisabled()
    expect(completeCheckbox('Second task')).toBeEnabled()
    fireEvent.click(completeCheckbox('Second task'))
    expect(reopenButton('First task')).toBeDisabled()
    expect(reopenButton('Second task')).toBeDisabled()
    expect(toggleEventChecklistTask).toHaveBeenNthCalledWith(1, 'event-1', 'First task', true)
    expect(toggleEventChecklistTask).toHaveBeenNthCalledWith(2, 'event-1', 'Second task', true)

    await act(async () => second.resolve({ success: true }))
    expect(reopenButton('Second task')).toBeEnabled()
    expect(reopenButton('First task')).toBeDisabled()
    expect(screen.getByText('Outstanding Tasks')).toBeVisible()
    await act(async () => first.resolve({ success: true }))

    expect(reopenButton('First task')).toBeEnabled()
    expect(screen.getByText('All caught up')).toBeVisible()
    expect(getEventChecklist).toHaveBeenCalledTimes(1)
  })

  it('restores only the failed task when another completion has succeeded', async () => {
    const first = deferred()
    const second = deferred()
    vi.mocked(toggleEventChecklistTask)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    await renderChecklist()

    fireEvent.click(completeCheckbox('First task'))
    fireEvent.click(completeCheckbox('Second task'))
    await act(async () => second.resolve({ success: true }))
    await act(async () => first.resolve({ success: false, error: 'Unable to save first task' }))

    expect(completeCheckbox('First task')).toBeEnabled()
    expect(completeCheckbox('First task')).not.toBeChecked()
    expect(reopenButton('Second task')).toBeEnabled()
    expect(toast.error).toHaveBeenCalledWith('Unable to save first task')
    expect(getEventChecklist).toHaveBeenCalledTimes(1)
  })

  it('restores a rejected update and lets the user retry', async () => {
    const rejected = deferred()
    vi.mocked(toggleEventChecklistTask)
      .mockReturnValueOnce(rejected.promise)
      .mockResolvedValueOnce({ success: true })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await renderChecklist()
      fireEvent.click(completeCheckbox('First task'))
      await act(async () => rejected.reject(new Error('Network interrupted')))

      expect(toast.error).toHaveBeenCalled()
      expect(completeCheckbox('First task')).toBeEnabled()
      await act(async () => fireEvent.click(completeCheckbox('First task')))
      expect(reopenButton('First task')).toBeEnabled()
      expect(toggleEventChecklistTask).toHaveBeenCalledTimes(2)
      expect(getEventChecklist).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })

  it.each([
    ['2026-09-05', '1 day overdue (5 September 2026)', '5 September 2026'],
    ['2026-09-06', 'Due today', '6 September 2026'],
    ['2026-09-07', 'Due in 1 day (7 September 2026)', '7 September 2026'],
  ])('reopens a task due on %s with its local due status', async (dueDate, dueDescription, dueDateFormatted) => {
    const pending = deferred()
    vi.mocked(toggleEventChecklistTask).mockReturnValueOnce(pending.promise)
    await renderChecklist([task('Completed task', {
      dueDate,
      dueDateFormatted,
      completed: true,
      completedAt: '2026-09-05T12:00:00.000Z',
      status: 'completed',
    })])

    fireEvent.click(reopenButton('Completed task'))
    expect(completeCheckbox('Completed task')).toBeDisabled()
    expect(screen.getByText(dueDescription)).toBeVisible()
    await act(async () => pending.resolve({ success: true }))

    expect(completeCheckbox('Completed task')).toBeEnabled()
    expect(completeCheckbox('Completed task')).not.toBeChecked()
    expect(toggleEventChecklistTask).toHaveBeenCalledWith('event-1', 'Completed task', false)
    expect(getEventChecklist).toHaveBeenCalledTimes(1)
  })
})
