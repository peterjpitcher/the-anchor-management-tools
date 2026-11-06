// The employee Holidays tab says what each leave request is (siblings#2).
//
// A new starter lists time off already booked at onboarding, each block as Holiday or "Cannot
// work (not holiday)". The tab listed every request the same way, under "Leave Requests", so a
// manager read days the starter cannot work as holiday, while the allowance above (rightly) left
// them out. Each row now says its type, and which ones came from onboarding.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmployeeHolidaysTab from '@/components/features/employees/EmployeeHolidaysTab'
import type { LeaveRequest } from '@/app/actions/leave'
import { leaveTypeLabel } from '@/lib/employees/leave-type-labels'

vi.mock('@/app/actions/leave', () => ({ bookApprovedHoliday: vi.fn() }))

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'
const ROTA_SETTINGS = { holidayYearStartMonth: 1, holidayYearStartDay: 1, defaultHolidayDays: 28 }

function request(overrides: Partial<LeaveRequest>): LeaveRequest {
  return {
    id: 'leave-1',
    employee_id: EMPLOYEE_ID,
    start_date: '2026-07-01',
    end_date: '2026-07-01',
    note: null,
    status: 'approved',
    manager_note: null,
    reviewed_by: null,
    reviewed_at: null,
    holiday_year: 2026,
    created_at: '2026-06-01T10:00:00+00:00',
    updated_at: '2026-06-01T10:00:00+00:00',
    ...overrides,
  }
}

function renderTab(leaveRequests: LeaveRequest[], canCreateLeave = false) {
  return render(
    <EmployeeHolidaysTab
      employeeId={EMPLOYEE_ID}
      canCreateLeave={canCreateLeave}
      leaveRequests={leaveRequests}
      leaveDays={[]}
      paySettings={null}
      rotaSettings={ROTA_SETTINGS}
    />,
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('EmployeeHolidaysTab leave types', () => {
  it('marks days a starter cannot work as not holiday, and as from onboarding', () => {
    // The list shows the current holiday year, so the clock is pinned to 2026.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-15T10:00:00Z'))
    renderTab([
      request({ id: 'onboarding', leave_type: 'unavailable', leave_origin: 'agreed_at_hire', note: 'Concert for choir' }),
      request({ id: 'holiday', start_date: '2026-08-10', end_date: '2026-08-13', leave_type: 'holiday', leave_origin: 'normal_request' }),
    ])

    expect(screen.getByText('Cannot work (not holiday) · 1 day · From onboarding · Concert for choir')).toBeInTheDocument()
    expect(screen.getByText('Holiday · 4 days')).toBeInTheDocument()
  })

  it('treats a request with no type as holiday, and never shows a new type as holiday', () => {
    expect(leaveTypeLabel(undefined)).toBe('Holiday')
    expect(leaveTypeLabel('unavailable')).toBe('Cannot work (not holiday)')
    expect(leaveTypeLabel('jury_service')).toBe('Jury service')
  })

  it('keeps the Book Holiday note to the 500 characters the server accepts', async () => {
    const user = userEvent.setup()
    renderTab([], true)

    await user.click(screen.getByRole('button', { name: 'Book Holiday' }))

    expect(document.getElementById('book-note')).toHaveAttribute('maxlength', '500')
  })
})

describe('EmployeeHolidaysTab holiday year name', () => {
  function renderWithYearStart(holidayYearStartMonth: number, holidayYearStartDay: number) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-15T10:00:00Z'))
    return render(
      <EmployeeHolidaysTab
        employeeId={EMPLOYEE_ID}
        canCreateLeave={false}
        leaveRequests={[]}
        leaveDays={[]}
        paySettings={null}
        rotaSettings={{ ...ROTA_SETTINGS, holidayYearStartMonth, holidayYearStartDay }}
      />,
    )
  }

  it('names a 1 January holiday year by its single year', () => {
    renderWithYearStart(1, 1)

    // The allowance summary and the request list heading both name the year.
    expect(screen.getAllByText('Holiday year 2026')).toHaveLength(2)
    expect(screen.queryByText(/2026\/27/)).not.toBeInTheDocument()
  })

  it('names a holiday year that crosses new year by both years', () => {
    renderWithYearStart(4, 6)

    // The allowance summary and the request list heading both name the year.
    expect(screen.getAllByText('Holiday year 2026/27')).toHaveLength(2)
  })
})
