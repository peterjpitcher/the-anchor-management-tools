import { beforeEach, describe, expect, it, vi } from 'vitest'

let allowAuth = true
const generateSingleLinkMock = vi.fn()
const getOrCreateShortLinkVariantInternalMock = vi.fn()
const findEventIdForShortCodeMock = vi.fn()
const grantedPermissions: string[][] = []

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(async (handler: (req: Request, apiKey: unknown) => Promise<Response>, permissions: string[], req?: Request) => {
    grantedPermissions.push(permissions)
    if (!allowAuth) {
      return Response.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      )
    }
    return handler(req || new Request('http://localhost/api/marketing/social-post-links'), { id: 'key-1', permissions })
  }),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json({ success: true, data }, { status })),
  createErrorResponse: vi.fn((message: string, code: string, status = 400) =>
    Response.json({ success: false, error: { code, message } }, { status })
  ),
}))

vi.mock('@/services/event-marketing', () => ({
  EventMarketingService: { generateSingleLink: (...args: unknown[]) => generateSingleLinkMock(...args) },
}))

vi.mock('@/services/short-links', () => ({
  ShortLinkService: {
    getOrCreateShortLinkVariantInternal: (...args: unknown[]) => getOrCreateShortLinkVariantInternalMock(...args),
    findEventIdForShortCode: (...args: unknown[]) => findEventIdForShortCodeMock(...args),
  },
}))

import { POST } from '@/app/api/marketing/social-post-links/route'

const EVENT_LINK = {
  shortCode: 'fbabc1',
  shortUrl: 'https://l.the-anchor.pub/fbabc1',
  destinationUrl: 'https://www.the-anchor.pub/events/music-bingo?utm_source=facebook&utm_medium=social&utm_campaign=music-bingo&utm_content=facebook_main',
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/marketing/social-post-links', { method: 'POST', body: JSON.stringify(body) })
}

describe('social post short-link API', () => {
  beforeEach(() => {
    allowAuth = true
    grantedPermissions.length = 0
    vi.clearAllMocks()
    generateSingleLinkMock.mockResolvedValue(EVENT_LINK)
    getOrCreateShortLinkVariantInternalMock.mockImplementation(async ({ utm_content }: { utm_content: string }) => ({
      id: `variant-${utm_content}`,
      short_code: `fp${utm_content.slice(-4)}`,
      full_url: `https://l.the-anchor.pub/fp${utm_content.slice(-4)}`,
      destination_url: `https://www.the-anchor.pub/events/music-bingo?utm_source=facebook&utm_content=${utm_content}`,
      already_exists: false,
    }))
  })

  it("makes one Facebook-post variant of the event's Facebook link per post", async () => {
    const response = await POST(post({
      eventId: 'evt-1',
      posts: [{ utmContent: 'cheers_post_0001', name: 'Snowball Showdown, 26 Oct' }, { utmContent: 'CHEERS_POST_0002' }],
    }) as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(generateSingleLinkMock).toHaveBeenCalledWith('evt-1', 'facebook')
    expect(getOrCreateShortLinkVariantInternalMock).toHaveBeenCalledWith({
      parent_short_code: 'fbabc1',
      destination_url: EVENT_LINK.destinationUrl,
      utm_content: 'cheers_post_0001',
      name: 'Snowball Showdown, 26 Oct',
      channel: 'facebook_post',
      metadata: { source: 'social_post_api', event_id: 'evt-1' },
    })
    expect(getOrCreateShortLinkVariantInternalMock).toHaveBeenCalledWith(expect.objectContaining({ utm_content: 'cheers_post_0002' }))
    expect(payload.data).toEqual({
      eventId: 'evt-1',
      parentShortCode: 'fbabc1',
      parentShortUrl: 'https://l.the-anchor.pub/fbabc1',
      variants: [
        expect.objectContaining({ utmContent: 'cheers_post_0001', shortUrl: 'https://l.the-anchor.pub/fp0001', alreadyExists: false }),
        expect.objectContaining({ utmContent: 'cheers_post_0002', shortUrl: 'https://l.the-anchor.pub/fp0002' }),
      ],
    })
  })

  it('needs the same API key permissions as the ads link endpoint', async () => {
    await POST(post({ eventId: 'evt-1', posts: [{ utmContent: 'p1' }] }) as any)
    expect(grantedPermissions).toEqual([['read:events', 'read:menu']])

    allowAuth = false
    const refused = await POST(post({ eventId: 'evt-1', posts: [{ utmContent: 'p1' }] }) as any)
    expect(refused.status).toBe(403)
  })

  it.each([
    [{ posts: [{ utmContent: 'p1' }] }, 'Give eventId or eventShortCode'],
    [{ eventId: 'evt-1', eventShortCode: 'fbabc1', posts: [{ utmContent: 'p1' }] }, 'Give eventId or eventShortCode'],
    [{ eventShortCode: 'not a code', posts: [{ utmContent: 'p1' }] }, 'eventShortCode must be a valid short code'],
    [{ eventId: 'evt-1', posts: [] }, 'At least one post is required'],
    [{ eventId: 'evt-1', posts: [{ utmContent: 'has spaces' }] }, 'utmContent can only contain'],
    [{ eventId: 'evt-1', posts: [{ utmContent: 'x'.repeat(101) }] }, '100 characters'],
    [{ eventId: 'evt-1', posts: Array.from({ length: 51 }, (_, index) => ({ utmContent: `p${index}` })) }, 'At most 50 posts'],
  ])('refuses a bad request: %j', async (body, message) => {
    const response = await POST(post(body) as any)
    const payload = await response.json()
    expect(response.status).toBe(400)
    expect(payload.error.message).toContain(message)
    expect(generateSingleLinkMock).not.toHaveBeenCalled()
  })

  it("finds the event from one of its short links, so CheersAI can send the post's Facebook link", async () => {
    findEventIdForShortCodeMock.mockResolvedValue('evt-1')
    const response = await POST(post({ eventShortCode: '/FB6E761F', posts: [{ utmContent: 'p1' }] }) as any)

    expect(response.status).toBe(200)
    expect(findEventIdForShortCodeMock).toHaveBeenCalledWith('fb6e761f')
    expect(generateSingleLinkMock).toHaveBeenCalledWith('evt-1', 'facebook')
    expect(getOrCreateShortLinkVariantInternalMock).toHaveBeenCalledWith(expect.objectContaining({
      parent_short_code: 'fbabc1',
      metadata: expect.objectContaining({ event_id: 'evt-1' }),
    }))
    expect((await response.json()).data.eventId).toBe('evt-1')
  })

  it('refuses a short link that belongs to no event', async () => {
    findEventIdForShortCodeMock.mockResolvedValue(null)
    const response = await POST(post({ eventShortCode: 'abc123', posts: [{ utmContent: 'p1' }] }) as any)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('EVENT_LINK_NOT_FOUND')
    expect(generateSingleLinkMock).not.toHaveBeenCalled()
  })

  it('fails visibly when the event link or a variant cannot be made', async () => {
    generateSingleLinkMock.mockRejectedValueOnce(new Error('Event not found for marketing link generation'))
    const missing = await POST(post({ eventId: 'evt-x', posts: [{ utmContent: 'p1' }] }) as any)
    expect(missing.status).toBe(500)
    expect((await missing.json()).error.message).toBe('Event not found for marketing link generation')

    getOrCreateShortLinkVariantInternalMock.mockRejectedValueOnce(new Error('Parent short link not found'))
    const broken = await POST(post({ eventId: 'evt-1', posts: [{ utmContent: 'p1' }] }) as any)
    expect(broken.status).toBe(500)
  })
})
