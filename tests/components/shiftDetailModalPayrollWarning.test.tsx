// A premium change saves the shift and clears the payroll approval for its month. When that clear
// fails the action returns success with a warning, and the shift modal must show it: otherwise the
// manager is told "Shift updated" while the approved payroll figures are out of date.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShiftDetailModal from '@/app/(authenticated)/rota/ShiftDetailModal'
import type { RotaShift } from '@/app/actions/rota'
import { updateShift } from '@/app/actions/rota'
import { toast } from '@/ds/primitives/Toast'

vi.mock('@/app/actions/rota', () => ({
  addShiftsFromTemplates: vi.fn(),
  autoPopulateWeekFromTemplates: vi.fn(),
  createShift: vi.fn(),
  deleteShift: vi.fn(),
  markEmployeeCouldntWork: vi.fn(),
  markShiftSick: vi.fn(),
  moveShift: vi.fn(),
  updateShift: vi.fn(),
  upsertRotaSalesTargetOverride: vi.fn(),
}))

vi.mock('@/app/actions/leave', () => ({
  bookApprovedHoliday: vi.fn(),
  deleteLeaveRequest: vi.fn(),
  getLeaveRequestById: vi.fn(),
  updateLeaveRequestDates: vi.fn(),
}))

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

const shift: RotaShift = {
  id: 'shift-1',
  week_id: 'week-1',
  employee_id: EMPLOYEE_ID,
  template_id: null,
  shift_date: '2026-10-03',
  start_time: '17:00',
  end_time: '23:00',
  unpaid_break_minutes: 0,
  department: 'bar',
  status: 'scheduled',
  sick_reason: null,
  notes: null,
  is_overnight: false,
  is_open_shift: false,
  name: null,
  reassigned_from_id: null,
  reassigned_at: null,
  reassigned_by: null,
  reassignment_reason: null,
  acceptance_status: null,
  acceptance_decided_at: null,
  acceptance_decided_by: null,
  acceptance_note: null,
  auto_accept_reason: null,
  auto_accept_warning_sent_at: null,
  rate_multiplier: null,
  rate_override: null,
  premium_reason: null,
  premium_start_time: null,
  premium_end_time: null,
  created_at: '2026-09-20T10:00:00Z',
  updated_at: '2026-09-20T10:00:00Z',
}

const WARNING =
  'The shift was saved, but the payroll approval covering 3 October 2026 could not be cleared, so the approved payroll figures are now out of date. Please re-approve payroll for that month, or tell the developer if this keeps happening.'

function renderModal() {
  render(
    <ShiftDetailModal
      shift={shift}
      employee={{
        employee_id: EMPLOYEE_ID,
        first_name: 'Amanda',
        last_name: 'Jones',
        preferred_name: null,
        job_title: null,
        max_weekly_hours: null,
        is_active: true,
      }}
      canEdit
      departments={[]}
      onClose={vi.fn()}
      onUpdated={vi.fn()}
      onDeleted={vi.fn()}
    />,
  )
}

async function saveEdit() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit Shift' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(updateShift).toHaveBeenCalled())
}

describe('ShiftDetailModal payroll approval warning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the warning when the shift saved but the payroll approval was not cleared', async () => {
    vi.mocked(updateShift).mockResolvedValue({ success: true, data: shift, warning: WARNING })
    renderModal()

    await saveEdit()

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Shift updated')
      expect(toast.warning).toHaveBeenCalledWith(WARNING, { duration: 12000 })
    })
  })

  it('shows no warning when the save carries none', async () => {
    vi.mocked(updateShift).mockResolvedValue({ success: true, data: shift })
    renderModal()

    await saveEdit()

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Shift updated'))
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
