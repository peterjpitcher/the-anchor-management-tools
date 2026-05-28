import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const insert = vi.fn()
  const from = vi.fn(() => ({ insert }))
  const getUserById = vi.fn()
  const headers = vi.fn()

  return { insert, from, getUserById, headers }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        getUserById: mocks.getUserById,
      },
    },
    from: mocks.from,
  })),
}))

vi.mock('next/headers', () => ({
  headers: mocks.headers,
}))

import { AuditService } from '@/services/audit'

const CANONICAL_AUDIT_LOG_KEYS = new Set([
  'user_id',
  'user_email',
  'operation_type',
  'resource_type',
  'resource_id',
  'operation_status',
  'ip_address',
  'user_agent',
  'old_values',
  'new_values',
  'error_message',
  'additional_info',
])

describe('AuditService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insert.mockResolvedValue({ error: null })
    mocks.getUserById.mockResolvedValue({
      data: { user: { email: 'manager@example.com' } },
      error: null,
    })
    mocks.headers.mockResolvedValue({
      get: (key: string) => {
        if (key === 'user-agent') return 'vitest-agent'
        if (key === 'x-forwarded-for') return '203.0.113.1, 10.0.0.1'
        return null
      },
    })
  })

  it('writes only canonical audit_logs columns', async () => {
    await AuditService.logAuditEvent({
      user_id: 'user-1',
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: 'invoice-1',
      operation_status: 'success',
      additional_info: { reminder_type: 'overdue' },
    })

    expect(mocks.from).toHaveBeenCalledWith('audit_logs')
    expect(mocks.insert).toHaveBeenCalledOnce()

    const payload = mocks.insert.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload).every(key => CANONICAL_AUDIT_LOG_KEYS.has(key))).toBe(true)
    expect(payload).toMatchObject({
      user_id: 'user-1',
      user_email: 'manager@example.com',
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: 'invoice-1',
      operation_status: 'success',
      additional_info: { reminder_type: 'overdue' },
      ip_address: '203.0.113.1',
      user_agent: 'vitest-agent',
    })
    expect(payload).not.toHaveProperty('entity_type')
    expect(payload).not.toHaveProperty('entity_id')
    expect(payload).not.toHaveProperty('operation_details')
    expect(payload).not.toHaveProperty('metadata')
    expect(payload).not.toHaveProperty('action')
  })
})
