import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LeaveManagerClient from '@/app/(authenticated)/rota/leave/LeaveManagerClient'
import { deleteLeaveRequest, reviewLeaveRequest, updateLeaveRequestDates } from '@/app/actions/leave'

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/app/actions/leave', () => ({
  reviewLeaveRequest: vi.fn(),
  updateLeaveRequestDates: vi.fn(),
  deleteLeaveRequest: vi.fn(),
}))

const request = {
  id: '11111111-1111-1111-1111-111111111111',
  employee_id: '22222222-2222-2222-2222-222222222222',
  start_date: '2026-07-20',
  end_date: '2026-07-21',
  note: 'Family trip',
  status: 'pending' as const,
  manager_note: null,
  reviewed_by: null,
  reviewed_at: null,
  holiday_year: 2026,
  created_at: '2026-06-24T09:00:00.000Z',
  updated_at: '2026-06-24T09:00:00.000Z',
}

function renderManager() {
  return render(
    <LeaveManagerClient
      initialRequests={[request]}
      employeeMap={{ [request.employee_id]: 'Alex Rowe' }}
      canApprove
      canEdit
      usageMap={{ [`${request.employee_id}:2026`]: { count: 4, allowance: 28 } }}
    />,
  )
}

describe('LeaveManagerClient A-045', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reviewLeaveRequest).mockResolvedValue({ success: true })
    vi.mocked(updateLeaveRequestDates).mockResolvedValue({ success: true })
    vi.mocked(deleteLeaveRequest).mockResolvedValue({ success: true })
  })

  it('confirms approve before calling the action', async () => {
    renderManager()

    fireEvent.click(screen.getByRole('button', { name: 'Approve Alex Rowe holiday request' }))

    expect(reviewLeaveRequest).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog', { name: 'Approve holiday request?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(reviewLeaveRequest).toHaveBeenCalledWith(request.id, 'approved', undefined))
  })

  it('edits request dates from the row action', async () => {
    renderManager()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Alex Rowe holiday request' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-07-22' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-07-23' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save dates' }))

    await waitFor(() => {
      expect(updateLeaveRequestDates).toHaveBeenCalledWith(request.id, '2026-07-22', '2026-07-23')
    })
  })

  it('confirms delete before removing the request', async () => {
    renderManager()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Alex Rowe holiday request' }))

    expect(deleteLeaveRequest).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog', { name: 'Delete holiday request?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteLeaveRequest).toHaveBeenCalledWith(request.id))
    await waitFor(() => expect(screen.queryByText('Alex Rowe')).not.toBeInTheDocument())
  })
})
