import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TodayChecklistResult } from '@/app/actions/checklists'
import { ChecklistScreen } from './ChecklistScreen'

const { getAttributionCandidatesMock } = vi.hoisted(() => ({
  getAttributionCandidatesMock: vi.fn(),
}))

vi.mock('@/app/actions/checklists', () => ({
  getAttributionCandidates: getAttributionCandidatesMock,
  completeChecklistInstance: vi.fn(),
  undoChecklistInstance: vi.fn(),
}))

const initial: TodayChecklistResult = {
  businessDate: '2026-07-22',
  moduleEnabled: true,
  generationStatus: 'complete',
  groups: [
    {
      checklistId: 'checklist-1',
      checklistName: 'Opening',
      department: 'bar',
      sortOrder: 0,
      tasks: [
        {
          id: 'task-1',
          title: 'Open the till',
          instruction: null,
          slot: 'open',
          department: 'bar',
          requiresValue: false,
          valueUnit: null,
          valueMin: null,
          valueMax: null,
          dueAt: '2026-07-22T09:00:00.000Z',
          graceUntil: '2026-07-22T09:30:00.000Z',
          state: 'pending',
          locked: false,
          completedByEmployeeId: null,
          completedByName: null,
          completedAt: null,
          wasLate: false,
          valueRecorded: null,
          valueBreach: false,
          notes: null,
        },
      ],
    },
  ],
}

describe('ChecklistScreen attribution', () => {
  beforeEach(() => {
    sessionStorage.clear()
    getAttributionCandidatesMock.mockReset()
  })

  it('defaults to the most recent clock-in and still allows a manual change', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem(
      'checklist-identity',
      JSON.stringify({ employeeId: 'previous', name: 'Previous Person' }),
    )
    getAttributionCandidatesMock.mockResolvedValue({
      data: [
        {
          employeeId: 'older',
          name: 'Older Clock-in',
          clockedIn: true,
          clockedInAt: '2026-07-22T08:00:00.000Z',
          rostered: true,
        },
        {
          employeeId: 'latest',
          name: 'Latest Clock-in',
          clockedIn: true,
          clockedInAt: '2026-07-22T09:00:00.000Z',
          rostered: true,
        },
      ],
    })

    render(<ChecklistScreen initial={initial} />)

    expect(await screen.findByText('Latest Clock-in')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('checklist-identity') ?? '{}')).toEqual({
      employeeId: 'latest',
      name: 'Latest Clock-in',
    })

    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.click(screen.getByRole('button', { name: /Older Clock-in/ }))

    await waitFor(() => {
      expect(screen.getByText('Older Clock-in')).toBeInTheDocument()
    })
    expect(JSON.parse(sessionStorage.getItem('checklist-identity') ?? '{}')).toEqual({
      employeeId: 'older',
      name: 'Older Clock-in',
    })
  })
})
