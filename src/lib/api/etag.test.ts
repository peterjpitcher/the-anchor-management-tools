/**
 * ETag correctness for the public API.
 *
 * Regression guard for a live bug: createApiResponse built the validator as
 * `Buffer.from(JSON.stringify(payload)).toString('base64').slice(0, 27)`.
 * 27 base64 characters cover roughly the first 20 bytes, and the payload is
 * normalised to `{ success: true, data }`, so those bytes were always the
 * literal `{"success":true,"dat`.
 *
 * Every endpoint returned the identical ETag. Verified against production:
 * /api/events, /api/menu and /api/business/hours all returned
 * W/"eyJzdWNjZXNzIjp0cnVlLCJkYXR", and sending the events ETag to /api/menu
 * with If-None-Match returned 304 Not Modified. A client honouring that would
 * serve the wrong cached body.
 */

import { describe, expect, it } from 'vitest'
import { createApiResponse } from './auth'

function etagOf(data: unknown, method = 'GET'): string | null {
  return createApiResponse(data, 200, {}, method).headers.get('ETag')
}

describe('createApiResponse ETag', () => {
  it('differs between two different payloads', () => {
    const events = etagOf({ events: [{ id: 'a', name: 'Quiz Night' }] })
    const menu = etagOf({ menu: [{ id: 'b', name: 'Burger' }] })
    expect(events).not.toBeNull()
    expect(events).not.toBe(menu)
  })

  it('is identical for identical payloads', () => {
    const a = etagOf({ events: [{ id: 'a' }] })
    const b = etagOf({ events: [{ id: 'a' }] })
    expect(a).toBe(b)
  })

  it('changes when a nested value deep in the payload changes', () => {
    // The old implementation could not see past the envelope prefix, so any
    // change below the first ~20 bytes was invisible to it.
    const before = etagOf({ events: [{ id: 'a', name: 'Quiz Night', price: 3 }] })
    const after = etagOf({ events: [{ id: 'a', name: 'Quiz Night', price: 5 }] })
    expect(before).not.toBe(after)
  })

  it('never emits the constant envelope-prefix validator again', () => {
    const tag = etagOf({ anything: true })
    expect(tag).not.toContain('eyJzdWNjZXNzIjp0cnVlLCJkYXR')
  })

  it('is a 32-character hex hash', () => {
    const tag = etagOf({ events: [] })
    expect(tag).toMatch(/^"[0-9a-f]{32}"$/)
  })

  it('is only set on cacheable methods', () => {
    expect(etagOf({ ok: true }, 'GET')).not.toBeNull()
    expect(etagOf({ ok: true }, 'POST')).toBeNull()
  })
})
