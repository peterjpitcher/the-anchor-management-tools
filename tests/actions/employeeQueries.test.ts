import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/services/employees', () => ({
  EmployeeService: {
    getEmployeesRoster: vi.fn(),
  },
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { getEmployeesRoster } from '@/app/actions/employeeQueries'
import { EmployeeService } from '@/services/employees'

describe('getEmployeesRoster action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns roster employees with current-year holiday counts', async () => {
    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(true)
    ;(EmployeeService.getEmployeesRoster as unknown as vi.Mock).mockResolvedValue({
      employees: [
        {
          employee_id: 'employee-1',
          first_name: 'Alex',
          last_name: 'Rowe',
          email_address: 'alex@example.com',
          job_title: 'Server',
          employment_start_date: '2024-01-10',
          status: 'Active',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          holiday_days_current_year: 7,
        },
      ],
      pagination: {
        page: 1,
        pageSize: 50,
        totalCount: 1,
        totalPages: 1,
      },
      statusCounts: {
        all: 1,
        active: 1,
        former: 0,
        onboarding: 0,
        startedSeparation: 0,
      },
      filters: {
        statusFilter: 'Active',
        searchTerm: '',
      },
    })

    const result = await getEmployeesRoster({ page: 1, pageSize: 50 })

    expect(EmployeeService.getEmployeesRoster).toHaveBeenCalledWith({
      page: 1,
      pageSize: 50,
      searchTerm: '',
      statusFilter: 'Active',
    })
    expect(result.employees[0].holiday_days_current_year).toBe(7)
  })

  it('does not call the service without employees:view permission', async () => {
    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(false)

    const result = await getEmployeesRoster()

    expect(EmployeeService.getEmployeesRoster).not.toHaveBeenCalled()
    expect(result.error).toBe('Insufficient permissions to view employees.')
    expect(result.employees).toEqual([])
  })
})
