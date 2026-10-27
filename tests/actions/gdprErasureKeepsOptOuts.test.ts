import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * A GDPR erasure keeps the guest's opt-outs (BK-161): it runs the same shared path as 'Delete
 * customer', writing the suppression list before vouchers are unlinked or anything is erased.
 */

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/services/gdpr', () => ({
  GdprService: { resolveErasureSubject: vi.fn(), deleteUserData: vi.fn(), exportUserData: vi.fn() },
}))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GdprService } from '@/services/gdpr'
import { deleteUserData } from '@/app/actions/gdpr'

const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('GDPR erasure action', () => {
  const order: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    order.length = 0
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1', email: 'owner@example.com' } } }) },
    })
    ;(GdprService.resolveErasureSubject as Mock).mockResolvedValue({
      profileId: null, profileEmail: null, customerIds: ['customer-1'], emails: [], phones: ['+447700900001'],
    })
    ;(GdprService.deleteUserData as Mock).mockImplementation(async () => {
      order.push('erase')
      return { counts: { customers: 1 }, unscrubbedRows: 0, message: 'Personal data erased. customers: 1.' }
    })
  })

  function adminWith(suppressionError: unknown = null) {
    const builder: Record<string, unknown> = {}
    for (const method of ['update', 'in', 'eq']) builder[method] = vi.fn(() => builder)
    builder.select = vi.fn(async () => {
      order.push('vouchers')
      return { data: [], error: null }
    })
    return {
      rpc: vi.fn(async (name: string) => {
        if (name === 'get_user_roles') return { data: [{ role_name: 'super_admin' }], error: null }
        order.push(name)
        return { data: suppressionError ? null : 2, error: suppressionError }
      }),
      from: vi.fn(() => builder),
    }
  }

  it('records the opt-outs as a GDPR erasure before anything is erased', async () => {
    const admin = adminWith()
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await deleteUserData('customer-1')

    expect(result).toEqual({ success: true, message: 'Personal data erased. customers: 1.' })
    expect(admin.rpc).toHaveBeenCalledWith('record_customer_contact_suppression', {
      p_customer_ids: ['customer-1'],
      p_source: 'gdpr_erasure',
    })
    expect(order[0]).toBe('record_customer_contact_suppression')
    expect(order.indexOf('erase')).toBeGreaterThan(order.indexOf('vouchers'))
  })

  it('erases nothing when the opt-outs cannot be kept', async () => {
    mockedCreateAdminClient.mockReturnValue(adminWith({ code: '42501', message: 'permission denied' }))

    const result = await deleteUserData('customer-1')

    expect(result.error).toContain("Could not keep the customer's opt-outs before erasing them")
    expect(GdprService.deleteUserData).not.toHaveBeenCalled()
    expect(order).not.toContain('vouchers')
  })
})
