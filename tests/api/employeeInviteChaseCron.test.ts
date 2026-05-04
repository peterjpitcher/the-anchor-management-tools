import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeCronRequestMock = vi.fn()
const createAdminClientMock = vi.fn()
const sendChaseEmailMock = vi.fn()
const sendPortalInviteEmailMock = vi.fn()

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
  })
})
