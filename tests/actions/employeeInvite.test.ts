import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

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

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/lib/email/employee-invite-emails', () => ({
  sendWelcomeEmail: vi.fn(),
  sendChaseEmail: vi.fn(),
  sendOnboardingCompleteEmail: vi.fn(),
  sendPortalInviteEmail: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/audit-helpers'
import { beginSeparation, revokeEmployeeAccess } from '@/app/actions/employeeInvite'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock

describe('employee invite status transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue({ user_id: 'user-1', user_email: 'manager@example.com' })
  })

  it('begins separation with a last working day and employee note', async () => {
    const employeeUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ employee_id: 'employee-1' }], error: null }),
        }),
      }),
    })
    const noteInsert = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'employees') {
          return { update: employeeUpdate }
        }
        if (table === 'employee_notes') {
          return { insert: noteInsert }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await beginSeparation('employee-1', {
      employmentEndDate: '2026-05-15',
      note: 'Notice given',
    })

    expect(result).toEqual({ success: true })
    expect(employeeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'Started Separation',
      employment_end_date: '2026-05-15',
    }))
    expect(noteInsert).toHaveBeenCalledWith(expect.objectContaining({
      employee_id: 'employee-1',
      note_text: expect.stringContaining('Last working day: 2026-05-15.'),
    }))
  })

  it('does not mark an employee as former before their recorded last working day', async () => {
    const employeeUpdate = vi.fn()

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'employees') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    auth_user_id: null,
                    email_address: 'employee@example.com',
                    status: 'Started Separation',
                    employment_end_date: '2026-05-15',
                  },
                  error: null,
                }),
              }),
            }),
            update: employeeUpdate,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      auth: { admin: { deleteUser: vi.fn() } },
    })

    const result = await revokeEmployeeAccess('employee-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('recorded last working day')
    expect(employeeUpdate).not.toHaveBeenCalled()
  })
})
