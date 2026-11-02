import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeCronRequestMock = vi.fn()
const createAdminClientMock = vi.fn()
const sendChaseEmailMock = vi.fn()
const sendPortalInviteEmailMock = vi.fn()
const reportCronFailureMock = vi.fn()

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: (...args: unknown[]) => reportCronFailureMock(...args),
}))

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: (request: unknown) => authorizeCronRequestMock(request),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/email/employee-invite-emails', () => ({
  sendChaseEmail: (...args: unknown[]) => sendChaseEmailMock(...args),
  sendPortalInviteEmail: (...args: unknown[]) => sendPortalInviteEmailMock(...args),
}))

import { GET } from '@/app/api/cron/employee-invite-chase/route'

type TokenRow = {
  id: string
  token: string
  email: string
  employee_id: string
  invite_type: 'onboarding' | 'portal_access'
  created_at: string
  expires_at: string
  day3_chase_sent_at: string | null
  day6_chase_sent_at: string | null
}

type EmployeeRow = {
  employee_id: string
  email_address: string | null
  status: string
  auth_user_id: string | null
}

const EXPIRES_AT = '2099-01-08T00:00:00.000Z'

function tokenRow(overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    id: 'token-1',
    token: 'onboarding-token',
    email: 'starter@example.com',
    employee_id: 'employee-1',
    invite_type: 'onboarding',
    created_at: '2026-01-01T00:00:00.000Z',
    expires_at: EXPIRES_AT,
    day3_chase_sent_at: null,
    day6_chase_sent_at: '2026-01-06T00:00:00.000Z',
    ...overrides,
  }
}

function employeeRow(overrides: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    employee_id: 'employee-1',
    email_address: 'starter@example.com',
    status: 'Onboarding',
    auth_user_id: null,
    ...overrides,
  }
}

function mockClient(options: {
  tokens: TokenRow[]
  employees?: EmployeeRow[]
  tokensError?: { message: string } | null
  employeesError?: { message: string } | null
}) {
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const gt = vi.fn().mockResolvedValue({ data: options.tokensError ? null : options.tokens, error: options.tokensError ?? null })
  const is = vi.fn().mockReturnValue({ gt })
  const employeesIn = vi.fn().mockResolvedValue({
    data: options.employeesError ? null : (options.employees ?? []),
    error: options.employeesError ?? null,
  })

  createAdminClientMock.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'employee_invite_tokens') {
        return { select: vi.fn().mockReturnValue({ is }), update }
      }
      if (table === 'employees') {
        return { select: vi.fn().mockReturnValue({ in: employeesIn }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })

  return { update, updateEq, employeesIn }
}

async function run() {
  const response = await GET(new Request('http://localhost/api/cron/employee-invite-chase') as any)
  return { response, body: await response.json() }
}

describe('/api/cron/employee-invite-chase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeCronRequestMock.mockReturnValue({ authorized: true })
    sendChaseEmailMock.mockResolvedValue({ success: true })
    sendPortalInviteEmailMock.mockResolvedValue({ success: true })
  })

  it('sends portal-access reminder copy for portal access tokens, with the real expiry', async () => {
    mockClient({
      tokens: [tokenRow({ token: 'portal-token', email: 'employee@example.com', invite_type: 'portal_access' })],
      employees: [employeeRow({ email_address: 'employee@example.com', status: 'Active' })],
    })

    const { response, body } = await run()

    expect(response.status).toBe(200)
    expect(body.day3ChasesSent).toBe(1)
    expect(sendPortalInviteEmailMock).toHaveBeenCalledWith(
      'employee@example.com',
      expect.stringContaining('/onboarding/portal-token'),
      EXPIRES_AT,
    )
    expect(sendChaseEmailMock).not.toHaveBeenCalled()
    expect(reportCronFailureMock).not.toHaveBeenCalled()
  })

  // Until 12 September 2026 the chase helpers returned sendEmail's { success: false } instead of
  // throwing, so a chase that never went was stamped as sent and never tried again.
  it('does not record a chase that did not go, and raises it with staff', async () => {
    sendChaseEmailMock.mockRejectedValue(new Error('Resend 503'))
    const { update } = mockClient({ tokens: [tokenRow()], employees: [employeeRow()] })

    const { response, body } = await run()

    expect(response.status).toBe(200)
    expect(body.day3ChasesSent).toBe(0)
    // Nothing is stamped, so the next run tries this chase again.
    expect(update).not.toHaveBeenCalled()
    expect(body.errors).toEqual(['Day 3 chase failed for starter@example.com: Resend 503'])
    expect(reportCronFailureMock).toHaveBeenCalledWith(
      'employee-invite-chase',
      expect.objectContaining({ message: '1 invite chase email(s) did not go' }),
      expect.objectContaining({ failures: ['Day 3 chase failed for starter@example.com: Resend 503'] }),
    )
  })

  it('sends one reminder per link per run: the last one, when both are due', async () => {
    // A late run, or a missed one, used to send the day 3 and day 6 emails together.
    const { update } = mockClient({
      tokens: [tokenRow({ day3_chase_sent_at: null, day6_chase_sent_at: null })],
      employees: [employeeRow()],
    })

    const { body } = await run()

    expect(sendChaseEmailMock).toHaveBeenCalledTimes(1)
    expect(sendChaseEmailMock).toHaveBeenCalledWith(
      'starter@example.com',
      expect.stringContaining('/onboarding/onboarding-token'),
      6,
      EXPIRES_AT,
    )
    // Both stamps, so the day 3 email never follows the last reminder.
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({
      day6_chase_sent_at: expect.any(String),
      day3_chase_sent_at: expect.any(String),
    })
    expect(body.day6ChasesSent).toBe(1)
    expect(body.day3ChasesSent).toBe(0)
  })

  it('does not chase a link its starter can no longer use', async () => {
    mockClient({
      tokens: [
        tokenRow({ id: 't-active', employee_id: 'emp-active', email: 'active@example.com' }),
        tokenRow({ id: 't-moved', employee_id: 'emp-moved', email: 'old@example.com' }),
        tokenRow({ id: 't-gone', employee_id: 'emp-gone', email: 'gone@example.com' }),
        tokenRow({
          id: 't-portal', employee_id: 'emp-portal', email: 'portal@example.com', invite_type: 'portal_access',
        }),
        tokenRow({ id: 't-ok', employee_id: 'emp-ok', email: 'ok@example.com' }),
      ],
      employees: [
        // Made Active by hand, so the onboarding link would refuse them.
        employeeRow({ employee_id: 'emp-active', email_address: 'active@example.com', status: 'Active' }),
        // Email corrected since the link was sent.
        employeeRow({ employee_id: 'emp-moved', email_address: 'new@example.com' }),
        // emp-gone has no employee row at all.
        // A portal link for someone who already has a login.
        employeeRow({ employee_id: 'emp-portal', email_address: 'portal@example.com', status: 'Active', auth_user_id: 'auth-1' }),
        employeeRow({ employee_id: 'emp-ok', email_address: 'ok@example.com' }),
      ],
    })

    const { body } = await run()

    expect(body.skipped).toBe(4)
    expect(sendPortalInviteEmailMock).not.toHaveBeenCalled()
    expect(sendChaseEmailMock).toHaveBeenCalledTimes(1)
    expect(sendChaseEmailMock).toHaveBeenCalledWith('ok@example.com', expect.any(String), 3, EXPIRES_AT)
  })

  it('raises an alert when the run itself fails, not just a 500 nobody reads', async () => {
    mockClient({ tokens: [], tokensError: { message: 'connection reset' } })

    const { response } = await run()

    expect(response.status).toBe(500)
    expect(sendChaseEmailMock).not.toHaveBeenCalled()
    expect(reportCronFailureMock).toHaveBeenCalledWith(
      'employee-invite-chase',
      expect.objectContaining({ message: 'connection reset' }),
      expect.objectContaining({ outcome: expect.stringMatching(/No invite reminders were sent/) }),
    )
  })

  it('sends nothing and raises an alert when the employees cannot be read', async () => {
    mockClient({ tokens: [tokenRow()], employeesError: { message: 'employees read failed' } })

    const { response } = await run()

    expect(response.status).toBe(500)
    expect(sendChaseEmailMock).not.toHaveBeenCalled()
    expect(reportCronFailureMock).toHaveBeenCalledTimes(1)
  })
})
