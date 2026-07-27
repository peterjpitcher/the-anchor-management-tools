import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PayrollClient from '@/app/(authenticated)/rota/payroll/PayrollClient'
import type { PayrollRow } from '@/lib/rota/excel-export'

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
  totalPay: 85.79,
  flags: '',
  plannedStart: '16:00',
  plannedEnd: '22:00',
  actualStart: '16:00',
  actualEnd: '22:00',
  shiftId: 'shift-1',
  sessionId: 'session-1',
  note: null,
  sessionNote: null,
  standardHours: 5,
  premiumHours: 1,
  multiplier: 1.5,
  effectiveRate: 19.07,
  premiumReason: 'Late close',
  premiumPay: 19.07,
}

describe('PayrollClient pay rates', () => {
  it('shows base and premium rates clearly in the daily breakdown and summary', () => {
    render(
      <PayrollClient
        year={2026}
        month={7}
        rows={[row]}
        employees={[{
          name: 'Amanda Jones',
          plannedHours: 6,
          actualHours: 6,
          hourlyRate: 12.71,
          totalPay: 85.79,
        }]}
        approval={null}
        period={{
          id: 'period-1',
          year: 2026,
          month: 7,
          period_start: '2026-06-25',
          period_end: '2026-07-24',
        }}
        canApprove={false}
        canSend={false}
        canExport={false}
        monthOptions={[{ label: 'July 2026', value: '?year=2026&month=7' }]}
      />,
    )

    expect(screen.getByRole('columnheader', { name: 'Pay rate' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))

    const table = screen.getByRole('table')
    expect(within(table).getByText('£12.71/hr')).toBeInTheDocument()
    expect(within(table).getByText('Premium £19.07/hr')).toBeInTheDocument()
    expect(screen.getByText('£12.71 per hour')).toBeInTheDocument()
  })
})
