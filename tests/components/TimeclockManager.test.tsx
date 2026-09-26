import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TimeclockManager from '@/app/(authenticated)/rota/timeclock/TimeclockManager'
import type { TimeclockSessionWithEmployee } from '@/app/actions/timeclock'
import type { RotaEmployee } from '@/app/actions/rota'

const actionMocks = vi.hoisted(() => ({
  createTimeclockSession: vi.fn(),
  updateTimeclockSession: vi.fn(),
  deleteTimeclockSession: vi.fn(),
  approveTimeclockSession: vi.fn(),
}))

vi.mock('@/app/actions/timeclock', () => actionMocks)

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const session: TimeclockSessionWithEmployee = {
  id: 'session-1',
  employee_id: 'employee-1',
  employee_name: 'Amanda Jones',
  work_date: '2026-07-27',
  clock_in_at: '2026-07-27T14:52:00.000Z',
  clock_out_at: null,
  clock_in_local: '15:52',
  clock_out_local: null,
  linked_shift_id: null,
  planned_start: '16:00',
  planned_end: '22:00',
  is_unscheduled: false,
  is_auto_close: false,
  auto_close_reason: null,
  is_reviewed: false,
  notes: null,
  manager_note: null,
  rate_multiplier: null,
  rate_override: null,
  premium_reason: null,
  premium_start_at: null,
  premium_end_at: null,
  premium_start_local: null,
  premium_end_local: null,
  shift_rate_multiplier: null,
  shift_rate_override: null,
  shift_premium_reason: null,
  shift_premium_start_time: null,
  shift_premium_end_time: null,
  created_at: '2026-07-27T14:52:00.000Z',
  updated_at: '2026-07-27T14:52:00.000Z',
}

const employee = {
  employee_id: 'employee-2',
  first_name: 'Ben',
  last_name: 'Cole',
  preferred_name: null,
} as unknown as RotaEmployee

function renderManager() {
  return render(
    <TimeclockManager
      layout={{ title: 'Rota', navItems: [] }}
      sessions={[session]}
      employees={[employee]}
      periodStart="2026-07-25"
      periodEnd="2026-08-24"
      year={2026}
      month={8}
      monthOptions={[{ label: 'August 2026', value: '?year=2026&month=8' }]}
      allowPayrollApprove={false}
    />,
  )
}

describe('TimeclockManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actionMocks.deleteTimeclockSession.mockResolvedValue({ success: true })
  })

  it('adds a manual entry from a dialog opened by the header action', async () => {
    actionMocks.createTimeclockSession.mockResolvedValue({
      success: true,
      data: { ...session, id: 'session-2', employee_id: 'employee-2', employee_name: 'Ben Cole' },
    })
    renderManager()

    // PageLayout renders header actions twice (desktop and phone).
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Entry' })[0])

    const dialog = await screen.findByRole('dialog', { name: 'Add Timeclock Entry' })
    fireEvent.change(within(dialog).getByLabelText('Employee'), { target: { value: 'employee-2' } })
    fireEvent.change(within(dialog).getByLabelText('Clock in'), { target: { value: '09:00' } })
    fireEvent.change(within(dialog).getByLabelText('Clock out (optional)'), { target: { value: '17:00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Entry' }))

    await waitFor(() => {
      expect(actionMocks.createTimeclockSession).toHaveBeenCalledWith(
        'employee-2',
        '2026-07-25',
        '09:00',
        '17:00',
        null,
        { allowPayrollApprove: false },
      )
    })
  })

  it('edits a session in a dialog and saves the corrected times', async () => {
    actionMocks.updateTimeclockSession.mockResolvedValue({
      success: true,
      data: { rate_multiplier: null, rate_override: null, premium_reason: null, premium_start_at: null, premium_end_at: null },
    })
    renderManager()

    fireEvent.click(screen.getByTitle('Edit'))

    const dialog = await screen.findByRole('dialog', { name: 'Edit Timeclock Entry' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use Planned (4pm)' }))
    fireEvent.change(within(dialog).getByLabelText('Clock out'), { target: { value: '22:00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(actionMocks.updateTimeclockSession).toHaveBeenCalledWith(
        'session-1',
        '2026-07-27',
        '16:00',
        '22:00',
        null,
        { premium: undefined, allowPayrollApprove: false },
      )
    })
  })

  it('asks for confirmation before deleting a session', async () => {
    renderManager()

    fireEvent.click(screen.getByTitle('Delete'))

    expect(actionMocks.deleteTimeclockSession).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText("Delete Amanda Jones's timeclock entry for Monday 27 July? This cannot be undone.")).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(actionMocks.deleteTimeclockSession).toHaveBeenCalledWith('session-1', {
        allowPayrollApprove: false,
      })
    })
  })
})
