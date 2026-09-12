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

describe('/api/cron/employee-invite-chase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeCronRequestMock.mockReturnValue({ authorized: true })
  })

  it('sends portal-access reminder copy for portal access tokens', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const gt = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'token-1',
          token: 'portal-token',
          email: 'employee@example.com',
          invite_type: 'portal_access',
          created_at: '2026-01-01T00:00:00.000Z',
          day3_chase_sent_at: null,
          day6_chase_sent_at: '2026-01-06T00:00:00.000Z',
        },
      ],
      error: null,
    })
    const is = vi.fn().mockReturnValue({ gt })
    const select = vi.fn().mockReturnValue({ is })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'employee_invite_tokens') throw new Error(`Unexpected table: ${table}`)
        return { select, update }
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/employee-invite-chase') as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.day3ChasesSent).toBe(1)
    expect(sendPortalInviteEmailMock).toHaveBeenCalledWith(
      'employee@example.com',
      expect.stringContaining('/onboarding/portal-token'),
    )
    expect(sendChaseEmailMock).not.toHaveBeenCalled()
    expect(reportCronFailureMock).not.toHaveBeenCalled()
  })

  // Until 12 September 2026 the chase helpers returned sendEmail's { success: false } instead of
  // throwing, so a chase that never went was stamped as sent and never tried again.
  it('does not record a chase that did not go, and raises it with staff', async () => {
    sendChaseEmailMock.mockRejectedValue(new Error('Resend 503'))

    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const gt = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'token-1',
          token: 'onboarding-token',
          email: 'starter@example.com',
          invite_type: 'onboarding',
          created_at: '2026-01-01T00:00:00.000Z',
          day3_chase_sent_at: null,
          day6_chase_sent_at: '2026-01-06T00:00:00.000Z',
        },
      ],
      error: null,
    })
    const is = vi.fn().mockReturnValue({ gt })
    const select = vi.fn().mockReturnValue({ is })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'employee_invite_tokens') throw new Error(`Unexpected table: ${table}`)
        return { select, update }
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/employee-invite-chase') as any)
    const body = await response.json()

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
})
