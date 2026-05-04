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
import {
  beginSeparation,
  createEmployeeAccount,
  inviteEmployee,
  revokeEmployeeAccess,
  sendPortalInvite,
  submitOnboardingProfile,
  validateInviteToken,
} from '@/app/actions/employeeInvite'
import { sendPortalInviteEmail, sendWelcomeEmail } from '@/lib/email/employee-invite-emails'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock
const mockedSendWelcomeEmail = sendWelcomeEmail as unknown as Mock
const mockedSendPortalInviteEmail = sendPortalInviteEmail as unknown as Mock

function mockMaybeSingle(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  }
}

function mockInsertSingle(data: unknown, error: unknown = null) {
  return {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  }
}

function mockExpireSiblingsChain() {
  const neq = vi.fn().mockResolvedValue({ error: null })
  const is = vi.fn().mockReturnValue({ neq })
  const secondEq = vi.fn().mockReturnValue({ is })
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
  return {
    update: vi.fn().mockReturnValue({ eq: firstEq }),
    firstEq,
    secondEq,
    is,
    neq,
  }
}

describe('employee invite status transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue({ user_id: 'user-1', user_email: 'manager@example.com' })
  })

  it('rejects stale invite tokens when the employee email has changed', async () => {
    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'employee_invite_tokens') {
          return mockMaybeSingle({
            id: 'token-1',
            employee_id: 'employee-1',
            email: 'old@example.com',
            invite_type: 'onboarding',
            expires_at: '2099-01-01T00:00:00.000Z',
            completed_at: null,
          })
        }
        if (table === 'employees') {
          return mockMaybeSingle({
            auth_user_id: null,
            email_address: 'new@example.com',
            status: 'Onboarding',
            first_name: null,
            last_name: null,
          })
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await validateInviteToken('token-value')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('email address')
    expect(result.inviteType).toBe('onboarding')
  })

  it('links portal access accounts through the invite RPC so the token is completed atomically', async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
    const deleteUser = vi.fn()
    const rpc = vi.fn().mockResolvedValue({ data: { employee_id: 'employee-1' }, error: null })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'employee_invite_tokens') {
          return mockMaybeSingle({
            id: 'token-1',
            employee_id: 'employee-1',
            email: 'employee@example.com',
            invite_type: 'portal_access',
            expires_at: '2099-01-01T00:00:00.000Z',
            completed_at: null,
          })
        }
        if (table === 'employees') {
          return mockMaybeSingle({
            auth_user_id: null,
            email_address: 'employee@example.com',
            status: 'Active',
            first_name: 'Alex',
            last_name: 'Rowe',
          })
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
      auth: { admin: { createUser, deleteUser } },
    })

    const result = await createEmployeeAccount('token-value', 'password123')

    expect(result).toEqual({ success: true })
    expect(createUser).toHaveBeenCalledWith({
      email: 'employee@example.com',
      password: 'password123',
      email_confirm: true,
    })
    expect(rpc).toHaveBeenCalledWith('link_employee_invite_account', {
      p_token: 'token-value',
      p_auth_user_id: 'auth-user-1',
    })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('does not leave a blank onboarding employee when the first invite email fails', async () => {
    mockedSendWelcomeEmail.mockRejectedValue(new Error('mail down'))

    const employeeDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    })
    const rpc = vi.fn().mockResolvedValue({
      data: { employee_id: 'employee-1', token: 'token-value' },
      error: null,
    })

    mockedCreateAdminClient.mockReturnValue({
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'employees') {
          return { delete: employeeDelete }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const formData = new FormData()
    formData.set('email', 'new-starter@example.com')
    formData.set('job_title', 'Bartender')

    const result = await inviteEmployee(null, formData)

    expect(result.type).toBe('error')
    expect(employeeDelete).toHaveBeenCalled()
  })

  it('sends portal access tokens without creating an onboarding token and expires older portal links after email succeeds', async () => {
    mockedSendPortalInviteEmail.mockResolvedValue(undefined)
    const tokenInsert = mockInsertSingle({ token: 'portal-token' })
    const expiryChain = mockExpireSiblingsChain()

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'employees') {
          return mockMaybeSingle({
            email_address: 'employee@example.com',
            auth_user_id: null,
            status: 'Active',
          })
        }
        if (table === 'employee_invite_tokens') {
          return {
            insert: tokenInsert.insert,
            update: expiryChain.update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await sendPortalInvite('employee-1')

    expect(result.type).toBe('success')
    expect(tokenInsert.insert).toHaveBeenCalledWith({
      employee_id: 'employee-1',
      email: 'employee@example.com',
      invite_type: 'portal_access',
    })
    expect(expiryChain.secondEq).toHaveBeenCalledWith('invite_type', 'portal_access')
    expect(expiryChain.neq).toHaveBeenCalledWith('token', 'portal-token')
  })

  it('surfaces onboarding completion RPC validation errors without activating locally', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Primary emergency contact must be completed before submitting.' },
    })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'employee_invite_tokens') {
          return mockMaybeSingle({
            id: 'token-1',
            employee_id: 'employee-1',
            email: 'employee@example.com',
            invite_type: 'onboarding',
            expires_at: '2099-01-01T00:00:00.000Z',
            completed_at: null,
          })
        }
        if (table === 'employees') {
          return mockMaybeSingle({
            auth_user_id: 'auth-user-1',
            email_address: 'employee@example.com',
            status: 'Onboarding',
            first_name: 'Alex',
            last_name: 'Rowe',
          })
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const result = await submitOnboardingProfile('token-value')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Primary emergency contact')
    expect(rpc).toHaveBeenCalledWith('complete_employee_onboarding', { p_token: 'token-value' })
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
