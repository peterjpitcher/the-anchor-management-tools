// Cache policy is the load-bearing half of the scoped artwork design, so it is
// pinned here rather than left to the one route that needs it.
//
// The default must not move: every existing website route relies on
// `public, max-age=60` plus an ETag, and a regression would be invisible until
// the site got slower.

import { describe, expect, it } from 'vitest'
import { createApiResponse, createErrorResponse } from '../auth'

describe('createApiResponse cache policy', () => {
  it('leaves the public GET default exactly as it was', () => {
    const res = createApiResponse({ events: [] })
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, stale-while-revalidate=120')
    expect(res.headers.get('ETag')).toMatch(/^"[0-9a-f]{32}"$/)
  })

  it('keeps writes uncached, as before', () => {
    const res = createApiResponse({ ok: true }, 200, {}, 'POST')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('ETag')).toBeNull()
  })

  it('drops both the shared cache and the validator in private mode', () => {
    // An ETag on a scope-dependent body is the same cross-serving bug wearing a
    // different hat: a cache could answer 304 to a caller that should have been
    // given a different representation entirely.
    const res = createApiResponse({ variants: {} }, 200, {}, 'GET', 'private')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('ETag')).toBeNull()
  })

  it('applies private mode to errors too', () => {
    const res = createErrorResponse('Insufficient permissions', 'FORBIDDEN', 403, undefined, 'private')
    expect(res.status).toBe(403)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('ETag')).toBeNull()
  })

  it('gives two different bodies two different ETags in public mode', () => {
    // Guards the historic bug where every endpoint returned the same ETag.
    const a = createApiResponse({ events: [1] })
    const b = createApiResponse({ events: [2] })
    expect(a.headers.get('ETag')).not.toBe(b.headers.get('ETag'))
  })
})
