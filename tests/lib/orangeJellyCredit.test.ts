// @vitest-environment node
//
// The Orange Jelly credit under the sign-in card. orangejelly.co.uk owns the wording and the
// link; this site must show the fallback whenever the feed is missing, broken or points
// anywhere except orangejelly.co.uk, and must never break the page over it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FALLBACK_CREDIT,
  ORANGE_JELLY_CREDIT_SITE,
  getOrangeJellyCredit,
  parseOrangeJellyCredit,
} from '@/lib/orange-jelly-credit'

const VALID_FEED = {
  prefix: 'Built and maintained by',
  label: 'Orange Jelly',
  href: 'https://www.orangejelly.co.uk/solutions/hospitality-websites',
  nofollow: false,
}

describe('parseOrangeJellyCredit', () => {
  it('accepts a valid feed answer', () => {
    expect(parseOrangeJellyCredit(VALID_FEED)).toEqual({
      prefix: 'Built and maintained by',
      label: 'Orange Jelly',
      href: 'https://www.orangejelly.co.uk/solutions/hospitality-websites',
    })
  })

  it('allows an empty prefix', () => {
    expect(parseOrangeJellyCredit({ ...VALID_FEED, prefix: '' })).toMatchObject({ prefix: '', label: 'Orange Jelly' })
  })

  it('rejects a missing or empty label', () => {
    const { label: _label, ...withoutLabel } = VALID_FEED
    expect(parseOrangeJellyCredit(withoutLabel)).toBeNull()
    expect(parseOrangeJellyCredit({ ...VALID_FEED, label: '' })).toBeNull()
    expect(parseOrangeJellyCredit({ ...VALID_FEED, label: '   ' })).toBeNull()
  })

  it('rejects over-long text', () => {
    expect(parseOrangeJellyCredit({ ...VALID_FEED, prefix: 'a'.repeat(81) })).toBeNull()
    expect(parseOrangeJellyCredit({ ...VALID_FEED, label: 'a'.repeat(81) })).toBeNull()
  })

  it.each([
    ['a non-HTTPS link', 'http://www.orangejelly.co.uk/'],
    ['another host', 'https://example.com/'],
    ['a look-alike host', 'https://www.orangejelly.co.uk.evil.test/'],
    ['the bare domain', 'https://orangejelly.co.uk/'],
    ['credentials in the URL', 'https://user:pass@www.orangejelly.co.uk/'],
    ['something that is not a URL', 'not a url'],
  ])('rejects %s', (_case, href) => {
    expect(parseOrangeJellyCredit({ ...VALID_FEED, href })).toBeNull()
  })

  it.each([null, undefined, 'Orange Jelly', 42, true])('rejects non-object input (%s)', (input) => {
    expect(parseOrangeJellyCredit(input)).toBeNull()
  })

  it('gives rel="nofollow" only when nofollow is exactly true', () => {
    expect(parseOrangeJellyCredit({ ...VALID_FEED, nofollow: true })?.rel).toBe('nofollow')
    expect(parseOrangeJellyCredit({ ...VALID_FEED, nofollow: 'true' })).not.toHaveProperty('rel')
    expect(parseOrangeJellyCredit({ ...VALID_FEED, nofollow: 1 })).not.toHaveProperty('rel')
    expect(parseOrangeJellyCredit(VALID_FEED)).not.toHaveProperty('rel')
  })
})

describe('getOrangeJellyCredit', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    warnSpy.mockRestore()
  })

  it('returns the feed line when the feed answers 200 with a valid body', async () => {
    fetchMock.mockResolvedValue(Response.json(VALID_FEED))

    await expect(getOrangeJellyCredit()).resolves.toEqual({
      prefix: 'Built and maintained by',
      label: 'Orange Jelly',
      href: 'https://www.orangejelly.co.uk/solutions/hospitality-websites',
    })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('asks for this site on the feed, cached for a day, with a timeout signal', async () => {
    fetchMock.mockResolvedValue(Response.json(VALID_FEED))

    await getOrangeJellyCredit()

    expect(ORANGE_JELLY_CREDIT_SITE).toBe('management-tools')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://www.orangejelly.co.uk/api/credit/management-tools')
    expect(init?.next?.revalidate).toBe(86400)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns the fallback when the feed answers anything but 200', async () => {
    fetchMock.mockResolvedValue(new Response('Not found', { status: 404 }))

    await expect(getOrangeJellyCredit()).resolves.toEqual(FALLBACK_CREDIT)
    expect(warnSpy).toHaveBeenCalledWith('[orange-jelly-credit] showing the fallback line:', expect.any(Error))
  })

  it('returns the fallback when the feed cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(getOrangeJellyCredit()).resolves.toEqual(FALLBACK_CREDIT)
  })

  it('returns the fallback when the feed body is invalid', async () => {
    fetchMock.mockResolvedValue(Response.json({ ...VALID_FEED, href: 'https://example.com/' }))

    await expect(getOrangeJellyCredit()).resolves.toEqual(FALLBACK_CREDIT)
  })

  it('returns the fallback when the feed body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html></html>', { status: 200 }))

    await expect(getOrangeJellyCredit()).resolves.toEqual(FALLBACK_CREDIT)
  })

  it('rethrows a Next.js framework error that carries a digest', async () => {
    const frameworkError = Object.assign(new Error('Dynamic server usage'), { digest: 'DYNAMIC_SERVER_USAGE' })
    fetchMock.mockRejectedValue(frameworkError)

    await expect(getOrangeJellyCredit()).rejects.toBe(frameworkError)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('points the fallback at the Orange Jelly home page', () => {
    expect(FALLBACK_CREDIT).toEqual({
      prefix: 'Built and maintained by',
      label: 'Orange Jelly',
      href: 'https://www.orangejelly.co.uk/',
    })
  })
})
