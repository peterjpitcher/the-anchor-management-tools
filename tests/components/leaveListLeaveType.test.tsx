// The rota leave manager and the staff portal holiday list: each request says what it is.
//
// A new starter can list days they cannot work at onboarding ("Cannot work (not holiday)"). Both
// lists showed those requests exactly like holiday, so a manager or the starter read them as
// holiday taken. The allowance totals already leave them out; the lists now say so too.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeaveRequest } from '@/app/actions/leave'

const mocks = vi.hoisted(() => ({
  getLeaveRequests: vi.fn(),
  getHolidayUsage: vi.fn(),
  reviewLeaveRequest: vi.fn(),
  updateLeaveRequestDates: vi.fn(),
  deleteLeaveRequest: vi.fn(),
  getRotaSettings: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/portal/leave',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('@/app/actions/leave', () => ({
  getLeaveRequests: mocks.getLeaveRequests,
  getHolidayUsage: mocks.getHolidayUsage,
  reviewLeaveRequest: mocks.reviewLeaveRequest,
  updateLeaveRequestDates: mocks.updateLeaveRequestDates,
  deleteLeaveRequest: mocks.deleteLeaveRequest,
}))
vi.mock('@/app/actions/rota-settings', () => ({ getRotaSettings: mocks.getRotaSettings }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/components/shells/StandaloneShell', () => ({
  StandalonePageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
vi.mock('@/app/(staff-portal)/portal/leave/CancelLeaveRequestButton', () => ({
  CancelLeaveRequestButton: () => null,
}))

import LeaveManagerClient from '@/app/(authenticated)/rota/leave/LeaveManagerClient'
import MyLeavePage from '@/app/(staff-portal)/portal/leave/page'

const EMPLOYEE_ID = '22222222-2222-2222-2222-222222222222'

function leave(id: string, overrides: Partial<LeaveRequest>): LeaveRequest {
  return {
    id,
    employee_id: EMPLOYEE_ID,
    start_date: '2099-07-20',
    end_date: '2099-07-21',
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

const HOLIDAY = leave('11111111-1111-1111-1111-111111111111', { leave_type: 'holiday' })
const CANNOT_WORK = leave('33333333-3333-3333-3333-333333333333', {
  start_date: '2099-08-03',
  end_date: '2099-08-03',
  leave_type: 'unavailable',
  leave_origin: 'agreed_at_hire',
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the rota leave manager', () => {
  it('labels each request as holiday or as days they cannot work', () => {
    render(
      <LeaveManagerClient
        initialRequests={[HOLIDAY, CANNOT_WORK]}
        employeeMap={{ [EMPLOYEE_ID]: 'Alex Rowe' }}
        canApprove
        canEdit
        usageMap={{}}
        holidayYearStart={{ holidayYearStartMonth: 1, holidayYearStartDay: 1 }}
      />,
    )
    // The list opens on pending requests; these are approved.
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Show requests' })).getByText('Approved'))

    // The dates keep their own line, which truncates; the type sits on the line below and wraps.
    // With the type first on the dates line, a phone cut the dates off behind the ellipsis on
    // exactly the rows the type is for.
    const holidayDates = screen.getByText('20 Jul 2099 – 21 Jul 2099 · 2 days')
    const cannotWorkDates = screen.getByText('3 Aug 2099 – 3 Aug 2099 · 1 day')
    expect(holidayDates).toHaveClass('truncate')
    expect(holidayDates.nextElementSibling).toHaveTextContent(/^Holiday$/)
    expect(cannotWorkDates.nextElementSibling).toHaveTextContent(/^Cannot work \(not holiday\)$/)
    expect(cannotWorkDates.nextElementSibling).not.toHaveClass('truncate')
  })
})

describe('the staff portal holiday list', () => {
  it('labels each request as holiday or as days they cannot work', async () => {
    const single = vi.fn().mockResolvedValue({ data: { employee_id: EMPLOYEE_ID, first_name: 'Alex', last_name: 'Rowe' } })
    const chain: Record<string, unknown> = { single }
    for (const method of ['select', 'eq', 'in']) chain[method] = () => chain
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: () => chain,
    })
    mocks.getRotaSettings.mockResolvedValue({ holidayYearStartMonth: 4, holidayYearStartDay: 1, defaultHolidayDays: 28 })
    mocks.getLeaveRequests.mockResolvedValue({ success: true, data: [HOLIDAY, CANNOT_WORK] })
    mocks.getHolidayUsage.mockResolvedValue({ success: true, count: 2, pendingCount: 0, allowance: 28, overThreshold: false })

    render(await MyLeavePage())

    expect(screen.getByText('Holiday · 2 days')).toBeInTheDocument()
    expect(screen.getByText('Cannot work (not holiday) · 1 day')).toBeInTheDocument()
  })
})
