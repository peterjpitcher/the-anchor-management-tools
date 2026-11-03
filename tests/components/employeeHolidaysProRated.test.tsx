// The employee Holidays tab pro-rates the allowance for a starter or leaver, and gives a leaver's
// untaken holiday for their final pay.
//
// It showed the whole yearly allowance to everyone, so a starter in October read 25 days when they
// had earned about 6, and a leaver's final pay had no figure for the holiday they had not taken.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import EmployeeHolidaysTab from '@/components/features/employees/EmployeeHolidaysTab'
import type { EmployeeLeaveDay } from '@/app/actions/leave'
import { getLeaveDates } from '@/lib/leave/working-days'

vi.mock('@/app/actions/leave', () => ({ bookApprovedHoliday: vi.fn() }))

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'
const ROTA_SETTINGS = { holidayYearStartMonth: 1, holidayYearStartDay: 1, defaultHolidayDays: 25 }

function approvedDays(startDate: string, endDate: string): EmployeeLeaveDay[] {
  return getLeaveDates(startDate, endDate).map((leave_date) => ({
    request_id: `request-${startDate}`,
    leave_date,
    status: 'approved',
    leave_type: 'holiday',
    consumes_allowance: true,
  }))
}

function renderTab(options: {
  leaveDays?: EmployeeLeaveDay[]
  employmentStartDate?: string | null
  employmentEndDate?: string | null
}) {
  return render(
    <EmployeeHolidaysTab
      employeeId={EMPLOYEE_ID}
      canCreateLeave={false}
      leaveRequests={[]}
      leaveDays={options.leaveDays ?? []}
      paySettings={null}
      rotaSettings={ROTA_SETTINGS}
      employmentStartDate={options.employmentStartDate ?? null}
      employmentEndDate={options.employmentEndDate ?? null}
    />,
  )
}

beforeEach(() => {
  // The tab opens on the current holiday year, so the clock is pinned inside 2026.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-03T10:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EmployeeHolidaysTab pro-rating', () => {
  it('shows the whole allowance, and nothing about final pay, for someone employed all year', () => {
    renderTab({ employmentStartDate: '2024-03-01' })

    expect(screen.getByText('0 / 25 days')).toBeInTheDocument()
    expect(screen.queryByText(/Pro-rated from/)).not.toBeInTheDocument()
    expect(screen.queryByText('Holiday for their final pay')).not.toBeInTheDocument()
  })

  it('pro-rates a starter to the share of the year left after they started', () => {
    renderTab({ employmentStartDate: '2026-10-01' })

    // 1 October to 31 December is 92 of 365 days: 25 x 92 / 365 = 6.3.
    expect(screen.getByText('0 / 6.3 days')).toBeInTheDocument()
    expect(screen.getByText('Pro-rated from 25 days a year, for 1 Oct 2026 to 31 Dec 2026.')).toBeInTheDocument()
    expect(screen.getByText('6.3 days remaining')).toBeInTheDocument()
  })

  it("gives a leaver's untaken holiday to their last working day, ignoring leave after it", () => {
    renderTab({
      employmentStartDate: '2025-05-01',
      employmentEndDate: '2026-10-28',
      // Twelve days before the last day, and a week after it that is not theirs to take.
      leaveDays: [...approvedDays('2026-07-01', '2026-07-12'), ...approvedDays('2026-11-01', '2026-11-07')],
    })

    // 1 January to 28 October is 301 of 365 days: 25 x 301 / 365 = 20.6, less 12 taken.
    expect(screen.getByText('Holiday for their final pay')).toBeInTheDocument()
    expect(
      screen.getByText('8.6 days earned but not taken by their last working day, 28 Oct 2026, to include in their final pay.'),
    ).toBeInTheDocument()
  })

  it('says when a leaver took more holiday than they had earned', () => {
    renderTab({
      employmentStartDate: '2026-03-01',
      employmentEndDate: '2026-04-30',
      leaveDays: approvedDays('2026-04-01', '2026-04-10'),
    })

    // 1 March to 30 April is 61 of 365 days: 25 x 61 / 365 = 4.2, and they took 10.
    expect(
      screen.getByText('They took 5.8 days more than they had earned by their last working day, 30 Apr 2026. Check their final pay.'),
    ).toBeInTheDocument()
  })
})
