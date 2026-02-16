import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authorizeCronRequestMock = vi.fn()
vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: (request: unknown) => authorizeCronRequestMock(request),
}))

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

const logAuditEventMock = vi.fn()
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: (payload: unknown) => logAuditEventMock(payload),
}))

import { GET } from '@/app/api/cron/apply-customer-labels/route'

describe('/api/cron/apply-customer-labels health checks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns ok for health checks without performing RPC or audit writes', async () => {
    authorizeCronRequestMock.mockReturnValue({ authorized: true })

    const request = new NextRequest(
      'http://localhost/api/cron/apply-customer-labels?health=true',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer test' },
      },
    )

    const response = await GET(request as any)
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload).toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'cron-apply-customer-labels',
      }),
    )

    expect(createAdminClientMock).not.toHaveBeenCalled()
    expect(logAuditEventMock).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated health checks', async () => {
    authorizeCronRequestMock.mockReturnValue({ authorized: false, reason: 'missing' })

    const request = new NextRequest(
      'http://localhost/api/cron/apply-customer-labels?health=true',
      { method: 'GET' },
    )

    const response = await GET(request as any)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })

    expect(createAdminClientMock).not.toHaveBeenCalled()
    expect(logAuditEventMock).not.toHaveBeenCalled()
  })
})

