import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PayrollSummaryBar } from '@/app/(authenticated)/rota/payroll/PayrollSummaryBar'
import type { PayrollRow } from '@/lib/rota/excel-export'

function payrollRow(overrides: Partial<PayrollRow>): PayrollRow {
  return {
    employeeName: 'Amanda Jones',
    employeeId: 'employee-1',
    date: '2020-01-06',
    department: 'bar',
    plannedHours: 6,
    actualHours: 3,
    hourlyRate: 12.71,
    totalPay: 38.13,
    flags: '',
    plannedStart: '16:00',
    plannedEnd: '22:00',
    actualStart: '16:00',
    actualEnd: '19:00',
    shiftId: 'shift-1',
    sessionId: 'session-1',
    note: null,
    sessionNote: null,
    standardHours: 3,
    premiumHours: 0,
    multiplier: null,
    effectiveRate: 12.71,
    premiumReason: null,
    premiumPay: 0,
    ...overrides,
  }
}

describe('PayrollSummaryBar figures', () => {
  it('colours the variance by how far under plan it is and money earned as success', () => {
    // A shift long past, so it is always inside the cycle so far.
    render(<PayrollSummaryBar rows={[payrollRow({})]} />)

    expect(screen.getByText('-3.0h')).toHaveClass('text-warning-fg')
    expect(screen.getByText('under planned')).toBeInTheDocument()
    expect(screen.getByText('£38.13')).toHaveClass('text-success-fg')
  })

  it('leaves the figures uncoloured before any shift has reached today', () => {
    render(<PayrollSummaryBar rows={[payrollRow({ date: '2999-01-04' })]} />)

    const placeholders = screen.getAllByText('–')
    expect(placeholders).toHaveLength(4)
    for (const placeholder of placeholders) {
      expect(placeholder).toHaveClass('text-text')
      expect(placeholder).not.toHaveClass('text-success-fg')
    }
  })
})
