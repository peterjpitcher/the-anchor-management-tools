// The rota's leave detail modal says what kind of leave it is.
//
// It was titled "Holiday Request" for every request, including days a new starter said they
// cannot work ("Cannot work (not holiday)"), which are not holiday and are left out of the
// allowance. The title is now neutral and a Type row names the kind of leave.
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeaveRequest } from '@/app/actions/leave'

const mocks = vi.hoisted(() => ({
  getLeaveRequestById: vi.fn(),
  deleteLeaveRequest: vi.fn(),
  updateLeaveRequestDates: vi.fn(),
}))

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('@/app/actions/leave', () => mocks)

import HolidayDetailModal from '@/app/(authenticated)/rota/HolidayDetailModal'

function leave(overrides: Partial<LeaveRequest>): LeaveRequest {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    employee_id: '22222222-2222-2222-2222-222222222222',
    start_date: '2099-08-03',
    end_date: '2099-08-04',
    note: null,
    status: 'approved',
    manager_note: null,
    reviewed_by: null,
    reviewed_at: null,
    holiday_year: 2099,
    created_at: '2099-06-24T09:00:00.000Z',
    updated_at: '2099-06-24T09:00:00.000Z',
    ...overrides,
  }
}

async function openModal(request: LeaveRequest): Promise<HTMLElement> {
  mocks.getLeaveRequestById.mockResolvedValue({ success: true, data: request })
  render(
    <HolidayDetailModal
      requestId={request.id}
      employeeName="Alex Rowe"
      canEdit
      onClose={vi.fn()}
      onDeleted={vi.fn()}
      onUpdated={vi.fn()}
    />,
  )
  const dialog = await screen.findByRole('dialog', { name: 'Leave Request' })
  await within(dialog).findByText('Type')
  return dialog
}

function typeValue(dialog: HTMLElement): HTMLElement {
  const term = within(dialog).getByText('Type')
  return term.nextElementSibling as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the rota leave detail modal', () => {
  it('names days someone cannot work, and never calls them holiday', async () => {
    const dialog = await openModal(leave({ leave_type: 'unavailable', leave_origin: 'agreed_at_hire' }))

    expect(typeValue(dialog)).toHaveTextContent('Cannot work (not holiday)')
    expect(within(dialog).queryByText('Holiday Request')).not.toBeInTheDocument()
  })

  it('names a holiday as a holiday', async () => {
    const dialog = await openModal(leave({ leave_type: 'holiday' }))

    expect(typeValue(dialog)).toHaveTextContent('Holiday')
  })

  it('reads a request with no type as a holiday, the column default', async () => {
    const dialog = await openModal(leave({}))

    expect(typeValue(dialog)).toHaveTextContent('Holiday')
  })
})
