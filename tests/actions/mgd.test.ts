import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import { updateReturnStatus } from '@/app/actions/mgd'
import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

describe('MGD audit logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
    })
  })

  it('logs reopen old and new lifecycle values', async () => {
    const existing = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'paid',
      submitted_at: '2026-06-01T10:00:00.000Z',
      submitted_by: 'user-2',
      date_paid: '2026-06-10',
    }
    const updated = {
      ...existing,
      status: 'open',
      submitted_at: null,
      submitted_by: null,
      date_paid: null,
    }

    const fetchSingle = vi.fn().mockResolvedValue({ data: existing, error: null })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })
    const updateSingle = vi.fn().mockResolvedValue({ data: updated, error: null })
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'mgd_returns') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    const result = await updateReturnStatus({
      id: existing.id,
      status: 'open',
      confirm_reopen_from_paid: true,
    })

    expect('success' in result && result.success).toBe(true)
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      operation_type: 'update',
      resource_type: 'mgd_return',
      resource_id: existing.id,
      operation_status: 'success',
      old_values: {
        status: 'paid',
        submitted_at: '2026-06-01T10:00:00.000Z',
        submitted_by: 'user-2',
        date_paid: '2026-06-10',
      },
      new_values: {
        status: 'open',
        submitted_at: null,
        submitted_by: null,
        date_paid: null,
      },
    }))
  })
})
