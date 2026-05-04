import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('date-fns-tz', () => ({
  toZonedTime: vi.fn((d: Date) => d),
  fromZonedTime: vi.fn((d: Date | string) => new Date(d)),
  formatInTimeZone: vi.fn((_d: Date, _tz: string, fmt: string) => {
    if (fmt === 'yyyy-MM-dd') return '2026-04-06'
    if (fmt === 'HH:mm') return '09:00'
    return '2026-04-06'
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import {
  clockIn,
  clockOut,
  getOpenSessions,
  createTimeclockSession,
  deleteTimeclockSession,
} from '@/app/actions/timeclock'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAdminClient(overrides: Record<string, unknown> = {}) {
  const client = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
        is: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
    ...overrides,
  }
  mockedCreateAdminClient.mockReturnValue(client)
  return client
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Timeclock actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // clockIn
  // -----------------------------------------------------------------------

  describe('clockIn', () => {
    it('should return error when employee is not found', async () => {
      const client = mockAdminClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'employees') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }
        }
        return { select: vi.fn() }
      })

      const result = await clockIn('nonexistent-id')
      expect(result).toEqual({ success: false, error: 'Employee not found' })
    })

    it('should return error when employee is not active', async () => {
      const client = mockAdminClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'employees') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { employee_id: 'emp-1', status: 'Inactive' },
                  error: null,
                }),
              }),
            }),
          }
        }
        return { select: vi.fn() }
      })

      const result = await clockIn('emp-1')
      expect(result).toEqual({ success: false, error: 'Employee is not active' })
    })

    it('should return error when employee is already clocked in', async () => {
      const client = mockAdminClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'employees') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { employee_id: 'emp-1', status: 'Active' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'timeclock_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { id: 'session-existing' },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return { select: vi.fn() }
      })

      const result = await clockIn('emp-1')
      expect(result).toEqual({
        success: false,
        error: 'Already clocked in. Please clock out first.',
      })
    })

    it.each(['Active', 'Started Separation'])('should clock in %s employees and log audit event', async (status) => {
      const session = {
        id: 'session-1',
        employee_id: 'emp-1',
        work_date: '2026-04-06',
        clock_in_at: '2026-04-06T08:00:00Z',
        clock_out_at: null,
      }

      const client = mockAdminClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'employees') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { employee_id: 'emp-1', status },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'timeclock_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: session, error: null }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        if (table === 'rota_shifts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'payroll_periods') {
          return {
            select: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }
        }
        return { select: vi.fn() }
      })

      const result = await clockIn('emp-1')
      expect(result.success).toBe(true)
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'clock_in',
          resource_type: 'timeclock_session',
        }),
      )
    })
  })

  // -----------------------------------------------------------------------
  // clockOut
  // -----------------------------------------------------------------------

  describe('clockOut', () => {
    it('should return error when no open session found', async () => {
      const client = mockAdminClient()
      client.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
            }),
          }),
        }),
      })

      const result = await clockOut('emp-1')
      expect(result).toEqual({ success: false, error: 'No open clock-in session found.' })
    })

    it('should clock out successfully', async () => {
      const updatedSession = {
        id: 'session-1',
        employee_id: 'emp-1',
        work_date: '2026-04-06',
        clock_out_at: '2026-04-06T17:00:00Z',
      }

      const client = mockAdminClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'timeclock_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'session-1', work_date: '2026-04-06' },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: updatedSession, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'payroll_periods') {
          return {
            select: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }
        }
        return { select: vi.fn() }
      })

      const result = await clockOut('emp-1')
      expect(result.success).toBe(true)
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'clock_out',
          resource_type: 'timeclock_session',
        }),
      )
    })
  })

  // -----------------------------------------------------------------------
  // createTimeclockSession (manual entry)
  // -----------------------------------------------------------------------

  describe('createTimeclockSession', () => {
    it('should return permission denied when user cannot manage timeclock', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await createTimeclockSession('emp-1', '2026-04-06', '09:00', '17:00')
      expect(result).toEqual({ success: false, error: 'Permission denied' })
    })

    it('should reject invalid clock-in time format', async () => {
      mockedPermission.mockResolvedValue(true)

      const result = await createTimeclockSession('emp-1', '2026-04-06', 'invalid', '17:00')
      expect(result).toEqual({ success: false, error: 'Invalid clock-in time' })
    })

    it('should reject invalid clock-out time format', async () => {
      mockedPermission.mockResolvedValue(true)

      const result = await createTimeclockSession('emp-1', '2026-04-06', '09:00', 'bad')
      expect(result).toEqual({ success: false, error: 'Invalid clock-out time' })
    })

    it('should create session successfully', async () => {
      mockedPermission.mockResolvedValue(true)

      const sessionData = {
        id: 'session-new',
        employee_id: 'emp-1',
        work_date: '2026-04-06',
        clock_in_at: '2026-04-06T08:00:00Z',
        clock_out_at: '2026-04-06T16:00:00Z',
        employees: { first_name: 'John', last_name: 'Doe' },
      }

      const client = mockAdminClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'timeclock_sessions') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: sessionData, error: null }),
              }),
            }),
          }
        }
        if (table === 'payroll_periods') {
          return {
            select: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }
        }
        return { select: vi.fn() }
      })

      const result = await createTimeclockSession('emp-1', '2026-04-06', '09:00', '17:00')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.employee_name).toBe('John Doe')
      }
    })
  })

  // -----------------------------------------------------------------------
  // deleteTimeclockSession
  // -----------------------------------------------------------------------

  describe('deleteTimeclockSession', () => {
    it('should return permission denied when user cannot manage timeclock', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await deleteTimeclockSession('session-1')
      expect(result).toEqual({ success: false, error: 'Permission denied' })
    })

    it('should delete session successfully', async () => {
      mockedPermission.mockResolvedValue(true)

      const client = mockAdminClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'timeclock_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { work_date: '2026-04-06' },
                  error: null,
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        if (table === 'payroll_periods') {
          return {
            select: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }
        }
        if (table === 'payroll_month_approvals') {
          return {
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        return { select: vi.fn() }
      })

      const result = await deleteTimeclockSession('session-1')
      expect(result).toEqual({ success: true })
    })

    it('should return error when Supabase delete fails', async () => {
      mockedPermission.mockResolvedValue(true)

      const client = mockAdminClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'timeclock_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { work_date: '2026-04-06' },
                  error: null,
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: { message: 'constraint error' } }),
            }),
          }
        }
        return { select: vi.fn() }
      })

      const result = await deleteTimeclockSession('session-1')
      expect(result).toEqual({ success: false, error: 'constraint error' })
    })
  })
})
