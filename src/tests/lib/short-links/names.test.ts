import { describe, expect, it } from 'vitest'
import { deriveShortLinkName, resolveShortLinkName } from '@/lib/short-links/names'

describe('deriveShortLinkName', () => {
  it('uses the final readable URL segment', () => {
    expect(deriveShortLinkName('https://www.the-anchor.pub/sunday-lunch')).toBe('Sunday Lunch')
    expect(deriveShortLinkName('https://www.the-anchor.pub/blog/support-your-local-pub-stanwell-moor')).toBe('Support Your Local Pub Stanwell Moor')
  })

  it('uses the host when there is no useful path', () => {
    expect(deriveShortLinkName('https://www.the-anchor.pub/')).toBe('The Anchor Pub')
  })

  it('skips opaque guest tokens and uses the action segment', () => {
    expect(deriveShortLinkName('https://management.orangejelly.co.uk/g/0123456789abcdefghijklmnop/table-payment')).toBe('Table Payment')
  })

  it('names review redirect links without exposing token path parts', () => {
    expect(deriveShortLinkName('https://management.orangejelly.co.uk/r/TfhgeMJMapFrZZFN_nsjjsfmGrNX2qP7pswcyb_YJiI')).toBe('Review Link')
  })

  it('prefers a provided non-empty name', () => {
    expect(resolveShortLinkName('  Sunday Menu  ', 'https://www.the-anchor.pub/sunday-lunch')).toBe('Sunday Menu')
  })
})
