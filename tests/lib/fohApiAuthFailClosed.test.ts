import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/lib/api/permissions', () => ({
  requireModulePermission: vi.fn(async () => ({
    ok: true,
    userId: 'user-1',
    supabase: { rpc: mocks.rpc },
  })),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() } }))

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'

describe('requireBohTableBookingPermission (BK-205)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses with 503 and logs when the permission lookup errors', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'fetch failed' } })

    const result = await requireBohTableBookingPermission('edit')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(503)
    }
    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
  })

  it('still lets a normal BOH user through', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ module_name: 'table_bookings', action: 'edit' }, { module_name: 'events', action: 'view' }],
      error: null,
    })
    const result = await requireBohTableBookingPermission('edit')
    expect(result.ok).toBe(true)
  })
})
