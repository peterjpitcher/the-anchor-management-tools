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
import { InviteEmailSendError } from '@/lib/employees/invite-email-failure'

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

/** One update the route made on employee_invite_tokens: what it wrote and how it was filtered. */
type TokenWrite = {
  values: Record<string, unknown>
  filters: Array<[string, string, unknown]>
  /** Only the claim asks for rows back, to see whether it landed. */
  claim: boolean
}

function mockClient(options: {
  tokens: TokenRow[]
  employees?: EmployeeRow[]
  tokensError?: { message: string } | null
  employeesError?: { message: string } | null
  /** The claim written before the send fails. */
  claimError?: { code?: string; message: string } | null
  /** Another run claimed the link first, so the claim matches no row. */
  claimTaken?: boolean
  /**
   * Clearing the claim again fails: after a refused send, or the put-back after a failed claim.
   * Every write that does not ask for rows back gets this answer.
   */
  unclaimError?: { code?: string; message: string } | null
}) {
  const writes: TokenWrite[] = []
  const update = vi.fn((values: Record<string, unknown>) => {
    const write: TokenWrite = { values, filters: [], claim: false }
    writes.push(write)
    const builder = {
      eq: (column: string, value: unknown) => {
        write.filters.push(['eq', column, value])
        return builder
      },
      is: (column: string, value: unknown) => {
        write.filters.push(['is', column, value])
        return builder
      },
      select: async () => {
        write.claim = true
        if (options.claimError) return { data: null, error: options.claimError }
        const id = write.filters.find(([op, column]) => op === 'eq' && column === 'id')?.[2]
        return { data: options.claimTaken ? [] : [{ id }], error: null }
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ error: options.unclaimError ?? null }).then(resolve, reject),
    }
    return builder
  })
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

  const claims = () => writes.filter((write) => write.claim)
  const unclaims = () => writes.filter((write) => !write.claim)
  return { update, writes, claims, unclaims, employeesIn }
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
  it('clears the claim on a chase that did not go, so the next run tries again, and raises it with staff', async () => {
    sendChaseEmailMock.mockRejectedValue(new InviteEmailSendError('Resend 422'))
    const { claims, unclaims } = mockClient({ tokens: [tokenRow()], employees: [employeeRow()] })

    const { response, body } = await run()

    expect(response.status).toBe(200)
    expect(body.day3ChasesSent).toBe(0)
    expect(claims()).toEqual([
      {
        values: { day3_chase_sent_at: expect.any(String) },
        filters: [['eq', 'id', 'token-1'], ['is', 'day3_chase_sent_at', null]],
        claim: true,
      },
    ])
    // The stamp goes back to what the link had, so the next run tries this chase again.
    expect(unclaims()).toEqual([
      { values: { day3_chase_sent_at: null }, filters: [['eq', 'id', 'token-1']], claim: false },
    ])
    expect(body.errors).toEqual(['Day 3 chase failed for starter@example.com: Resend 422'])
    expect(body.uncertain).toEqual([])
    expect(body.missed).toEqual([])
    expect(reportCronFailureMock).toHaveBeenCalledWith(
      'employee-invite-chase',
      expect.objectContaining({ message: '1 invite chase email(s) did not go' }),
      expect.objectContaining({ failures: ['Day 3 chase failed for starter@example.com: Resend 422'] }),
    )
  })

  // The email service took the reminder and timed out, so it may have arrived. Not stamping it
  // sent it again on the next run (sendEmail's rule: a cron never retries an unknown send).
  it('keeps the stamp on a chase that may have gone, so the next run does not send it twice, and asks a person to check', async () => {
    sendChaseEmailMock.mockRejectedValue(new InviteEmailSendError('Resend timed out', { uncertain: true }))
    const { claims, unclaims } = mockClient({ tokens: [tokenRow()], employees: [employeeRow()] })

    const { response, body } = await run()

    expect(response.status).toBe(200)
    expect(claims()).toHaveLength(1)
    expect(claims()[0].values).toEqual({ day3_chase_sent_at: expect.any(String) })
    expect(unclaims()).toEqual([])
    expect(body.errors).toEqual([])
    expect(body.day3ChasesSent).toBe(0)
    expect(body.uncertain).toEqual([
      'Day 3 chase for starter@example.com may have gone, with no answer from the email service: Resend timed out',
    ])
    expect(reportCronFailureMock).toHaveBeenCalledWith(
      'employee-invite-chase',
      expect.objectContaining({ message: '1 invite chase email(s) may have gone' }),
      expect.objectContaining({
        failures: [],
        may_have_gone: [expect.stringContaining('starter@example.com may have gone')],
        outcome: expect.stringMatching(/recorded as sent, so they are not sent twice/),
      }),
    )
  })

  it('claims the link before sending, and keeps the claim once the chase has gone', async () => {
    const { update, unclaims } = mockClient({ tokens: [tokenRow()], employees: [employeeRow()] })

    const { body } = await run()

    expect(update.mock.invocationCallOrder[0]).toBeLessThan(sendChaseEmailMock.mock.invocationCallOrder[0])
    expect(unclaims()).toEqual([])
    expect(body.day3ChasesSent).toBe(1)
    expect(reportCronFailureMock).not.toHaveBeenCalled()
  })

  it('sends one reminder per link per run: the last one, when both are due', async () => {
    // A late run, or a missed one, used to send the day 3 and day 6 emails together.
    const { update, claims } = mockClient({
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
    // Both stamps, so the day 3 email never follows the last reminder, and the claim lands only
    // while both are still empty.
    expect(update).toHaveBeenCalledTimes(1)
    expect(claims()[0]).toEqual({
      values: { day6_chase_sent_at: expect.any(String), day3_chase_sent_at: expect.any(String) },
      filters: [['eq', 'id', 'token-1'], ['is', 'day6_chase_sent_at', null], ['is', 'day3_chase_sent_at', null]],
      claim: true,
    })
    expect(body.day6ChasesSent).toBe(1)
    expect(body.day3ChasesSent).toBe(0)
  })

  it('claims only the day 6 stamp when the day 3 chase already went', async () => {
    const { claims } = mockClient({
      tokens: [tokenRow({ day3_chase_sent_at: '2026-01-04T09:00:00.000Z', day6_chase_sent_at: null })],
      employees: [employeeRow()],
    })

    const { body } = await run()

    expect(claims()).toEqual([
      {
        values: { day6_chase_sent_at: expect.any(String) },
        filters: [['eq', 'id', 'token-1'], ['is', 'day6_chase_sent_at', null]],
        claim: true,
      },
    ])
    expect(body.day6ChasesSent).toBe(1)
  })

  it('puts both stamps back when a day 6 chase that claimed them both is refused', async () => {
    sendChaseEmailMock.mockRejectedValue(new InviteEmailSendError('Resend 429'))
    const { unclaims } = mockClient({
      tokens: [tokenRow({ day3_chase_sent_at: null, day6_chase_sent_at: null })],
      employees: [employeeRow()],
    })

    const { body } = await run()

    expect(unclaims()).toEqual([
      {
        values: { day6_chase_sent_at: null, day3_chase_sent_at: null },
        filters: [['eq', 'id', 'token-1']],
        claim: false,
      },
    ])
    expect(body.errors).toEqual(['Day 6 chase failed for starter@example.com: Resend 429'])
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

  // A stamp written after the send could fail, and the next run then sent the reminder again.
  // The claim now goes first, so a failed claim means nothing was sent. A failed claim can still
  // have been saved (a dropped connection reports an error with an empty code even when the update
  // went through), so the run takes back its own claim before saying the next run tries again.
  it('sends nothing when the link cannot be claimed first, takes back its own claim, and raises it as a chase that did not go', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { claims, unclaims } = mockClient({
      tokens: [tokenRow()],
      employees: [employeeRow()],
      claimError: { code: '', message: 'TypeError: fetch failed' },
    })

    const { response, body } = await run()

    expect(response.status).toBe(200)
    expect(sendChaseEmailMock).not.toHaveBeenCalled()
    const claimStamp = claims()[0].values.day3_chase_sent_at
    // The put-back clears the column only while it still holds this run's own stamp, so it can
    // never undo another run's claim, and it matches nothing when the claim never landed.
    expect(unclaims()).toEqual([
      {
        values: { day3_chase_sent_at: null },
        filters: [['eq', 'id', 'token-1'], ['eq', 'day3_chase_sent_at', claimStamp]],
        claim: false,
      },
    ])
    expect(body.day3ChasesSent).toBe(0)
    expect(body.errors).toEqual([
      'Day 3 chase for starter@example.com was not sent, because its link could not be marked first (token token-1): TypeError: fetch failed',
    ])
    expect(body.missed).toEqual([])
    expect(reportCronFailureMock).toHaveBeenCalledWith(
      'employee-invite-chase',
      expect.objectContaining({ message: '1 invite chase email(s) did not go' }),
      expect.objectContaining({ outcome: expect.stringMatching(/the next run tries them again/) }),
    )
  })

  it('takes back both stamps of a failed day 6 claim, each only while it holds this run\'s stamp', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { claims, unclaims } = mockClient({
      tokens: [tokenRow({ day3_chase_sent_at: null, day6_chase_sent_at: null })],
      employees: [employeeRow()],
      claimError: { code: '57014', message: 'statement timeout' },
    })

    const { body } = await run()

    const claimStamp = claims()[0].values.day6_chase_sent_at
    expect(claims()[0].values.day3_chase_sent_at).toBe(claimStamp)
    expect(unclaims()).toEqual([
      {
        values: { day6_chase_sent_at: null, day3_chase_sent_at: null },
        filters: [
          ['eq', 'id', 'token-1'],
          ['eq', 'day6_chase_sent_at', claimStamp],
          ['eq', 'day3_chase_sent_at', claimStamp],
        ],
        claim: false,
      },
    ])
    expect(body.errors).toEqual([
      'Day 6 chase for starter@example.com was not sent, because its link could not be marked first (token token-1): statement timeout',
    ])
    expect(body.missed).toEqual([])
  })

  // If the put-back fails too, the claim may still be on the link and no run would send the
  // reminder, while the alert said the next run would. A person has to send it instead.
  it('raises a failed claim it cannot take back as missed, so a person resends it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unclaims } = mockClient({
      tokens: [tokenRow()],
      employees: [employeeRow()],
      claimError: { code: '', message: 'TypeError: fetch failed' },
      unclaimError: { code: '', message: 'TypeError: fetch failed' },
    })

    const { response, body } = await run()

    expect(response.status).toBe(200)
    expect(sendChaseEmailMock).not.toHaveBeenCalled()
    expect(unclaims()).toHaveLength(1)
    expect(body.errors).toEqual([])
    expect(body.uncertain).toEqual([])
    expect(body.missed).toEqual([
      'Day 3 chase for starter@example.com was not sent, because its link could not be marked first (TypeError: fetch failed). The mark may have been saved anyway and could not be cleared, so no run may send it (token token-1): TypeError: fetch failed',
    ])
    const [, error, context] = reportCronFailureMock.mock.calls[0]
    expect(error.message).toBe('1 invite chase email(s) did not go and will not be tried again')
    expect(context.failures).toEqual([])
    expect(context.missed).toEqual(body.missed)
    expect(context.outcome).toMatch(/Resend the invite from the employee profile/)
    expect(context.outcome).not.toMatch(/the next run tries them again/)
  })

  // The stamp doubles as this run's mark, so the put-back can only take back this run's claim.
  // To the millisecond alone, two runs that start together would write the same value.
  it('stamps a claim to the microsecond, from the run\'s own time', async () => {
    const { claims } = mockClient({ tokens: [tokenRow()], employees: [employeeRow()] })

    const { body } = await run()

    const claimStamp = claims()[0].values.day3_chase_sent_at as string
    expect(claimStamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
    expect(claimStamp.slice(0, 23)).toBe(body.processedAt.slice(0, 23))
    expect(Date.parse(claimStamp)).toBe(Date.parse(body.processedAt))
  })

  // Two runs that overlap read the same open link. Only the one whose claim lands may send.
  it('leaves a link another run has already claimed, and sends nothing for it', async () => {
    const { unclaims } = mockClient({ tokens: [tokenRow()], employees: [employeeRow()], claimTaken: true })

    const { response, body } = await run()

    expect(response.status).toBe(200)
    expect(sendChaseEmailMock).not.toHaveBeenCalled()
    expect(unclaims()).toEqual([])
    expect(body.claimedElsewhere).toBe(1)
    expect(body.day3ChasesSent).toBe(0)
    expect(body.errors).toEqual([])
    expect(reportCronFailureMock).not.toHaveBeenCalled()
  })

  it('raises a refused chase whose stamp cannot be cleared as missed, so a person sends it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    sendChaseEmailMock.mockRejectedValue(new InviteEmailSendError('Resend 422'))
    mockClient({ tokens: [tokenRow()], employees: [employeeRow()], unclaimError: { message: 'statement timeout' } })

    const { body } = await run()

    expect(sendChaseEmailMock).toHaveBeenCalledTimes(1)
    expect(body.errors).toEqual([])
    expect(body.uncertain).toEqual([])
    expect(body.missed).toEqual([
      'Day 3 chase for starter@example.com did not go (Resend 422), and its link still says it did, so no run will send it (token token-1): statement timeout',
    ])
    const [, error, context] = reportCronFailureMock.mock.calls[0]
    expect(error.message).toBe('1 invite chase email(s) did not go and will not be tried again')
    expect(context.missed).toEqual(body.missed)
    expect(context).not.toHaveProperty('may_have_gone')
    expect(context.outcome).toMatch(/Resend the invite from the employee profile/)
  })

  // A resend or portal invite that may have gone keeps the older links working beside the new
  // one. Chasing every open link sent one person several reminders, each with a different link.
  it('sends one reminder per person, on their newest link, and leaves the older links alone', async () => {
    const { update, claims } = mockClient({
      tokens: [
        tokenRow({ id: 't-old', token: 'old-token', created_at: '2026-01-01T00:00:00.000Z' }),
        tokenRow({ id: 't-new', token: 'new-token', created_at: '2026-01-02T00:00:00.000Z' }),
        tokenRow({ id: 't-older', token: 'older-token', created_at: '2025-12-30T00:00:00.000Z' }),
      ],
      employees: [employeeRow()],
    })

    const { body } = await run()

    expect(sendChaseEmailMock).toHaveBeenCalledTimes(1)
    expect(sendChaseEmailMock).toHaveBeenCalledWith('starter@example.com', expect.stringContaining('/onboarding/new-token'), 3, EXPIRES_AT)
    expect(update).toHaveBeenCalledTimes(1)
    expect(claims()[0].filters).toContainEqual(['eq', 'id', 't-new'])
    expect(body.superseded).toBe(2)
    expect(body.day3ChasesSent).toBe(1)
  })

  it('does not chase an older link when the newest one is not due yet', async () => {
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { update } = mockClient({
      tokens: [
        tokenRow({ id: 't-old', token: 'old-token' }),
        tokenRow({ id: 't-new', token: 'new-token', created_at: recent, day6_chase_sent_at: null }),
      ],
      employees: [employeeRow()],
    })

    const { body } = await run()

    expect(sendChaseEmailMock).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(body.superseded).toBe(1)
  })

  it('still chases each person once when several people have open links', async () => {
    mockClient({
      tokens: [
        tokenRow({ id: 't-a1', employee_id: 'emp-a', email: 'a@example.com', token: 'a-old' }),
        tokenRow({ id: 't-b', employee_id: 'emp-b', email: 'b@example.com', token: 'b-only' }),
        tokenRow({ id: 't-a2', employee_id: 'emp-a', email: 'a@example.com', token: 'a-new', created_at: '2026-01-02T00:00:00.000Z' }),
      ],
      employees: [
        employeeRow({ employee_id: 'emp-a', email_address: 'a@example.com' }),
        employeeRow({ employee_id: 'emp-b', email_address: 'b@example.com' }),
      ],
    })

    const { body } = await run()

    expect(sendChaseEmailMock).toHaveBeenCalledTimes(2)
    expect(sendChaseEmailMock).toHaveBeenCalledWith('a@example.com', expect.stringContaining('/onboarding/a-new'), 3, EXPIRES_AT)
    expect(sendChaseEmailMock).toHaveBeenCalledWith('b@example.com', expect.stringContaining('/onboarding/b-only'), 3, EXPIRES_AT)
    expect(body.superseded).toBe(1)
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
