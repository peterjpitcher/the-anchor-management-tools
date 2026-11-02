// The employee roster's counts, labels and export (FF-57).
//
// The count beside the search box showed the rows on this page, not everyone who matched; the
// export ignored the search box and reported the page size as the number exported; "(pending)"
// showed for someone named only by a preferred name; the badge under the On Notice tab said
// Started Separation; and one day of holiday read "1 days".
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const exportMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/PermissionContext', () => ({ usePermissions: () => ({ hasPermission: () => true }) }))
vi.mock('@/app/actions/employeeExport', () => ({ exportEmployees: exportMock }))
vi.mock('@/app/actions/employeeInvite', () => ({ sendPortalInvite: vi.fn(), inviteEmployee: vi.fn() }))
vi.mock('@/ds', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/ds')>()
  return { ...original, toast: toastMock }
})

import EmployeesClient from '@/app/(authenticated)/employees/_components/EmployeesClient'
import type { EmployeeRosterResult } from '@/app/actions/employeeQueries'
import type { EmployeeRosterEmployee } from '@/services/employees'

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList)
  window.URL.createObjectURL = vi.fn(() => 'blob:export')
  window.URL.revokeObjectURL = vi.fn()
  // The download link's click would ask jsdom to navigate, which it cannot.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

beforeEach(() => {
  vi.clearAllMocks()
})

function rosterEmployee(overrides: Partial<EmployeeRosterEmployee>): EmployeeRosterEmployee {
  return {
    employee_id: 'e1', first_name: 'Sam', last_name: 'Rowe', preferred_name: null, email_address: 'sam@example.com',
    job_title: 'Bar Staff', employment_start_date: '2026-01-01', status: 'Active', auth_user_id: 'auth-1',
    holiday_days_current_year: 0,
    ...overrides,
  }
}

function roster(employees: EmployeeRosterEmployee[], totalCount: number, searchTerm = ''): EmployeeRosterResult {
  return {
    employees,
    pagination: { page: 1, pageSize: 50, totalCount, totalPages: Math.ceil(totalCount / 50) },
    statusCounts: { all: totalCount, active: totalCount, former: 0, onboarding: 0, startedSeparation: 1 },
    filters: { statusFilter: 'Active', searchTerm },
  }
}

const permissions = { canCreate: true, canExport: true, canEdit: true }

describe('the employee roster', () => {
  it('counts everyone who matches, not the rows on this page', () => {
    render(<EmployeesClient initialData={roster([rosterEmployee({})], 73)} permissions={permissions} />)

    expect(screen.getByText('73 employees')).toBeInTheDocument()
  })

  it('says On Notice, "1 day", and no "(pending)" for someone named by a preferred name only', () => {
    render(
      <EmployeesClient
        initialData={roster([
          rosterEmployee({ employee_id: 'e1', status: 'Started Separation', holiday_days_current_year: 1 }),
          rosterEmployee({ employee_id: 'e2', first_name: null, last_name: null, preferred_name: 'Mandy', email_address: 'mandy@example.com' }),
          rosterEmployee({ employee_id: 'e3', first_name: null, last_name: null, email_address: 'new@example.com', status: 'Onboarding' }),
        ], 3)}
        permissions={permissions}
      />,
    )

    expect(screen.getAllByText('On Notice').length).toBeGreaterThan(0)
    expect(screen.queryByText('Started Separation')).not.toBeInTheDocument()
    expect(screen.getByText('1 day')).toBeInTheDocument()
    expect(screen.queryByText('1 days')).not.toBeInTheDocument()
    // Only the starter with no name at all is pending.
    expect(screen.getAllByText('(pending)')).toHaveLength(1)
    expect(screen.getByText('new@example.com')).toBeInTheDocument()
  })

  it('exports with the search box, and reports how many are in the file', async () => {
    const user = userEvent.setup()
    exportMock.mockResolvedValue({ data: 'csv', filename: 'employees.csv', count: 2 })
    render(<EmployeesClient initialData={roster([rosterEmployee({})], 73, 'Rowe')} permissions={permissions} />)

    await user.click(screen.getAllByRole('button', { name: 'More' })[0])
    await user.click(await screen.findByText('Export CSV'))

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
    expect(exportMock).toHaveBeenCalledWith({ format: 'csv', statusFilter: 'Active', searchTerm: 'Rowe' })
    expect(toastMock.success).toHaveBeenCalledWith('Exported 2 employees')
  })
})
