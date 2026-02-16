import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { PermissionService } from '@/services/permission'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('PermissionService deleteRole race safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns role-not-found when delete row effect is empty after prefetch', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: { id: 'role-1', name: 'Manager', is_system: false },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table !== 'roles') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          delete: vi.fn().mockReturnValue({ eq: deleteEq }),
        }
      }),
    }

    mockedCreateAdminClient.mockReturnValue(adminClient)

    await expect(PermissionService.deleteRole('role-1')).rejects.toThrow('Role not found')
  })

  it('returns role-not-found when update row effect is empty after prefetch', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: { id: 'role-1', name: 'Manager', is_system: false },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table !== 'roles') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    }

    mockedCreateAdminClient.mockReturnValue(adminClient)

    await expect(PermissionService.updateRole('role-1', 'Manager')).rejects.toThrow('Role not found')
  })
})
