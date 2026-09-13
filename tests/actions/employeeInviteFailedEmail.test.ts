import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * The defect of 11 September 2026: the invite actions told staff "Invite sent" when the email had
 * failed, because the invite email helpers returned sendEmail's { success: false } instead of
 * throwing. Here only the email provider is faked; the actions and the real helpers run, so a
 * failing provider has to reach staff through both layers.
 */

const state = vi.hoisted(() => ({ client: null as any }))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async () => true),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.client),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn(async () => ({ user_id: 'user-1', user_email: 'manager@example.com' })),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

import { sendEmail } from '@/lib/email/emailService'
import { logAuditEvent } from '@/app/actions/audit'
import { inviteEmployee, resendInvite, sendPortalInvite } from '@/app/actions/employeeInvite'

const mockedSendEmail = sendEmail as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock

/** The employee_invite_tokens chains the three actions use, with each call recorded. */
function inviteTokens(options: { deleteError?: unknown } = {}) {
  const insertSingle = vi.fn().mockResolvedValue({ data: { token: 'new-token' }, error: null })
  const deleteEq = vi.fn().mockResolvedValue({ error: options.deleteError ?? null })
  const expireNeq = vi.fn().mockResolvedValue({ error: null })
  return {
    insertSingle,
    deleteEq,
    expireNeq,
    table: {
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: insertSingle }) }),
      delete: vi.fn().mockReturnValue({ eq: deleteEq }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ is: vi.fn().mockReturnValue({ neq: expireNeq }) }),
        }),
      }),
    },
  }
}

function employeeRow(row: Record<string, unknown>) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) }),
    }),
  }
}

/** inviteEmployee: the RPC makes the record, and a failed email deletes it again. */
function inviteEmployeeClient(options: { cleanupError?: unknown } = {}) {
  const cleanupIs = vi.fn().mockResolvedValue({ error: options.cleanupError ?? null })
  const employeeDelete = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ is: cleanupIs }) }),
  })
  const rpc = vi.fn().mockResolvedValue({ data: { employee_id: 'employee-1', token: 'token-value' }, error: null })
  state.client = {
    rpc,
    from: vi.fn((table: string) => {
      if (table === 'employees') return { delete: employeeDelete }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
  return { employeeDelete, cleanupIs, rpc }
}

function portalInviteClient(status = 'Active') {
  const tokens = inviteTokens()
  state.client = {
    from: vi.fn((table: string) => {
      if (table === 'employees') return employeeRow({ email_address: 'staff@example.com', auth_user_id: null, status })
      if (table === 'employee_invite_tokens') return tokens.table
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
  return tokens
}

function resendClient() {
  const tokens = inviteTokens()
  state.client = {
    from: vi.fn((table: string) => {
      if (table === 'employees') return employeeRow({ email_address: 'starter@example.com', status: 'Onboarding' })
      if (table === 'employee_invite_tokens') return tokens.table
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
  return tokens
}

function inviteForm() {
  const formData = new FormData()
  formData.set('email', 'new-starter@example.com')
  formData.set('job_title', 'Bartender')
  formData.set('employment_start_date', '2026-10-01')
  return formData
}

describe('an invite email the provider refuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 503' })
  })

  it('inviteEmployee tells staff nothing was sent, removes the part-made record, and audits a failure', async () => {
    const { employeeDelete, cleanupIs } = inviteEmployeeClient()

    const result = await inviteEmployee(null, inviteForm())

    expect(result.type).toBe('error')
    expect(result.message).toBe(
      'The invite email could not be sent (Resend 503). Nothing reached them and no employee record was made, so check the email address and try again.'
    )
    expect(employeeDelete).toHaveBeenCalled()
    expect(cleanupIs).toHaveBeenCalledWith('auth_user_id', null)
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'invite',
        resource_type: 'employee',
        resource_id: 'employee-1',
        operation_status: 'failure',
        error_message: 'Resend 503',
      })
    )
  })

  it('inviteEmployee says so when the part-made record could not be removed either', async () => {
    inviteEmployeeClient({ cleanupError: { message: 'delete blocked' } })

    const result = await inviteEmployee(null, inviteForm())

    expect(result.message).toBe(
      'The invite email could not be sent (Resend 503), and the part-made employee record could not be removed. Check the employee list before trying again.'
    )
  })

  it('sendPortalInvite tells staff nothing was sent, deletes the new token and leaves older links alone', async () => {
    const tokens = portalInviteClient()

    const result = await sendPortalInvite('employee-1')

    expect(result.type).toBe('error')
    expect(result.message).toBe(
      'The portal invite email could not be sent (Resend 503). Nothing reached them, and any link they already had still works. Check the email address and try again.'
    )
    expect(tokens.deleteEq).toHaveBeenCalledWith('token', 'new-token')
    expect(tokens.expireNeq).not.toHaveBeenCalled()
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ operation_status: 'failure', error_message: 'Resend 503' }))
  })

  it('resendInvite keeps the links the employee already has, which the old code expired anyway', async () => {
    const tokens = resendClient()

    const result = await resendInvite('employee-1')

    expect(result.type).toBe('error')
    expect(result.message).toBe(
      'The invite email could not be sent (Resend 503). Nothing reached them, and any link they already had still works. Check the email address and try again.'
    )
    expect(tokens.deleteEq).toHaveBeenCalledWith('token', 'new-token')
    expect(tokens.expireNeq).not.toHaveBeenCalled()
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ operation_status: 'failure', error_message: 'Resend 503' }))
  })
})

describe('an invite email the provider accepts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1' })
  })

  it('inviteEmployee reports the invite sent, keeps the record and audits a success', async () => {
    const { employeeDelete } = inviteEmployeeClient()

    const result = await inviteEmployee(null, inviteForm())

    expect(result).toMatchObject({ type: 'success', message: 'Invite sent to new-starter@example.com.', employeeId: 'employee-1' })
    expect(employeeDelete).not.toHaveBeenCalled()
    expect(mockedSendEmail.mock.calls[0][0].to).toBe('new-starter@example.com')
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ operation_status: 'success' }))
  })

  it('sendPortalInvite reports it sent and only then expires older portal links', async () => {
    const tokens = portalInviteClient()

    const result = await sendPortalInvite('employee-1')

    expect(result).toMatchObject({ type: 'success', message: 'Portal invite sent to staff@example.com.' })
    expect(tokens.expireNeq).toHaveBeenCalledWith('token', 'new-token')
    expect(tokens.deleteEq).not.toHaveBeenCalled()
  })

  it('resendInvite reports it sent and only then expires older onboarding links', async () => {
    const tokens = resendClient()

    const result = await resendInvite('employee-1')

    expect(result).toMatchObject({ type: 'success', message: 'Invite resent to starter@example.com.' })
    expect(tokens.expireNeq).toHaveBeenCalledWith('token', 'new-token')
    expect(tokens.deleteEq).not.toHaveBeenCalled()
  })
})
