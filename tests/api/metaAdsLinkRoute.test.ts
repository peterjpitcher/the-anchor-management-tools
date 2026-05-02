import { beforeEach, describe, expect, it, vi } from 'vitest'

let allowAuth = true
const createShortLinkInternalMock = vi.fn()

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(async (handler: (req: Request, apiKey: unknown) => Promise<Response>, permissions: string[], req?: Request) => {
    if (!allowAuth) {
      return Response.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      )
    }
    return handler(req || new Request('http://localhost/api/marketing/meta-ads-link'), {
      id: 'key-1',
      permissions,
    })
  }),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json({ success: true, data }, { status })),
  createErrorResponse: vi.fn((message: string, code: string, status = 400) =>
    Response.json({ success: false, error: { code, message } }, { status })
  ),
}))

vi.mock('@/services/short-links', () => ({
  ShortLinkService: {
    createShortLinkInternal: (...args: unknown[]) => createShortLinkInternalMock(...args),
  },
}))

import { withApiAuth } from '@/lib/api/auth'
import { POST } from '@/app/api/marketing/meta-ads-link/route'

describe('Meta Ads short-link API', () => {
  beforeEach(() => {
    allowAuth = true
    vi.clearAllMocks()
    createShortLinkInternalMock.mockResolvedValue({
      short_code: 'ma123',
      full_url: 'https://vip-club.uk/ma123',
      already_exists: false,
    })
  })

  it('creates a Meta Ads UTM short link for arbitrary promotion URLs', async () => {
    const response = await POST(new Request('http://localhost/api/marketing/meta-ads-link', {
      method: 'POST',
      body: JSON.stringify({
        destinationUrl: 'https://www.the-anchor.pub/private-hire',
        campaignName: 'Private Hire Push',
      }),
    }) as any)

    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.data.shortUrl).toBe('https://vip-club.uk/ma123')
    expect(payload.data.utmDestinationUrl).toContain('utm_source=facebook')
    expect(payload.data.utmDestinationUrl).toContain('utm_medium=paid_social')
    expect(payload.data.utmDestinationUrl).toContain('utm_campaign=private_hire_push')
    expect(createShortLinkInternalMock).toHaveBeenCalledWith(expect.objectContaining({
      link_type: 'custom',
      metadata: expect.objectContaining({ channel: 'meta_ads' }),
    }))
  })

  it('requires the existing management API scopes', async () => {
    await POST(new Request('http://localhost/api/marketing/meta-ads-link', {
      method: 'POST',
      body: JSON.stringify({
        destinationUrl: 'https://www.the-anchor.pub/private-hire',
        campaignName: 'Private Hire Push',
      }),
    }) as any)

    expect(withApiAuth).toHaveBeenCalledWith(expect.any(Function), ['read:events', 'read:menu'], expect.any(Request))
  })

  it('returns 403 when API auth denies the request', async () => {
    allowAuth = false
    const response = await POST(new Request('http://localhost/api/marketing/meta-ads-link', {
      method: 'POST',
      body: JSON.stringify({
        destinationUrl: 'https://www.the-anchor.pub/private-hire',
        campaignName: 'Private Hire Push',
      }),
    }) as any)

    const payload = await response.json()
    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('FORBIDDEN')
  })
})
