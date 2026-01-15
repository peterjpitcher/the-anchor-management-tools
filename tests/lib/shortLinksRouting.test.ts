import { describe, expect, it } from 'vitest'

import { isShortLinkHost, isShortLinkPath } from '@/lib/short-links/routing'

describe('short link routing helpers', () => {
  it('recognizes short-link hosts (including subdomains)', () => {
    expect(isShortLinkHost('vip-club.uk')).toBe(true)
    expect(isShortLinkHost('www.vip-club.uk')).toBe(true)
    expect(isShortLinkHost('the-anchor.pub')).toBe(true)
    expect(isShortLinkHost('www.the-anchor.pub')).toBe(true)
    expect(isShortLinkHost('management.orangejelly.co.uk')).toBe(false)
  })

  it('recognizes short-link paths and excludes reserved routes', () => {
    expect(isShortLinkPath('/fba2be85')).toBe(true)
    expect(isShortLinkPath('/l/fba2be85')).toBe(true)

    expect(isShortLinkPath('/settings')).toBe(false)
    expect(isShortLinkPath('/short-links')).toBe(false)
    expect(isShortLinkPath('/api/redirect/fba2be85')).toBe(false)
    expect(isShortLinkPath('/l')).toBe(false)

    expect(isShortLinkPath('/ab')).toBe(false)
    expect(isShortLinkPath('/a_b_c')).toBe(false)
  })
})

