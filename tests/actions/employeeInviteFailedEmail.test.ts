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
function inviteTokens(options: { deleteError?: unknown; expireError?: unknown } = {}) {
  const insertSingle = vi.fn().mockResolvedValue({ data: { token: 'new-token' }, error: null })
  const deleteEq = vi.fn().mockResolvedValue({ error: options.deleteError ?? null })
  const expireNeq = vi.fn().mockResolvedValue({ error: options.expireError ?? null })
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

function portalInviteClient(status = 'Active', tokenOptions: { expireError?: unknown } = {}) {
  const tokens = inviteTokens(tokenOptions)
  state.client = {
    from: vi.fn((table: string) => {
      if (table === 'employees') return employeeRow({ email_address: 'staff@example.com', auth_user_id: null, status })
      if (table === 'employee_invite_tokens') return tokens.table
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
  return tokens
}

function resendClient(options: { authUserId?: string | null; expireError?: unknown } = {}) {
  const tokens = inviteTokens({ expireError: options.expireError })
  state.client = {
    from: vi.fn((table: string) => {
      if (table === 'employees') {
        return employeeRow({ email_address: 'starter@example.com', status: 'Onboarding', auth_user_id: options.authUserId ?? null })
      }
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

// The provider's own words: they go to the log and the audit row, never into what staff read.
const PROVIDER_TEXT = 'The gmail.con domain is not valid (422)'

describe('an invite email the provider refuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedSendEmail.mockResolvedValue({ success: false, error: PROVIDER_TEXT })
  })

  it('inviteEmployee tells staff nothing was sent, removes the part-made record, and audits a failure', async () => {
    const { employeeDelete, cleanupIs } = inviteEmployeeClient()

    const result = await inviteEmployee(null, inviteForm())

    expect(result.type).toBe('error')
    expect(result.message).toBe(
      'The invite email could not be sent because the email service did not accept it. Nothing reached them and no employee record was made. Please try again later. If it keeps failing, check the email address.'
    )
    expect(employeeDelete).toHaveBeenCalled()
    expect(cleanupIs).toHaveBeenCalledWith('auth_user_id', null)
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'invite',
        resource_type: 'employee',
        resource_id: 'employee-1',
        operation_status: 'failure',
        error_message: PROVIDER_TEXT,
      })
    )
  })

  it('inviteEmployee says so when the part-made record could not be removed either', async () => {
    inviteEmployeeClient({ cleanupError: { message: 'delete blocked' } })

    const result = await inviteEmployee(null, inviteForm())

    expect(result.message).toBe(
      'The invite email could not be sent because the email service did not accept it, and the part-made employee record could not be removed. Check the employee list before trying again.'
    )
  })

  it('sendPortalInvite tells staff nothing was sent, deletes the new token and leaves older links alone', async () => {
    const tokens = portalInviteClient()

    const result = await sendPortalInvite('employee-1')

    expect(result.type).toBe('error')
    expect(result.message).toBe(
      'The portal invite email could not be sent because the email service did not accept it. Nothing reached them, and any link they already had still works. Please try again later. If it keeps failing, check the email address.'
    )
    expect(tokens.deleteEq).toHaveBeenCalledWith('token', 'new-token')
    expect(tokens.expireNeq).not.toHaveBeenCalled()
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ operation_status: 'failure', error_message: PROVIDER_TEXT }))
  })

  it('resendInvite keeps the links the employee already has, which the old code expired anyway', async () => {
    const tokens = resendClient()

    const result = await resendInvite('employee-1')

    expect(result.type).toBe('error')
    expect(result.message).toBe(
      'The invite email could not be sent because the email service did not accept it. Nothing reached them, and any link they already had still works. Please try again later. If it keeps failing, check the email address.'
    )
    expect(tokens.deleteEq).toHaveBeenCalledWith('token', 'new-token')
    expect(tokens.expireNeq).not.toHaveBeenCalled()
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ operation_status: 'failure', error_message: PROVIDER_TEXT }))
  })

  it('never shows staff the provider text, from any of the three actions', async () => {
    inviteEmployeeClient()
    const invited = await inviteEmployee(null, inviteForm())
    portalInviteClient()
    const portal = await sendPortalInvite('employee-1')
    resendClient()
    const resent = await resendInvite('employee-1')

    for (const result of [invited, portal, resent]) {
      expect(result.message).not.toContain(PROVIDER_TEXT)
      expect(result.message).not.toContain('422')
    }
  })
})

describe('an invite email while email sending is switched off', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Email sending is currently suspended', code: 'email_suspended' })
  })

  it('says sending is switched off, rather than telling staff to check the address', async () => {
    inviteEmployeeClient()

    const result = await inviteEmployee(null, inviteForm())

    expect(result).toEqual({
      type: 'error',
      message:
        'The invite email could not be sent because email sending is switched off at the moment. Nothing reached them and no employee record was made. Try again once email sending is back on.',
    })
  })
})

/**
 * sendEmail says `uncertain` when the provider took the request and then timed out or answered
 * 5xx: the email may have arrived. The actions used to drop that, delete the record or the new
 * link behind it, and tell staff "Nothing reached them" with the provider's text in brackets.
 */
describe('an invite email the provider took but never answered', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 503', uncertain: true })
  })

  it('inviteEmployee keeps the record and its link, warns staff to check, and audits the unknown outcome', async () => {
    const { employeeDelete } = inviteEmployeeClient()

    const result = await inviteEmployee(null, inviteForm())

    expect(result).toEqual({
      type: 'warning',
      message:
        'We sent the invite to new-starter@example.com, but we did not hear back from the email service, so it may have gone. Check with them before sending it again. Their record has been kept, so you can resend the invite from their profile if it did not arrive.',
      employeeId: 'employee-1',
    })
    expect(result.message).not.toMatch(/Nothing reached them/)
    expect(result.message).not.toContain('Resend 503')
    expect(employeeDelete).not.toHaveBeenCalled()
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_status: 'failure',
        error_message: 'Resend 503',
        new_values: expect.objectContaining({ email_outcome: 'uncertain' }),
      })
    )
  })

  it('sendPortalInvite keeps the new link and the older ones, and warns staff to check', async () => {
    const tokens = portalInviteClient()

    const result = await sendPortalInvite('employee-1')

    expect(result).toEqual({
      type: 'warning',
      message:
        'We sent the portal invite to staff@example.com, but we did not hear back from the email service, so it may have gone. Check with them before sending it again. Any link they already had still works.',
    })
    expect(tokens.deleteEq).not.toHaveBeenCalled()
    expect(tokens.expireNeq).not.toHaveBeenCalled()
  })

  it('resendInvite keeps the new link and the older ones, and warns staff to check', async () => {
    const tokens = resendClient()

    const result = await resendInvite('employee-1')

    expect(result.type).toBe('warning')
    expect(result.message).toMatch(/may have gone\. Check with them before sending it again\./)
    expect(tokens.deleteEq).not.toHaveBeenCalled()
    expect(tokens.expireNeq).not.toHaveBeenCalled()
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

  // The email went, so "Please try again" sent a second one, and no success row was written.
  it('says the invite went, as a warning, when the older links could not be switched off', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    portalInviteClient('Active', { expireError: { code: '57014', message: 'canceling statement due to statement timeout' } })
    const portal = await sendPortalInvite('employee-1')
    resendClient({ expireError: { code: '57014', message: 'canceling statement due to statement timeout' } })
    const resent = await resendInvite('employee-1')

    expect(portal).toEqual({
      type: 'warning',
      message:
        'Invite sent to staff@example.com, but the links sent to them before could not be switched off, so those still work until they run out. There is no need to send it again.',
    })
    expect(resent.type).toBe('warning')
    expect(resent.message).toMatch(/^Invite sent to starter@example\.com, but/)
    for (const result of [portal, resent]) {
      expect(result.message).not.toMatch(/try again/i)
      expect(result.message).not.toContain('statement timeout')
    }
    const successRows = mockedAudit.mock.calls.filter(([row]) => row.operation_status === 'success')
    expect(successRows).toHaveLength(2)
    expect(successRows[0][0].new_values).toMatchObject({ older_links_expired: false })
  })

  it('resendInvite tells a starter who already set a password to sign in, not to create one', async () => {
    resendClient({ authUserId: 'auth-1' })

    await resendInvite('employee-1')

    const email = mockedSendEmail.mock.calls[0][0] as { text: string }
    expect(email.text).not.toMatch(/create a password/i)
    expect(email.text).toContain('You have already set a password')
    expect(email.text).toContain('Reset your password')
  })

  it('resendInvite still tells a starter with no password yet that they will create one', async () => {
    resendClient({ authUserId: null })

    await resendInvite('employee-1')

    const email = mockedSendEmail.mock.calls[0][0] as { text: string }
    expect(email.text).toContain("You'll be asked to create a password first")
  })
})
