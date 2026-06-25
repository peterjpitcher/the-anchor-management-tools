import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { EmergencyContactSchema, employeeSchema, EmployeeService } from '@/services/employees'

describe('EmployeeService CSV export', () => {
  it('prefixes spreadsheet formula trigger characters in exported cells', () => {
    const csv = EmployeeService.generateCSV([
      {
        employee_id: 'employee-1',
        first_name: '=cmd',
        last_name: '+SUM(A1:A2)',
        email_address: '@risk.test',
        job_title: '-Danger',
        address: '\tTabbed',
        post_code: '\rCarriage',
      } as any,
    ], ['first_name', 'last_name', 'email_address', 'job_title', 'address', 'post_code'])

    expect(csv).toContain("'=cmd")
    expect(csv).toContain("'+SUM(A1:A2)")
    expect(csv).toContain("'@risk.test")
    expect(csv).toContain("'-Danger")
    expect(csv).toContain("'\tTabbed")
    expect(csv).toContain("'\rCarriage")
  })

  it('formats exported dates in London time', () => {
    const csv = EmployeeService.generateCSV([
      {
        employee_id: 'employee-1',
        employment_start_date: '2026-07-14T23:30:00.000Z',
      } as any,
    ], ['employment_start_date'])

    expect(csv).toContain('15/07/2026')
  })
})

describe('employee phone validation', () => {
  it('normalises employee phone fields to E.164 before storage', () => {
    const parsed = employeeSchema.parse({
      first_name: 'Jacob',
      last_name: 'Williams',
      email_address: 'jacob@example.com',
      job_title: 'Bartender',
      employment_start_date: '2026-05-22',
      status: 'Active',
      phone_number: '020 7946 0000',
      mobile_number: '07561 773635',
    })

    expect(parsed.phone_number).toBe('+442079460000')
    expect(parsed.mobile_number).toBe('+447561773635')
  })

  it('normalises emergency contact phone fields to E.164 before storage', () => {
    const parsed = EmergencyContactSchema.parse({
      employee_id: '3f24f3f6-26bb-4a53-a29a-07b6acffad4f',
      name: 'Emergency Contact',
      phone_number: '020 7946 0000',
      mobile_number: '07561 773635',
      priority: 'Primary',
    })

    expect(parsed.phone_number).toBe('+442079460000')
    expect(parsed.mobile_number).toBe('+447561773635')
  })

  it('rejects invalid employee phone fields', () => {
    const parsed = employeeSchema.safeParse({
      first_name: 'Jacob',
      last_name: 'Williams',
      email_address: 'jacob@example.com',
      job_title: 'Bartender',
      employment_start_date: '2026-05-22',
      status: 'Active',
      mobile_number: 'not a phone number',
    })

    expect(parsed.success).toBe(false)
  })
})

describe('EmployeeService delete safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when employee update affects no rows after prefetch', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        employee_id: 'employee-1',
        status: 'Active',
        date_of_birth: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    const mockFrom = vi.fn((table: string) => {
      if (table !== 'employees') {
        throw new Error(`Unexpected table: ${table}`)
      }

      return {
        select: vi.fn().mockReturnValue({ eq: fetchEq }),
        update: vi.fn().mockReturnValue({ eq: updateEq }),
      }
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: mockFrom,
      storage: { from: vi.fn() },
    })

    await expect(
      EmployeeService.updateEmployee('employee-1', {
        first_name: 'Alex',
        last_name: 'Rowe',
        email_address: 'alex@example.com',
        job_title: 'Server',
        employment_start_date: '2026-02-14',
        status: 'Active',
      })
    ).rejects.toThrow('Employee not found or failed to update.')
  })

  it('blocks direct separation through the generic employee edit path', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        employee_id: 'employee-1',
        status: 'Active',
        date_of_birth: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })
    const update = vi.fn()

    const mockFrom = vi.fn((table: string) => {
      if (table !== 'employees') {
        throw new Error(`Unexpected table: ${table}`)
      }

      return {
        select: vi.fn().mockReturnValue({ eq: fetchEq }),
        update,
      }
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: mockFrom,
      storage: { from: vi.fn() },
    })

    await expect(
      EmployeeService.updateEmployee('employee-1', {
        first_name: 'Alex',
        last_name: 'Rowe',
        email_address: 'alex@example.com',
        job_title: 'Server',
        employment_start_date: '2026-02-14',
        status: 'Former',
      })
    ).rejects.toThrow('Use the "Mark as Former" action')

    expect(update).not.toHaveBeenCalled()
  })

  it('blocks direct reactivation of former employees through the generic employee edit path', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        employee_id: 'employee-1',
        status: 'Former',
        date_of_birth: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })
    const update = vi.fn()

    const mockFrom = vi.fn((table: string) => {
      if (table !== 'employees') {
        throw new Error(`Unexpected table: ${table}`)
      }

      return {
        select: vi.fn().mockReturnValue({ eq: fetchEq }),
        update,
      }
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: mockFrom,
      storage: { from: vi.fn() },
    })

    await expect(
      EmployeeService.updateEmployee('employee-1', {
        first_name: 'Alex',
        last_name: 'Rowe',
        email_address: 'alex@example.com',
        job_title: 'Server',
        employment_start_date: '2026-02-14',
        status: 'Active',
      })
    ).rejects.toThrow('Former employees cannot be reactivated')

    expect(update).not.toHaveBeenCalled()
  })

  it('throws when employee delete affects no rows after prefetch', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        employee_id: 'employee-1',
        date_of_birth: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    const mockFrom = vi.fn((table: string) => {
      if (table !== 'employees') {
        throw new Error(`Unexpected table: ${table}`)
      }

      return {
        select: vi.fn().mockReturnValue({ eq: fetchEq }),
        delete: vi.fn().mockReturnValue({ eq: deleteEq }),
      }
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: mockFrom,
      storage: { from: vi.fn() },
    })

    await expect(EmployeeService.deleteEmployee('employee-1')).rejects.toThrow(
      'Employee not found or failed to delete.'
    )
  })

  it('deletes attachment files using the DB storage path, not caller input', async () => {
    const mockStorageRemove = vi.fn().mockResolvedValue({ error: null })
    const mockSelectSingle = vi.fn().mockResolvedValue({
      data: {
        file_name: 'handbook.pdf',
        storage_path: 'employee-1/handbook.pdf',
      },
      error: null,
    })

    const mockSelectEqEmployee = vi.fn().mockReturnValue({ single: mockSelectSingle })
    const mockSelectEqAttachment = vi.fn().mockReturnValue({ eq: mockSelectEqEmployee })
    const mockDeleteEq = vi.fn().mockResolvedValue({ error: null })

    const mockFrom = vi.fn((table: string) => {
      if (table === 'employee_attachments') {
        return {
          select: vi.fn().mockReturnValue({ eq: mockSelectEqAttachment }),
          delete: vi.fn().mockReturnValue({ eq: mockDeleteEq }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: mockFrom,
      storage: {
        from: vi.fn().mockReturnValue({ remove: mockStorageRemove }),
      },
    })

    await EmployeeService.deleteEmployeeAttachment('attachment-1', 'employee-1')

    expect(mockSelectEqAttachment).toHaveBeenCalledWith('attachment_id', 'attachment-1')
    expect(mockSelectEqEmployee).toHaveBeenCalledWith('employee_id', 'employee-1')
    expect(mockStorageRemove).toHaveBeenCalledWith(['employee-1/handbook.pdf'])
  })

  it('restores the DB photo path when right-to-work storage delete fails', async () => {
    const mockStorageRemove = vi.fn().mockResolvedValue({
      error: { message: 'storage temporarily unavailable' },
    })

    const mockSelectSingle = vi.fn().mockResolvedValue({
      data: { photo_storage_path: 'employee-1/rtw-proof.pdf' },
      error: null,
    })
    const mockSelectEq = vi.fn().mockReturnValue({ single: mockSelectSingle })

    const mockClearSelect = vi.fn().mockResolvedValue({
      data: [{ employee_id: 'employee-1' }],
      error: null,
    })
    const mockClearEqPhoto = vi.fn().mockReturnValue({ select: mockClearSelect })
    const mockClearEqEmployee = vi.fn().mockReturnValue({ eq: mockClearEqPhoto })

    const mockRollbackIs = vi.fn().mockResolvedValue({ error: null })
    const mockRollbackEqEmployee = vi.fn().mockReturnValue({ is: mockRollbackIs })

    const mockUpdate = vi.fn((payload: { photo_storage_path: string | null }) => {
      if (payload.photo_storage_path === null) {
        return { eq: mockClearEqEmployee }
      }

      return { eq: mockRollbackEqEmployee }
    })

    const mockFrom = vi.fn((table: string) => {
      if (table === 'employee_right_to_work') {
        return {
          select: vi.fn().mockReturnValue({ eq: mockSelectEq }),
          update: mockUpdate,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: mockFrom,
      storage: {
        from: vi.fn().mockReturnValue({ remove: mockStorageRemove }),
      },
    })

    await expect(EmployeeService.deleteRightToWorkPhoto('employee-1')).rejects.toThrow(
      'Failed to delete photo from storage.'
    )

    expect(mockStorageRemove).toHaveBeenCalledWith(['employee-1/rtw-proof.pdf'])
    expect(mockUpdate).toHaveBeenCalledWith({ photo_storage_path: null })
    expect(mockUpdate).toHaveBeenCalledWith({ photo_storage_path: 'employee-1/rtw-proof.pdf' })
    expect(mockRollbackIs).toHaveBeenCalledWith('photo_storage_path', null)
  })
})

describe('EmployeeService.getEmployeesRoster holiday counts', () => {
  const employeeOne = {
    employee_id: 'employee-1',
    first_name: 'Alex',
    last_name: 'Rowe',
    email_address: 'alex@example.com',
    job_title: 'Server',
    employment_start_date: '2024-01-10',
    status: 'Active',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  const employeeTwo = {
    employee_id: 'employee-2',
    first_name: 'Blake',
    last_name: 'Smith',
    email_address: 'blake@example.com',
    job_title: 'Bartender',
    employment_start_date: '2024-02-10',
    status: 'Active',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  function setupRosterMock({
    employees = [employeeOne, employeeTwo],
    leaveDays = [],
  }: {
    employees?: Array<typeof employeeOne>
    leaveDays?: Array<{ employee_id: string; leave_date: string }>
  } = {}) {
    const statusRows = employees.map((employee) => ({ status: employee.status }))

    const filteredCountIn = vi.fn().mockResolvedValue({
      count: employees.length,
      error: null,
    })
    const filteredDataIn = vi.fn().mockResolvedValue({
      data: employees,
      error: null,
    })
    const range = vi.fn().mockReturnValue({
      in: filteredDataIn,
    })
    const order = vi.fn().mockReturnValue({
      range,
    })
    const employeesSelect = vi.fn((columns: string, options?: { count?: string }) => {
      if (columns === 'status') {
        return Promise.resolve({ data: statusRows, error: null })
      }
      if (columns === '*' && options?.count === 'exact') {
        return { in: filteredCountIn }
      }
      if (columns === '*') {
        return { order }
      }

      throw new Error(`Unexpected employees select: ${columns}`)
    })

    const leaveStatusEq = vi.fn().mockResolvedValue({
      data: leaveDays,
      error: null,
    })
    const leaveDateLte = vi.fn().mockReturnValue({
      eq: leaveStatusEq,
    })
    const leaveDateGte = vi.fn().mockReturnValue({
      lte: leaveDateLte,
    })
    const leaveEmployeeIn = vi.fn().mockReturnValue({
      gte: leaveDateGte,
    })
    const leaveDaysSelect = vi.fn().mockReturnValue({
      in: leaveEmployeeIn,
    })

    const mockFrom = vi.fn((table: string) => {
      if (table === 'employees') {
        return { select: employeesSelect }
      }
      if (table === 'leave_days') {
        return { select: leaveDaysSelect }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: mockFrom,
    })

    return {
      filteredCountIn,
      filteredDataIn,
      leaveDaysSelect,
      leaveEmployeeIn,
      leaveDateGte,
      leaveDateLte,
      leaveStatusEq,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts approved leave days in the current calendar year for displayed employees', async () => {
    const calls = setupRosterMock({
      leaveDays: [
        { employee_id: 'employee-1', leave_date: '2026-01-15' },
        { employee_id: 'employee-1', leave_date: '2026-12-24' },
      ],
    })

    const result = await EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50 })

    expect(result.employees).toHaveLength(2)
    expect(result.employees.find((employee) => employee.employee_id === 'employee-1')).toMatchObject({
      holiday_days_current_year: 2,
    })
    expect(result.employees.find((employee) => employee.employee_id === 'employee-2')).toMatchObject({
      holiday_days_current_year: 0,
    })
    expect(calls.leaveDaysSelect).toHaveBeenCalledWith('employee_id, leave_date, leave_requests!inner(status)')
    expect(calls.leaveEmployeeIn).toHaveBeenCalledWith('employee_id', ['employee-1', 'employee-2'])
    expect(calls.leaveDateGte).toHaveBeenCalledWith('leave_date', '2026-01-01')
    expect(calls.leaveDateLte).toHaveBeenCalledWith('leave_date', '2026-12-31')
    expect(calls.leaveStatusEq).toHaveBeenCalledWith('leave_requests.status', 'approved')
  })

  it('does not query leave days when the roster page is empty', async () => {
    const calls = setupRosterMock({ employees: [] })

    const result = await EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50 })

    expect(result.employees).toEqual([])
    expect(calls.leaveDaysSelect).not.toHaveBeenCalled()
  })
})
