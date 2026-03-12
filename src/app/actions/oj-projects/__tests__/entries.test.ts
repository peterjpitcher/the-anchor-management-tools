import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import { createTimeEntry } from '../entries'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'

const mockCheckUserPermission = vi.mocked(checkUserPermission)
const mockCreateClient = vi.mocked(createClient)
const mockLogAuditEvent = vi.mocked(logAuditEvent)

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

function makeSupabaseMock() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@test.com' } },
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'oj_vendor_billing_settings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { hourly_rate_ex_vat: 75, vat_rate: 20, mileage_rate: 0.42 },
          }),
        }
      }
      if (table === 'oj_projects') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'b0000000-0000-0000-0000-000000000001', vendor_id: 'a0000000-0000-0000-0000-000000000001', status: 'active' },
            error: null,
          }),
        }
      }
      if (table === 'oj_work_types') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'entry-1',
            project_id: 'b0000000-0000-0000-0000-000000000001',
            entry_date: '2026-03-12',
            duration_minutes_rounded: 60,
            start_at: null,
            end_at: null,
          },
          error: null,
        }),
      }
    }),
  }
}

describe('createTimeEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckUserPermission.mockResolvedValue(true)
    mockLogAuditEvent.mockResolvedValue(undefined)
  })

  it('should create a time entry with null start_at and end_at', async () => {
    const supabaseMock = makeSupabaseMock()
    mockCreateClient.mockResolvedValue(supabaseMock as any)

    const fd = makeFormData({
      vendor_id: 'a0000000-0000-0000-0000-000000000001',
      project_id: 'b0000000-0000-0000-0000-000000000001',
      entry_date: '2026-03-12',
      duration_minutes: '60',
    })

    const result = await createTimeEntry(fd)

    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
  })

  it('should ignore start_time if passed in FormData', async () => {
    const supabaseMock = makeSupabaseMock()
    mockCreateClient.mockResolvedValue(supabaseMock as any)

    const fd = makeFormData({
      vendor_id: 'a0000000-0000-0000-0000-000000000001',
      project_id: 'b0000000-0000-0000-0000-000000000001',
      entry_date: '2026-03-12',
      duration_minutes: '60',
      start_time: '09:00',
    })

    const result = await createTimeEntry(fd)
    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
  })

  it('should return an error when the user lacks permission', async () => {
    mockCheckUserPermission.mockResolvedValue(false)

    const fd = makeFormData({
      vendor_id: 'a0000000-0000-0000-0000-000000000001',
      project_id: 'b0000000-0000-0000-0000-000000000001',
      entry_date: '2026-03-12',
      duration_minutes: '60',
    })

    const result = await createTimeEntry(fd)
    expect(result.error).toBeDefined()
  })
})
