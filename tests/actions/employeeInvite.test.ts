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

// The browser session. Account creation signs it in; every step after that reads it.
const sessionUser = { id: 'auth-user-1' as string | null }
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: sessionUser.id ? { id: sessionUser.id } : null } }),
      signInWithPassword: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
      signOut: async () => ({ error: null }),
    },
  })),
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
  sendSeparationStartedEmail: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/audit-helpers'
import { logAuditEvent } from '@/app/actions/audit'
import {
  createEmployeeAccount,
  inviteEmployee,
  revokeEmployeeAccess,
  saveOnboardingSection,
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
const mockedAudit = logAuditEvent as unknown as Mock

function mockMaybeSingle(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  }
}

/** A `.select().eq()` read awaited as it is, with no `.maybeSingle()`. */
function mockSelectList(data: unknown[], error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data, error }),
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

function mockOnboardingSaveClient() {
  const financialUpsert = vi.fn().mockResolvedValue({ error: null })
  const healthUpsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn((table: string) => {
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
        auth_user_id: null,
        email_address: 'employee@example.com',
        status: 'Onboarding',
        first_name: 'Alex',
        last_name: 'Rowe',
      })
    }
    if (table === 'employee_financial_details') {
      return { upsert: financialUpsert }
    }
    if (table === 'employee_health_records') {
      return { upsert: healthUpsert }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { client: { from }, financialUpsert, healthUpsert }
}

describe('employee invite status transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue({ user_id: 'user-1', user_email: 'manager@example.com' })
    mockedAudit.mockResolvedValue(undefined)
    sessionUser.id = 'auth-user-1'
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

    const result = await createEmployeeAccount('token-value', 'a-long-password-1')

    expect(result).toEqual({ success: true })
    expect(createUser).toHaveBeenCalledWith({
      email: 'employee@example.com',
      password: 'a-long-password-1',
      email_confirm: true,
    })
    expect(rpc).toHaveBeenCalledWith('link_employee_invite_account', {
      p_token: 'token-value',
      p_auth_user_id: 'auth-user-1',
    })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('cleans up the auth user when invite account linking fails', async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
    const deleteUser = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Invite changed' } })

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
            auth_user_id: null,
            email_address: 'employee@example.com',
            status: 'Onboarding',
            first_name: 'Alex',
            last_name: 'Rowe',
          })
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
      auth: { admin: { createUser, deleteUser } },
    })

    const result = await createEmployeeAccount('token-value', 'a-long-password-1')

    // Database text is not shown to the starter.
    expect(result).toEqual({
      success: false,
      error: 'We could not create your account just now. Please try again in a moment.',
    })
    expect(rpc).toHaveBeenCalledWith('link_employee_invite_account', {
      p_token: 'token-value',
      p_auth_user_id: 'auth-user-1',
    })
    expect(deleteUser).toHaveBeenCalledWith('auth-user-1')
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
    formData.set('employment_start_date', '2026-12-01')

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
            date_of_birth: '1990-05-01',
          })
        }
        if (table === 'employee_emergency_contacts') {
          return mockSelectList([
            { name: 'Jo Rowe', phone_number: null, mobile_number: '+447700900123', priority: 'Primary' },
          ])
        }
        if (table === 'employee_financial_details') {
          return mockMaybeSingle({ bank_sort_code: '11-22-33', bank_account_number: '12345678' })
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const result = await submitOnboardingProfile('token-value')

    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toContain('Primary emergency contact')
    expect(rpc).toHaveBeenCalledWith('complete_employee_onboarding', { p_token: 'token-value' })
  })

  it('audits onboarding financial writes without sensitive field values', async () => {
    const { client, financialUpsert } = mockOnboardingSaveClient()
    mockedCreateAdminClient.mockReturnValue(client)

    const result = await saveOnboardingSection('token-value', 'financial', {
      ni_number: 'QQ123456C',
      bank_name: 'Test Bank',
      payee_name: 'Alex Rowe',
      branch_address: '1 High Street',
      bank_sort_code: '112233',
      bank_account_number: '12345678',
    })

    // The step is handed back what a reload would show: the numbers masked, the sort code tidied.
    expect(result).toEqual({
      success: true,
      saved: {
        ni_number: '••••••56C',
        bank_sort_code: '11-22-33',
        bank_account_number: '••••5678',
      },
    })
    expect(financialUpsert).toHaveBeenCalled()
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      user_email: 'employee@example.com',
      operation_type: 'update',
      resource_type: 'employee_financial_details',
      resource_id: 'employee-1',
      operation_status: 'success',
      new_values: {
        section: 'financial',
        updated_via: 'employee_onboarding',
      },
    }))
    const auditPayload = mockedAudit.mock.calls.at(-1)?.[0]
    expect(JSON.stringify(auditPayload)).not.toContain('QQ123456C')
    expect(JSON.stringify(auditPayload)).not.toContain('12345678')
  })

  it('audits onboarding health writes without sensitive field values', async () => {
    const { client, healthUpsert } = mockOnboardingSaveClient()
    mockedCreateAdminClient.mockReturnValue(client)

    const result = await saveOnboardingSection('token-value', 'health', {
      doctor_name: 'Dr Sensitive',
      doctor_address: 'Private Surgery',
      has_allergies: true,
      allergies: 'Peanuts',
      had_absence_over_2_weeks_last_3_years: false,
      had_outpatient_treatment_over_3_months_last_3_years: false,
      has_diabetes: false,
      has_epilepsy: false,
      has_skin_condition: false,
      has_depressive_illness: false,
      has_bowel_problems: false,
      has_ear_problems: false,
      is_registered_disabled: false,
    })

    expect(result).toEqual({ success: true })
    expect(healthUpsert).toHaveBeenCalled()
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      user_email: 'employee@example.com',
      operation_type: 'update',
      resource_type: 'employee_health_records',
      resource_id: 'employee-1',
      operation_status: 'success',
      new_values: {
        section: 'health',
        updated_via: 'employee_onboarding',
      },
    }))
    const auditPayload = mockedAudit.mock.calls.at(-1)?.[0]
    expect(JSON.stringify(auditPayload)).not.toContain('Dr Sensitive')
    expect(JSON.stringify(auditPayload)).not.toContain('Peanuts')
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
                    employment_end_date: '2099-05-05',
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
    expect(result.error).toBe('Their last working day is 5 May 2099. They can be marked as Former from that day.')
    expect(employeeUpdate).not.toHaveBeenCalled()
  })
})
