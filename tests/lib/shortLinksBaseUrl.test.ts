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
  it('defaults to vip-club.uk when unset', () => {
    delete process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL
    expect(getShortLinkBaseUrl()).toBe('https://vip-club.uk')
    expect(buildShortLinkUrl('abc123')).toBe('https://vip-club.uk/abc123')
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

