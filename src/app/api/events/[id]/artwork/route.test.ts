// The scoped artwork endpoint. What matters here is not the payload so much as
// the three outcomes staying distinguishable (403 / 404 / 200-with-nulls) and
// nothing this route emits ever entering a shared cache.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown> | null

const eventResult: { data: Row; error: unknown } = { data: null, error: null }
const imagesResult: { data: unknown; error: unknown } = { data: [], error: null }

const maybeSingleMock = vi.fn(() => Promise.resolve(eventResult))
const inMock = vi.fn(() => Promise.resolve(imagesResult))
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock, in: inMock }))
const selectMock = vi.fn(() => ({ eq: eqMock }))
const fromMock = vi.fn(() => ({ select: selectMock }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

// Keep createApiResponse / createErrorResponse real so the cache headers under
// test are the ones the route will actually send. Only the key lookup is faked.
let permissions: string[] = ['read:events', 'read:events:artwork']
vi.mock('@/lib/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth')>()
  return {
    ...actual,
    withApiAuth: vi.fn(
      (
        handler: (req: Request, apiKey: { id: string; permissions: string[] }) => Promise<Response>,
        required: string[],
        req: Request,
        options?: { cacheMode?: 'public' | 'private' }
      ) => {
        const allowed = required.every((p) => permissions.includes(p) || permissions.includes('*'))
        if (!allowed) {
          return Promise.resolve(
            actual.createErrorResponse(
              'Insufficient permissions',
              'FORBIDDEN',
              403,
              undefined,
              options?.cacheMode ?? 'public'
            )
          )
        }
        return handler(req, { id: 'test-key', permissions })
      }
    ),
  }
})

import { GET } from './route'

const EVENT = {
  id: '9d03a427-d331-45bd-91af-142b396b82ae',
  slug: 'karaoke-night',
  hero_image_url: 'https://cdn/square.png',
  story_image_url: 'https://cdn/story.png',
  landscape_image_url: null,
}

function request(id = EVENT.id) {
  return new NextRequest(`http://localhost/api/events/${id}/artwork`, {
    method: 'GET',
    headers: { 'X-API-Key': 'test-key' },
  })
}

function context(id = EVENT.id) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  permissions = ['read:events', 'read:events:artwork']
  eventResult.data = EVENT
  eventResult.error = null
  imagesResult.data = [
    { image_type: 'square', mime_type: 'image/png', file_size_bytes: 1, updated_at: '2026-08-24T10:00:00Z' },
    { image_type: 'story', mime_type: 'image/png', file_size_bytes: 2, updated_at: '2026-08-24T11:00:00Z' },
  ]
  imagesResult.error = null
})

describe('GET /api/events/[id]/artwork', () => {
  it('returns 403 when the key holds read:events but not the artwork scope', async () => {
    permissions = ['read:events']
    const res = await GET(request(), context())
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error.code).toBe('FORBIDDEN')
    // A missing scope must not read as "this event has no artwork".
    expect(json.data).toBeUndefined()
  })

  it('serves a wildcard key', async () => {
    permissions = ['*']
    const res = await GET(request(), context())
    expect(res.status).toBe(200)
  })

  it('never allows any response to enter a shared cache', async () => {
    // The body depends on the caller's scopes. A shared cache keyed on URL alone
    // would hand one key's copy to another.
    for (const perms of [['read:events'], ['read:events', 'read:events:artwork']]) {
      permissions = perms
      const res = await GET(request(), context())
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('ETag')).toBeNull()
    }
  })

  it('sends no ETag on a 404 either', async () => {
    eventResult.data = null
    const res = await GET(request(), context())
    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('ETag')).toBeNull()
  })

  it('returns every variant key with explicit nulls for an event with no artwork', async () => {
    eventResult.data = { id: EVENT.id, slug: EVENT.slug }
    imagesResult.data = []
    const res = await GET(request(), context())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.variants).toEqual({ square: null, story: null, landscape: null })
    expect(json.data.kitUpdatedAt).toBeNull()
  })

  it('marks an inherited square when no metadata row exists for it', async () => {
    imagesResult.data = [{ image_type: 'story', mime_type: 'image/png', file_size_bytes: 2, updated_at: '2026-08-24T11:00:00Z' }]
    const res = await GET(request(), context())
    const json = await res.json()

    expect(json.data.variants.square.inherited).toBe(true)
    expect(json.data.variants.story.inherited).toBe(false)
  })

  it('still returns the URLs when the metadata query fails', async () => {
    // Metadata is descriptive. Losing it must not cost the consumer the artwork.
    imagesResult.data = null
    imagesResult.error = { message: 'boom' }
    const res = await GET(request(), context())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.variants.square.url).toBe('https://cdn/square.png')
    expect(json.data.variants.square.inherited).toBe(true)
  })

  it('looks a non-uuid identifier up by slug, never by id', async () => {
    // events.id is a uuid column: handing it a slug raises a type error and
    // would surface a 500 for what is really a missing event.
    await GET(request('karaoke-night'), context('karaoke-night'))
    expect(eqMock).toHaveBeenCalledWith('slug', 'karaoke-night')
    expect(eqMock).not.toHaveBeenCalledWith('id', 'karaoke-night')
  })

  it('returns 500 rather than 404 when the event lookup itself fails', async () => {
    eventResult.data = null
    eventResult.error = { message: 'connection reset' }
    const res = await GET(request(), context())
    expect(res.status).toBe(500)
  })
})
