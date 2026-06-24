import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/app/actions/rota-settings', () => ({
  getRotaSettings: vi.fn(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/rota/email-templates', () => ({
  buildHolidaySubmittedEmailHtml: vi.fn(),
  buildHolidayDecisionEmailHtml: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { getRotaSettings } from '@/app/actions/rota-settings'
import { cancelOwnLeaveRequest, deleteLeaveRequest, updateLeaveRequestDates } from '@/app/actions/leave'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock
const mockedGetRotaSettings = getRotaSettings as unknown as Mock

const REQUEST_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_REQUEST_ID = '22222222-2222-2222-2222-222222222222'
const EMPLOYEE_ID = '33333333-3333-3333-3333-333333333333'

function chain() {
  const query: Record<string, Mock> = {}
  query.eq = vi.fn(() => query)
  query.neq = vi.fn(() => query)
  query.lte = vi.fn(() => query)
  query.gte = vi.fn(() => query)
  query.in = vi.fn(() => query)
  query.select = vi.fn(() => query)
  query.maybeSingle = vi.fn()
  query.single = vi.fn()
  return query
}

function mockUpdateClient(options: {
  request?: {
    id: string
    employee_id: string
    status: 'pending' | 'approved' | 'declined'
    start_date?: string
    end_date?: string
    note?: string | null
    manager_note?: string | null
    reviewed_by?: string | null
    reviewed_at?: string | null
    holiday_year?: number
    created_at?: string
    updated_at?: string
  } | null
  fetchError?: { code?: string; message: string } | null
  overlapping?: Array<{ id: string }>
  overlappingError?: { message: string } | null
} = {}) {
  const fetchQuery = chain()
  fetchQuery.single.mockResolvedValue({
    data: options.request === undefined
      ? {
          id: REQUEST_ID,
          employee_id: EMPLOYEE_ID,
          status: 'approved',
          start_date: '2026-06-10',
          end_date: '2026-06-12',
          note: null,
          manager_note: null,
          reviewed_by: null,
          reviewed_at: '2026-05-01T09:00:00Z',
          holiday_year: 2026,
          created_at: '2026-05-01T09:00:00Z',
          updated_at: '2026-05-01T09:00:00Z',
        }
      : options.request,
    error: options.fetchError ?? null,
  })

  const overlapQuery = chain()
  overlapQuery.gte.mockResolvedValue({
    data: options.overlapping ?? [],
    error: options.overlappingError ?? null,
  })

  const leaveRequestsTable = {
    select: vi.fn((columns: string) => {
      if (columns === 'id, employee_id, status, start_date, end_date, note, manager_note, reviewed_by, reviewed_at, holiday_year, created_at, updated_at') return fetchQuery
      if (columns === 'id') return overlapQuery
      throw new Error(`Unexpected select columns: ${columns}`)
    }),
  }

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'manager@example.com' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'leave_requests') return leaveRequestsTable
      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  mockedCreateClient.mockResolvedValue(client)
  return { client, fetchQuery, overlapQuery }
}

function mockDeleteClient(options: {
  data?: {
    id: string
    employee_id: string
    start_date: string
    end_date: string
    note: string | null
    status: 'pending' | 'approved' | 'declined'
    manager_note: string | null
    reviewed_by: string | null
    reviewed_at: string | null
    holiday_year: number
    created_at: string
    updated_at: string
  } | null
  error?: { code?: string; message: string } | null
} = {}) {
  const deleteQuery = chain()
  deleteQuery.single.mockResolvedValue({
    data: options.data === undefined
      ? {
          id: REQUEST_ID,
          employee_id: EMPLOYEE_ID,
          start_date: '2026-06-10',
          end_date: '2026-06-12',
          note: null,
          status: 'approved',
          manager_note: null,
          reviewed_by: null,
          reviewed_at: '2026-05-01T09:00:00Z',
          holiday_year: 2026,
          created_at: '2026-05-01T09:00:00Z',
          updated_at: '2026-05-01T09:00:00Z',
        }
      : options.data,
    error: options.error ?? null,
  })

  const leaveRequestsTable = {
    delete: vi.fn(() => deleteQuery),
  }

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'manager@example.com' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'leave_requests') return leaveRequestsTable
      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  mockedCreateClient.mockResolvedValue(client)
  return { client, deleteQuery }
}

function mockCancelOwnClient(options: {
  user?: { id: string; email?: string | null } | null
  employee?: { employee_id: string } | null
  employeeError?: { message: string } | null
  deletedRequest?: {
    id: string
    employee_id: string
    start_date: string
    end_date: string
    note: string | null
    status: 'pending' | 'approved' | 'declined'
    manager_note: string | null
    reviewed_by: string | null
    reviewed_at: string | null
    holiday_year: number
    created_at: string
    updated_at: string
  } | null
  deleteError?: { message: string } | null
} = {}) {
  const employeeQuery = chain()
  employeeQuery.maybeSingle.mockResolvedValue({
    data: options.employee === undefined ? { employee_id: EMPLOYEE_ID } : options.employee,
    error: options.employeeError ?? null,
  })

  const deleteQuery = chain()
  deleteQuery.maybeSingle.mockResolvedValue({
    data: options.deletedRequest === undefined
      ? {
          id: REQUEST_ID,
          employee_id: EMPLOYEE_ID,
          start_date: '2026-06-10',
          end_date: '2026-06-12',
          note: null,
          status: 'pending',
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          holiday_year: 2026,
          created_at: '2026-05-01T09:00:00Z',
          updated_at: '2026-05-01T09:00:00Z',
        }
      : options.deletedRequest,
    error: options.deleteError ?? null,
  })

  const employeesTable = {
    select: vi.fn(() => employeeQuery),
  }
  const leaveRequestsTable = {
    delete: vi.fn(() => deleteQuery),
  }
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user === undefined ? { id: 'user-1', email: 'employee@example.com' } : options.user },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'employees') return employeesTable
      if (table === 'leave_requests') return leaveRequestsTable
      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  mockedCreateClient.mockResolvedValue(client)
  return { client, employeeQuery, deleteQuery }
}

describe('leave actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetRotaSettings.mockResolvedValue({
      holidayYearStartMonth: 4,
      holidayYearStartDay: 1,
      defaultHolidayDays: 28,
    })
  })

  describe('updateLeaveRequestDates', () => {
    it('returns permission denied without leave edit permission', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await updateLeaveRequestDates(REQUEST_ID, '2026-06-16', '2026-06-24')

      expect(result).toEqual({ success: false, error: 'Permission denied' })
      expect(mockedCreateClient).not.toHaveBeenCalled()
      expect(mockedCreateAdminClient).not.toHaveBeenCalled()
    })

    it('rejects an invalid date range before loading the request', async () => {
      mockedPermission.mockResolvedValue(true)

      const result = await updateLeaveRequestDates(REQUEST_ID, '2026-06-24', '2026-06-16')

      expect(result).toEqual({ success: false, error: 'End date must be on or after start date' })
      expect(mockedCreateClient).not.toHaveBeenCalled()
      expect(mockedCreateAdminClient).not.toHaveBeenCalled()
    })

    it('rejects declined holiday requests', async () => {
      mockedPermission.mockResolvedValue(true)
      mockUpdateClient({
        request: { id: REQUEST_ID, employee_id: EMPLOYEE_ID, status: 'declined' },
      })

      const result = await updateLeaveRequestDates(REQUEST_ID, '2026-06-16', '2026-06-24')

      expect(result).toEqual({ success: false, error: 'Declined holiday requests cannot be edited' })
      expect(mockedCreateAdminClient).not.toHaveBeenCalled()
    })

    it('rejects overlaps with other non-declined leave requests', async () => {
      mockedPermission.mockResolvedValue(true)
      mockUpdateClient({ overlapping: [{ id: OTHER_REQUEST_ID }] })

      const result = await updateLeaveRequestDates(REQUEST_ID, '2026-06-16', '2026-06-24')

      expect(result).toEqual({ success: false, error: 'Employee already has leave covering some of these dates' })
      expect(mockedCreateAdminClient).not.toHaveBeenCalled()
    })

    it('updates dates through the atomic RPC and recalculates the holiday year', async () => {
      mockedPermission.mockResolvedValue(true)
      mockUpdateClient()
      const rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null })
      mockedCreateAdminClient.mockReturnValue({ rpc })

      const result = await updateLeaveRequestDates(REQUEST_ID, '2026-03-30', '2026-04-02')

      expect(result).toEqual({ success: true })
      expect(rpc).toHaveBeenCalledWith('update_leave_request_dates', {
        p_request_id: REQUEST_ID,
        p_start_date: '2026-03-30',
        p_end_date: '2026-04-02',
        p_holiday_year: 2025,
      })
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        operation_type: 'update',
        resource_type: 'leave_request',
        resource_id: REQUEST_ID,
        new_values: {
          start_date: '2026-03-30',
          end_date: '2026-04-02',
          holiday_year: 2025,
        },
      }))
    })

    it('maps RPC business failures to action errors', async () => {
      mockedPermission.mockResolvedValue(true)
      mockUpdateClient()
      const rpc = vi.fn().mockResolvedValue({
        data: { success: false, code: 'overlap', error: 'Employee already has leave covering some of these dates' },
        error: null,
      })
      mockedCreateAdminClient.mockReturnValue({ rpc })

      const result = await updateLeaveRequestDates(REQUEST_ID, '2026-06-16', '2026-06-24')

      expect(result).toEqual({ success: false, error: 'Employee already has leave covering some of these dates' })
    })
  })

  describe('deleteLeaveRequest', () => {
    it('returns permission denied without leave edit permission', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await deleteLeaveRequest(REQUEST_ID)

      expect(result).toEqual({ success: false, error: 'Permission denied' })
      expect(mockedCreateClient).not.toHaveBeenCalled()
    })

    it('deletes the leave request row and relies on FK cascade for leave days', async () => {
      mockedPermission.mockResolvedValue(true)
      const { client, deleteQuery } = mockDeleteClient()

      const result = await deleteLeaveRequest(REQUEST_ID)

      expect(result).toEqual({ success: true })
      expect(client.from).toHaveBeenCalledTimes(1)
      expect(client.from).toHaveBeenCalledWith('leave_requests')
      expect(client.from).not.toHaveBeenCalledWith('leave_days')
      expect(deleteQuery.eq).toHaveBeenCalledWith('id', REQUEST_ID)
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        operation_type: 'delete',
        resource_type: 'leave_request',
        resource_id: REQUEST_ID,
      }))
    })

    it('returns a friendly not-found error when no request is deleted', async () => {
      mockedPermission.mockResolvedValue(true)
      mockDeleteClient({
        data: null,
        error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      })

      const result = await deleteLeaveRequest(REQUEST_ID)

      expect(result).toEqual({ success: false, error: 'Request not found' })
    })
  })

  describe('cancelOwnLeaveRequest', () => {
    it('deletes only the signed-in employee pending request', async () => {
      const { deleteQuery } = mockCancelOwnClient()

      const result = await cancelOwnLeaveRequest(REQUEST_ID)

      expect(result).toEqual({ success: true })
      expect(deleteQuery.eq).toHaveBeenCalledWith('id', REQUEST_ID)
      expect(deleteQuery.eq).toHaveBeenCalledWith('employee_id', EMPLOYEE_ID)
      expect(deleteQuery.eq).toHaveBeenCalledWith('status', 'pending')
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-1',
        operation_type: 'cancel',
        resource_type: 'leave_request',
        resource_id: REQUEST_ID,
        additional_info: { source: 'staff_portal' },
      }))
    })

    it('rejects requests that are not pending or not owned by the employee', async () => {
      mockCancelOwnClient({ deletedRequest: null })

      const result = await cancelOwnLeaveRequest(REQUEST_ID)

      expect(result).toEqual({ success: false, error: 'Only pending holiday requests can be cancelled' })
    })
  })
})
