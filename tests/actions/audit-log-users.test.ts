/**
 * The "User" filter on the audit log page.
 *
 * It used to read every audit_logs row that had a user (8,644 today, growing about 4,100 a
 * month) and de-duplicate them in JavaScript. Supabase caps a request at 1,000 rows and says
 * nothing, so the dropdown listed 11 of the 26 staff in the log and the other 15 could not be
 * selected. The distinct now lives in the database function get_audit_log_users.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

const checkUserPermission = vi.hoisted(() => vi.fn())
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission }))

import { listAuditLogUsers } from '@/app/actions/auditLogs'

type RpcRow = { user_id: string; user_email: string | null }

const rpc = vi.fn()

function buildUsers(count: number): RpcRow[] {
  // Ordered by user_id, the way the function's DISTINCT ON has to return them.
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(2, '0')
    return {
      user_id: `00000000-0000-0000-0000-0000000000${suffix}`,
      user_email: `staff${suffix}@the-anchor.pub`,
    }
  })
}

describe('listAuditLogUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    checkUserPermission.mockResolvedValue(true)
    createAdminClient.mockReturnValue({ rpc })
  })

  it('returns every user the database function returns', async () => {
    const users = buildUsers(26)
    rpc.mockResolvedValue({ data: users, error: null })

    const result = await listAuditLogUsers()

    expect(rpc).toHaveBeenCalledWith('get_audit_log_users')
    expect(result.error).toBeUndefined()
    expect(result.users).toHaveLength(26)
    expect(result.users?.map((user) => user.user_id).sort()).toEqual(
      users.map((user) => user.user_id).sort(),
    )
    expect(result.users?.every((user) => Boolean(user.user_email))).toBe(true)
  })

  it('sorts the list by email so the dropdown stays alphabetical', async () => {
    rpc.mockResolvedValue({
      data: [
        { user_id: '00000000-0000-0000-0000-000000000001', user_email: 'zoe@the-anchor.pub' },
        { user_id: '00000000-0000-0000-0000-000000000002', user_email: 'adam@the-anchor.pub' },
        { user_id: '00000000-0000-0000-0000-000000000003', user_email: null },
      ],
      error: null,
    })

    const result = await listAuditLogUsers()

    expect(result.users?.map((user) => user.user_email)).toEqual([
      'adam@the-anchor.pub',
      'zoe@the-anchor.pub',
      null,
    ])
  })

  it('refuses a user without the settings permission', async () => {
    checkUserPermission.mockResolvedValue(false)

    const result = await listAuditLogUsers()

    expect(result).toEqual({ error: 'You do not have permission to view audit logs' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reports a failure rather than an empty dropdown when the function errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } })

    const result = await listAuditLogUsers()

    expect(result).toEqual({ error: 'Failed to load users' })
  })
})
