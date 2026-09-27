import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PayrollClient from '@/app/(authenticated)/rota/payroll/PayrollClient'
import { deletePayrollRow, updatePayrollRowTimes, upsertShiftNote } from '@/app/actions/payroll'
import type { PayrollMonthApproval } from '@/app/actions/payroll'
import type { PayrollRow } from '@/lib/rota/excel-export'

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('@/app/actions/payroll', () => ({
  approvePayrollMonth: vi.fn(),
  sendPayrollEmail: vi.fn(),
  updatePayrollPeriod: vi.fn(),
  upsertShiftNote: vi.fn(),
  updatePayrollRowTimes: vi.fn(),
  deletePayrollRow: vi.fn(),
}))

const row: PayrollRow = {
  employeeName: 'Amanda Jones',
  employeeId: 'employee-1',
  date: '2026-07-05',
  department: 'bar',
  plannedHours: 6,
  actualHours: 6,
  hourlyRate: 12.71,
  totalPay: 76.26,
  flags: '',
  plannedStart: '16:00',
  plannedEnd: '22:00',
  actualStart: '16:00',
  actualEnd: '22:00',
  shiftId: 'shift-1',
  sessionId: 'session-1',
  note: null,
  sessionNote: null,
  standardHours: 6,
  premiumHours: 0,
  multiplier: null,
  effectiveRate: 12.71,
  premiumReason: null,
  premiumPay: 0,
}

function renderPayroll(approval: PayrollMonthApproval | null = null) {
  render(
    <PayrollClient
      layout={{ title: 'Rota', subtitle: 'Payroll: July 2026', navItems: [] }}
      year={2026}
      month={7}
      rows={[row]}
      employees={[{ name: 'Amanda Jones', plannedHours: 6, actualHours: 6, hourlyRate: 12.71, totalPay: 76.26 }]}
      approval={approval}
      period={{ id: 'period-1', year: 2026, month: 7, period_start: '2026-06-25', period_end: '2026-07-24' }}
      canApprove
      canSend={false}
      canExport={false}
      monthOptions={[{ label: 'July 2026', value: '?year=2026&month=7' }]}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Expand All' }))
}

describe('PayrollClient row dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updatePayrollRowTimes).mockResolvedValue({ success: true })
    vi.mocked(upsertShiftNote).mockResolvedValue({ success: true })
    vi.mocked(deletePayrollRow).mockResolvedValue({ success: true })
  })

  it('corrects worked times in a dialog that shows the planned times', async () => {
    renderPayroll()

    fireEvent.click(screen.getByRole('button', { name: 'Edit worked times' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit Worked Times' })
    expect(within(dialog).getByText('Planned 4pm')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Clock out'), { target: { value: '23:00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(updatePayrollRowTimes).toHaveBeenCalledWith('session-1', 'employee-1', '2026-07-05', '16:00', '23:00', 2026, 7)
    })
  })

  it('saves a payroll note from its own dialog', async () => {
    renderPayroll()

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))

    const dialog = await screen.findByRole('dialog', { name: 'Add Note' })
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'Stayed late for a delivery' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Note' }))

    await waitFor(() => {
      expect(upsertShiftNote).toHaveBeenCalledWith('shift-1', 'Stayed late for a delivery', 2026, 7)
    })
  })

  it('warns in the dialog that a change undoes an approved month', async () => {
    renderPayroll({
      id: 'approval-1',
      year: 2026,
      month: 7,
      approved_at: '2026-07-25T09:00:00.000Z',
      approved_by: 'user-1',
      snapshot_data: {},
      email_sent_at: null,
      email_sent_to: null,
    } as unknown as PayrollMonthApproval)

    fireEvent.click(screen.getByRole('button', { name: 'Edit worked times' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit Worked Times' })
    expect(within(dialog).getByText(/re-approve after this change/)).toBeInTheDocument()
  })

  it('confirms before deleting a row', async () => {
    renderPayroll()

    fireEvent.click(screen.getByRole('button', { name: 'Delete row' }))
    expect(deletePayrollRow).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog', { name: 'Delete Payroll Row' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deletePayrollRow).toHaveBeenCalledWith('session-1', 'shift-1', 2026, 7))
  })
})
