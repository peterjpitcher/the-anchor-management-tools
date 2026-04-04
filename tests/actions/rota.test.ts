import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('next/server', () => ({
  after: vi.fn((fn: () => void) => fn()),
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

vi.mock('@/lib/rota/send-rota-emails', () => ({
  sendRotaWeekEmails: vi.fn(),
  sendRotaWeekChangeEmails: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'
import {
  getOrCreateRotaWeek,
  getWeekShifts,
  createShift,
  deleteShift,
  updateShift,
} from '@/app/actions/rota'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSupabaseClient(overrides: Record<string, unknown> = {}) {
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'staff@example.com' } },
        error: null,
      }),
    },
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: '', message: 'Permission denied' } }),
        }),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
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
  mockedCreateClient.mockResolvedValue(client)
  return client
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Rota actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // getOrCreateRotaWeek
  // -----------------------------------------------------------------------

  describe('getOrCreateRotaWeek', () => {
    it('should return permission denied when user lacks rota view permission', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await getOrCreateRotaWeek('2026-04-06')
      expect(result).toEqual({ success: false, error: 'Permission denied' })
    })

    it('should reject a weekStart that is not a Monday', async () => {
      mockedPermission.mockResolvedValue(true)

      const result = await getOrCreateRotaWeek('2026-04-08') // Wednesday
      expect(result).toEqual({ success: false, error: 'weekStart must be a Monday' })
    })

    it('should return existing week on unique violation (concurrent insert)', async () => {
      // First call: view permission, second call: edit permission
      mockedPermission
        .mockResolvedValueOnce(true) // view
        .mockResolvedValueOnce(true) // edit

      const existingWeek = {
        id: 'week-1',
        week_start: '2026-04-06',
        status: 'draft',
        published_at: null,
        published_by: null,
        has_unpublished_changes: false,
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-01T00:00:00Z',
      }

      const client = mockSupabaseClient()

      // Override from() for this specific test
      client.from = vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '23505', message: 'duplicate key' },
            }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: existingWeek, error: null }),
          }),
        }),
      })

      const result = await getOrCreateRotaWeek('2026-04-06')
      expect(result).toEqual({ success: true, data: existingWeek })
    })
  })

  // -----------------------------------------------------------------------
  // getWeekShifts
  // -----------------------------------------------------------------------

  describe('getWeekShifts', () => {
    it('should return permission denied when user lacks rota view permission', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await getWeekShifts('2026-04-06')
      expect(result).toEqual({ success: false, error: 'Permission denied' })
    })

    it('should return shifts for valid week', async () => {
      mockedPermission.mockResolvedValue(true)

      const shifts = [
        { id: 'shift-1', shift_date: '2026-04-06', start_time: '09:00' },
        { id: 'shift-2', shift_date: '2026-04-07', start_time: '10:00' },
      ]

      const client = mockSupabaseClient()
      client.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: shifts, error: null }),
              }),
            }),
          }),
        }),
      })

      const result = await getWeekShifts('2026-04-06')
      expect(result).toEqual({ success: true, data: shifts })
    })

    it('should return error when Supabase query fails', async () => {
      mockedPermission.mockResolvedValue(true)

      const client = mockSupabaseClient()
      client.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
              }),
            }),
          }),
        }),
      })

      const result = await getWeekShifts('2026-04-06')
      expect(result).toEqual({ success: false, error: 'DB error' })
    })
  })

  // -----------------------------------------------------------------------
  // createShift
  // -----------------------------------------------------------------------

  describe('createShift', () => {
    const validInput = {
      weekId: '550e8400-e29b-41d4-a716-446655440000',
      employeeId: '660e8400-e29b-41d4-a716-446655440000',
      shiftDate: '2026-04-06',
      startTime: '09:00',
      endTime: '17:00',
      unpaidBreakMinutes: 30,
      department: 'FOH',
      isOpenShift: false,
      isOvernight: false,
    }

    it('should return permission denied when user lacks rota create permission', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await createShift(validInput)
      expect(result).toEqual({ success: false, error: 'Permission denied' })
    })

    it('should reject invalid input (missing department)', async () => {
      mockedPermission.mockResolvedValue(true)

      const result = await createShift({
        ...validInput,
        department: '', // invalid — min length 1
      })

      expect(result.success).toBe(false)
    })

    it('should reject shift date outside rota week range', async () => {
      mockedPermission.mockResolvedValue(true)

      const client = mockSupabaseClient()
      // Mock week lookup returning week_start of 2026-04-06
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'rota_weeks') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { week_start: '2026-04-06' },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }
      })

      const result = await createShift({
        ...validInput,
        shiftDate: '2026-04-20', // outside week range
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Shift date must be within this rota week')
      }
    })

    it('should create shift successfully and log audit event', async () => {
      mockedPermission.mockResolvedValue(true)

      const createdShift = { id: 'shift-new', ...validInput }

      const client = mockSupabaseClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'rota_weeks') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { week_start: '2026-04-06' },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        if (table === 'rota_shifts') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: createdShift,
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      const result = await createShift(validInput)
      expect(result.success).toBe(true)
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'create',
          resource_type: 'rota_shift',
        }),
      )
    })
  })

  // -----------------------------------------------------------------------
  // deleteShift
  // -----------------------------------------------------------------------

  describe('deleteShift', () => {
    it('should return permission denied when user lacks rota delete permission', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await deleteShift('shift-1')
      expect(result).toEqual({ success: false, error: 'Permission denied' })
    })

    it('should delete shift and log audit event', async () => {
      mockedPermission.mockResolvedValue(true)

      const client = mockSupabaseClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'rota_shifts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { week_id: 'week-1', employee_id: 'emp-1', shift_date: '2026-04-06' },
                  error: null,
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        if (table === 'rota_weeks') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      const result = await deleteShift('shift-1')
      expect(result).toEqual({ success: true })
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'delete',
          resource_type: 'rota_shift',
          resource_id: 'shift-1',
        }),
      )
    })

    it('should return error when Supabase delete fails', async () => {
      mockedPermission.mockResolvedValue(true)

      const client = mockSupabaseClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'rota_shifts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { week_id: 'week-1', employee_id: 'emp-1', shift_date: '2026-04-06' },
                  error: null,
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: { message: 'FK violation' } }),
            }),
          }
        }
        return {}
      })

      const result = await deleteShift('shift-1')
      expect(result).toEqual({ success: false, error: 'FK violation' })
    })
  })

  // -----------------------------------------------------------------------
  // updateShift
  // -----------------------------------------------------------------------

  describe('updateShift', () => {
    it('should return permission denied when user lacks rota edit permission', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await updateShift('shift-1', { start_time: '10:00' })
      expect(result).toEqual({ success: false, error: 'Permission denied' })
    })

    it('should update shift successfully', async () => {
      mockedPermission.mockResolvedValue(true)

      const updatedShift = {
        id: 'shift-1',
        week_id: 'week-1',
        start_time: '10:00',
        end_time: '17:00',
      }

      const client = mockSupabaseClient()
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'rota_shifts') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: updatedShift, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'rota_weeks') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      const result = await updateShift('shift-1', { start_time: '10:00' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.start_time).toBe('10:00')
      }
    })
  })
})
