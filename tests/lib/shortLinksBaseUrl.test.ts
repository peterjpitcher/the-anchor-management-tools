import { afterEach, describe, expect, it } from 'vitest'

import { buildShortLinkUrl, getShortLinkBaseUrl } from '@/lib/short-links/base-url'

const ORIGINAL_BASE_URL = process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL

afterEach(() => {
  if (ORIGINAL_BASE_URL === undefined) {
    delete process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL
  } else {
    process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL = ORIGINAL_BASE_URL
  }
})

describe('short link base URL', () => {
  // Updated: default changed from vip-club.uk to l.the-anchor.pub
  it('defaults to l.the-anchor.pub when unset', () => {
    delete process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL
    expect(getShortLinkBaseUrl()).toBe('https://l.the-anchor.pub')
    expect(buildShortLinkUrl('abc123')).toBe('https://l.the-anchor.pub/abc123')
  })

  it('strips trailing slashes from the configured base', () => {
    process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL = 'https://www.the-anchor.pub/l/'
    expect(getShortLinkBaseUrl()).toBe('https://www.the-anchor.pub/l')
    expect(buildShortLinkUrl('abc123')).toBe('https://www.the-anchor.pub/l/abc123')
  })

  it('avoids double slashes when codes contain a leading slash', () => {
    process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL = 'https://www.vip-club.uk'
    expect(buildShortLinkUrl('/abc123')).toBe('https://www.vip-club.uk/abc123')
  })
})

