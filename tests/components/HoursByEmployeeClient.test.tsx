import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HoursByEmployeeClient, {
  type HoursEmployeeOption,
  type WeeklyHoursRow,
} from '@/app/(authenticated)/rota/hours/HoursByEmployeeClient'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/rota/hours',
}))

const employees: HoursEmployeeOption[] = [
  { id: 'employee-1', name: 'Amanda Jones', role: 'Bar', totalHours: 32, holidayDays: 1, sickDays: 0 },
  { id: 'employee-2', name: 'Ben Cole', role: 'Kitchen', totalHours: 20, holidayDays: 0, sickDays: 1 },
]

const chartData: WeeklyHoursRow[] = [
  { weekStart: '2026-09-07', weekLabel: '7 Sep', 'employee-1': 16, __holidayDays: 1, __holidayDetails: [], __sickDays: 0, __sickDetails: [] },
  { weekStart: '2026-09-14', weekLabel: '14 Sep', 'employee-1': 16, __holidayDays: 0, __holidayDetails: [], __sickDays: 0, __sickDetails: [] },
]

function renderReport() {
  return render(
    <HoursByEmployeeClient
      employees={employees}
      selectedEmployeeIds={['employee-1']}
      fromDate="2026-09-07"
      toDate="2026-09-20"
      chartData={chartData}
      series={[{ employeeId: 'employee-1', name: 'Amanda Jones', colour: 'var(--color-chart-1)', totalHours: 32 }]}
      totalHours={32}
      totalHolidayDays={1}
      totalSickDays={0}
      holidaySummaries={[{ employeeId: 'employee-1', name: 'Amanda Jones', colour: 'var(--color-chart-1)', holidayDays: 1, dates: ['2026-09-08'] }]}
      sickSummaries={[]}
      completedSessionCount={4}
      openSessionCount={0}
      weekCount={2}
    />,
  )
}

describe('HoursByEmployeeClient', () => {
  it('draws the weekly hours on the design-system chart, named for screen readers', () => {
    renderReport()

    expect(screen.getByRole('figure', {
      name: "Hours per week for 1 employee, with holiday and Couldn't Work days",
    })).toBeInTheDocument()
  })

  it('picks employees in a panel that Done closes', async () => {
    renderReport()

    fireEvent.click(screen.getByRole('button', { name: /Employees/ }))

    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByLabelText('Search employees')).toBeInTheDocument()
    expect(within(panel).getByRole('checkbox', { name: /Amanda Jones/ })).toBeChecked()

    fireEvent.click(within(panel).getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
