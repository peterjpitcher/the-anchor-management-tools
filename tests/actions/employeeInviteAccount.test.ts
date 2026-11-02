import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Creating the starter's login, and the invite form's start date. Each failure here used to reach
 * the starter (or the manager) as a generic "failed" with nothing to act on.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/audit-helpers', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/email/employee-invite-emails', () => ({
  sendWelcomeEmail: vi.fn(),
  sendChaseEmail: vi.fn(),
  sendOnboardingCompleteEmail: vi.fn(),
  sendPortalInviteEmail: vi.fn(),
  sendSeparationStartedEmail: vi.fn(),
}))

const signInWithPassword = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
    },
  })),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/audit-helpers'
import { logAuditEvent } from '@/app/actions/audit'
import { createEmployeeAccount, inviteEmployee } from '@/app/actions/employeeInvite'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock

const PASSWORD = 'a-long-password-1'

function mockMaybeSingle(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  }
}

function inviteClient(options: {
  createUser: Mock
  deleteUser?: Mock
  rpc?: Mock
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'employee_invite_tokens') {
        return mockMaybeSingle({
          id: 'token-1',
          employee_id: 'employee-1',
          email: 'starter@example.com',
          invite_type: 'onboarding',
          expires_at: '2099-01-01T00:00:00.000Z',
          completed_at: null,
        })
      }
      if (table === 'employees') {
        return mockMaybeSingle({
          auth_user_id: null,
          email_address: 'starter@example.com',
          status: 'Onboarding',
          first_name: null,
          last_name: null,
        })
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: options.rpc ?? vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: { admin: { createUser: options.createUser, deleteUser: options.deleteUser ?? vi.fn() } },
  }
}

describe('createEmployeeAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedAudit.mockResolvedValue(undefined)
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
  })

  it('refuses a password under 12 characters before creating anything', async () => {
    const createUser = vi.fn()
    mockedCreateAdminClient.mockReturnValue(inviteClient({ createUser }))

    const result = await createEmployeeAccount('token-value', 'short-pass1')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toMatch(/at least 12 characters/)
      expect(result.fieldErrors?.password).toMatch(/at least 12 characters/)
    }
    expect(createUser).not.toHaveBeenCalled()
  })

  it('signs the browser in as the new account once it is linked', async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
    mockedCreateAdminClient.mockReturnValue(inviteClient({ createUser }))

    const result = await createEmployeeAccount('token-value', PASSWORD)

    expect(result).toEqual({ success: true, signedIn: true })
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'starter@example.com', password: PASSWORD })
  })

  it('tells the starter plainly what to do when their email already has a login', async () => {
    // Supabase reports this with the code email_exists; the old check looked for "already
    // registered", which the real message ("has already been registered") does not contain.
    const createUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { code: 'email_exists', message: 'A user with this email address has already been registered', status: 422 },
    })
    mockedCreateAdminClient.mockReturnValue(inviteClient({ createUser }))

    const result = await createEmployeeAccount('token-value', PASSWORD)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toMatch(/already a login for this email address/i)
      expect(result.error).toMatch(/ask your manager/i)
    }
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('points the starter to their manager and records it when an orphaned login cannot be removed', async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-orphan' } }, error: null })
    const deleteUser = vi.fn().mockResolvedValue({ error: { message: 'auth down' } })
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    mockedCreateAdminClient.mockReturnValue(inviteClient({ createUser, deleteUser, rpc }))

    const result = await createEmployeeAccount('token-value', PASSWORD)

    expect(result.success).toBe(false)
    if (!result.success) {
      // Trying again would only meet "email exists", so the advice is the manager, not a retry.
      expect(result.error).toMatch(/ask your manager for help before you try again/i)
      expect(result.error).not.toMatch(/connection reset/)
    }
    expect(deleteUser).toHaveBeenCalledWith('auth-orphan')
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'create_account',
      resource_id: 'employee-1',
      operation_status: 'failure',
      additional_info: { orphaned_auth_user_id: 'auth-orphan' },
    }))
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('shows our own database message as it is when linking is refused', async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
    const deleteUser = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Invite link has expired.' } })
    mockedCreateAdminClient.mockReturnValue(inviteClient({ createUser, deleteUser, rpc }))

    const result = await createEmployeeAccount('token-value', PASSWORD)

    expect(result).toEqual({ success: false, error: 'Invite link has expired.' })
    expect(deleteUser).toHaveBeenCalledWith('auth-user-1')
  })
})

describe('inviteEmployee start date', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue({ user_id: 'user-1', user_email: 'manager@example.com' })
  })

  function form(startDate: string | null) {
    const formData = new FormData()
    formData.set('email', 'new-starter@example.com')
    formData.set('job_title', 'Bartender')
    if (startDate !== null) formData.set('employment_start_date', startDate)
    return formData
  }

  it.each([
    ['impossible', '2026-02-30'],
    ['not a date', 'next week'],
  ])('refuses a %s start date before creating the employee', async (_label, startDate) => {
    const rpc = vi.fn()
    mockedCreateAdminClient.mockReturnValue({ rpc, from: vi.fn() })

    const result = await inviteEmployee(null, form(startDate))

    expect(result).toEqual({ type: 'error', message: 'Enter a real employment start date.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  // The recruitment hire hand-off invites without a start date; staff add it on the record.
  it.each([
    ['missing', null],
    ['blank', '  '],
  ])('lets a %s start date through as no date', async (_label, startDate) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'stop here' } })
    mockedCreateAdminClient.mockReturnValue({ rpc, from: vi.fn() })

    await inviteEmployee(null, form(startDate))

    expect(rpc).toHaveBeenCalledWith('create_employee_invite', expect.objectContaining({
      p_employment_start_date: null,
    }))
  })
})
