import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { GET } from '@/app/api/cron/sunday-preorder/route'

describe('sunday preorder cron route retirement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('still rejects unauthorized cron requests', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({
      authorized: false,
      error: 'Unauthorized',
    })

    const request = new Request('http://localhost/api/cron/sunday-preorder') as any
    request.nextUrl = new URL('http://localhost/api/cron/sunday-preorder')

    const response = await GET(request)
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('does no work once authorized because Sunday pre-orders are retired', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({
      authorized: true,
    })

    const request = new Request('http://localhost/api/cron/sunday-preorder') as any
    request.nextUrl = new URL('http://localhost/api/cron/sunday-preorder')

    const response = await GET(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      skipped: true,
      reason: 'sunday_preorders_retired',
    })
  })
})
