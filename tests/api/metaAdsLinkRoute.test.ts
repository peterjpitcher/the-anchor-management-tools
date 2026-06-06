import { beforeEach, describe, expect, it, vi } from 'vitest'

let allowAuth = true
const createShortLinkInternalMock = vi.fn()
const getOrCreateShortLinkVariantInternalMock = vi.fn()

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

vi.mock('@/services/event-marketing', () => ({
  EventMarketingService: {
    generateSingleLink: vi.fn(),
  },
}))

vi.mock('@/services/short-links', () => ({
  ShortLinkService: {
    createShortLinkInternal: (...args: unknown[]) => createShortLinkInternalMock(...args),
    getOrCreateShortLinkVariantInternal: (...args: unknown[]) => getOrCreateShortLinkVariantInternalMock(...args),
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
      full_url: 'https://l.the-anchor.pub/ma123',
      already_exists: false,
    })
    getOrCreateShortLinkVariantInternalMock.mockResolvedValue({
      id: 'variant-1',
      short_code: 'mv123',
      full_url: 'https://l.the-anchor.pub/mv123',
      destination_url: 'https://www.the-anchor.pub/private-hire?utm_source=facebook&utm_medium=paid_social&utm_campaign=private_hire_push&utm_content=ad_one',
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
    expect(payload.data.shortUrl).toBe('https://l.the-anchor.pub/ma123')
    expect(payload.data.utmDestinationUrl).toContain('utm_source=facebook')
    expect(payload.data.utmDestinationUrl).toContain('utm_medium=paid_social')
    expect(payload.data.utmDestinationUrl).toContain('utm_campaign=private_hire_push')
    expect(createShortLinkInternalMock).toHaveBeenCalledWith(expect.objectContaining({
      link_type: 'custom',
      metadata: expect.objectContaining({ channel: 'meta_ads' }),
    }))
  })

  it('creates child short-link variants for ad-level UTM content', async () => {
    const response = await POST(new Request('http://localhost/api/marketing/meta-ads-link', {
      method: 'POST',
      body: JSON.stringify({
        destinationUrl: 'https://www.the-anchor.pub/events/music-bingo?utm_source=facebook&utm_medium=paid_social&utm_campaign=event_music_bingo&utm_content=meta_ads_main',
        campaignName: 'Music Bingo',
        parentShortCode: 'maabc1',
        eventId: 'event-1',
        variants: [
          {
            utmContent: 'ad_music_bingo__launch__venue_photo',
            name: 'Launch / venue photo',
            metadata: { ad_name: 'Launch' },
          },
        ],
      }),
    }) as any)

    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(createShortLinkInternalMock).not.toHaveBeenCalled()
    expect(getOrCreateShortLinkVariantInternalMock).toHaveBeenCalledWith(expect.objectContaining({
      parent_short_code: 'maabc1',
      utm_content: 'ad_music_bingo__launch__venue_photo',
      name: 'Launch / venue photo',
    }))
    expect(payload.data.shortCode).toBe('maabc1')
    expect(payload.data.variants).toEqual([
      expect.objectContaining({
        shortUrl: 'https://l.the-anchor.pub/mv123',
        shortCode: 'mv123',
        utmContent: 'ad_music_bingo__launch__venue_photo',
        parentShortCode: 'maabc1',
      }),
    ])
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
