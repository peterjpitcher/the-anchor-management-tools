import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChecklistTaskView } from '@/app/actions/checklists'
import { TaskRow } from './TaskRow'

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }))

vi.mock('@/app/actions/checklists', () => ({
  completeChecklistInstance: completeMock,
  skipChecklistInstance: vi.fn(),
  undoChecklistInstance: vi.fn(),
}))

function doneTask(overrides: Partial<ChecklistTaskView> = {}): ChecklistTaskView {
  return {
    id: 'task-1',
    title: 'Fridge 2 temperature',
    instruction: null,
    slot: '14:00',
    department: 'kitchen',
    requiresValue: true,
    valueUnit: 'degC',
    valueMin: 0,
    valueMax: 5,
    dueAt: '2026-09-22T13:00:00.000Z',
    graceUntil: '2026-09-22T13:30:00.000Z',
    state: 'done',
    locked: false,
    completedByEmployeeId: 'emp-a',
    completedByName: 'Alice',
    // Just ticked, so the 15-minute undo window is open.
    completedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    wasLate: false,
    valueRecorded: 3,
    valueBreach: false,
    notes: null,
    skipReason: null,
    ...overrides,
  }
}

function renderRow(task: ChecklistTaskView) {
  return render(
    <TaskRow task={task} identity={{ employeeId: 'emp-a', name: 'Alice' }} onChanged={() => {}} onNeedIdentity={() => {}} />,
  )
}

describe('TaskRow undo', () => {
  it('offers undo on a fresh in-range tick', () => {
    renderRow(doneTask())
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument()
  })

  it('does not offer undo on an out-of-range reading, which stays for a manager to see', () => {
    renderRow(doneTask({ valueRecorded: 9, valueBreach: true }))
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument()
    expect(screen.getByText('Out of range')).toBeInTheDocument()
  })
})

describe('TaskRow unusual reading', () => {
  it('asks before saving a reading far outside the band, and saves it once confirmed', async () => {
    completeMock.mockReset()
    completeMock.mockResolvedValue({})
    const user = userEvent.setup()
    renderRow(
      doneTask({
        state: 'pending',
        completedByEmployeeId: null,
        completedByName: null,
        completedAt: null,
        valueRecorded: null,
      }),
    )

    await user.type(screen.getByRole('spinbutton'), '999')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    // The typo guard asks first and saves nothing yet.
    expect(await screen.findByText('That reading looks unusual, is it correct?')).toBeInTheDocument()
    expect(completeMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Yes, Save It' }))
    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    expect(completeMock.mock.calls[0][0]).toMatchObject({ instanceId: 'task-1', employeeId: 'emp-a', value: 999 })
  })

  it('saves nothing when the unusual reading is not confirmed', async () => {
    completeMock.mockReset()
    const user = userEvent.setup()
    renderRow(
      doneTask({
        state: 'pending',
        completedByEmployeeId: null,
        completedByName: null,
        completedAt: null,
        valueRecorded: null,
      }),
    )

    await user.type(screen.getByRole('spinbutton'), '999')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(completeMock).not.toHaveBeenCalled()
  })
})
