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
  sendSeparationStartedEmail: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/audit-helpers'
import { logAuditEvent } from '@/app/actions/audit'
import {
  beginSeparation,
  createEmployeeAccount,
  inviteEmployee,
  revokeEmployeeAccess,
  saveOnboardingSection,
  sendPortalInvite,
  submitOnboardingProfile,
  validateInviteToken,
} from '@/app/actions/employeeInvite'
import { sendPortalInviteEmail, sendSeparationStartedEmail, sendWelcomeEmail } from '@/lib/email/employee-invite-emails'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock
const mockedSendWelcomeEmail = sendWelcomeEmail as unknown as Mock
const mockedSendPortalInviteEmail = sendPortalInviteEmail as unknown as Mock
const mockedSendSeparationStartedEmail = sendSeparationStartedEmail as unknown as Mock
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

    expect(result).toEqual({ success: true })
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

  it('begins separation with a last working day and employee note', async () => {
    const employeeSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            email_address: 'alex@example.com',
            first_name: 'Alex',
            last_name: 'Rowe',
            employment_end_date: null,
            status: 'Active',
          },
          error: null,
        }),
      }),
    })
    const employeeUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ employee_id: 'employee-1' }], error: null }),
        }),
      }),
    })
    const shiftsOrderByStart = vi.fn().mockResolvedValue({
      data: [{
        shift_date: '2099-05-14',
        start_time: '09:00',
        end_time: '17:00',
        department: 'bar',
      }],
      error: null,
    })
    const shiftsOrderByDate = vi.fn().mockReturnValue({ order: shiftsOrderByStart })
    const shiftsNeq = vi.fn().mockReturnValue({ order: shiftsOrderByDate })
    const shiftsLte = vi.fn().mockReturnValue({ neq: shiftsNeq })
    const shiftsGte = vi.fn().mockReturnValue({ lte: shiftsLte })
    const shiftsEq = vi.fn().mockReturnValue({ gte: shiftsGte })
    const shiftsSelect = vi.fn().mockReturnValue({ eq: shiftsEq })
    const noteInsert = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'employees') {
          return { select: employeeSelect, update: employeeUpdate }
        }
        if (table === 'rota_shifts') {
          return { select: shiftsSelect }
        }
        if (table === 'employee_notes') {
          return { insert: noteInsert }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await beginSeparation('employee-1', {
      employmentEndDate: '2099-05-15',
      note: 'Notice given',
    })

    expect(result).toEqual({ success: true })
    expect(employeeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'Started Separation',
      employment_end_date: '2099-05-15',
    }))
    expect(mockedSendSeparationStartedEmail).toHaveBeenCalledWith(expect.objectContaining({
      email: 'alex@example.com',
      employeeName: 'Alex Rowe',
      employmentEndDate: '2099-05-15',
      remainingShifts: [{
        shiftDate: '2099-05-14',
        startTime: '09:00',
        endTime: '17:00',
        department: 'bar',
      }],
    }))
    expect(noteInsert).toHaveBeenCalledWith(expect.objectContaining({
      employee_id: 'employee-1',
      note_text: expect.stringContaining('Last working day: 2099-05-15.'),
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
                    employment_end_date: '2099-05-15',
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
