import { describe, expect, it } from 'vitest'
import cases from '../../fixtures/event-seo/website-parity-cases.json'
import {
  findRetiredFormats,
  findWebsiteBannedClaims,
  readsAsInvitation,
  titleCarriesDate,
  websiteEventPageTitle,
} from '@/lib/event-seo/website-parity'
import { EVENT_SEO_LIMITS } from '@/lib/event-seo/limits'

describe('website page titles (getEventPageTitle)', () => {
  it.each(cases.titles)('$name with $metaTitle', (c) => {
    const event = { name: c.name, metaTitle: c.metaTitle, date: c.date }
    if ('onSale' in c && c.onSale) expect(websiteEventPageTitle(event, false)).toBe(c.onSale)
    if ('after' in c && c.after) expect(websiteEventPageTitle(event, true)).toBe(c.after)
  })

  it('fits the spec example inside the website budget both ways', () => {
    const event = { name: 'Sleigh My Name: Festive Music Bingo', metaTitle: 'Christmas Music Bingo', date: '2026-12-11' }
    expect(websiteEventPageTitle(event, false).length).toBeLessThanOrEqual(EVENT_SEO_LIMITS.websiteTitleChars)
    expect(websiteEventPageTitle(event, true).length).toBeLessThanOrEqual(EVENT_SEO_LIMITS.websiteTitleChars)
  })

  it('a stored title of the maximum length still fits with the longest date', () => {
    const stem = 'x'.repeat(EVENT_SEO_LIMITS.metaTitleChars.max)
    expect(`${stem}, 30 September 2026`.length).toBeLessThanOrEqual(EVENT_SEO_LIMITS.websiteTitleChars)
  })

  it('spots a date in a title', () => {
    expect(titleCarriesDate('Quiz | 7 October')).toBe(true)
    expect(titleCarriesDate('Christmas Music Bingo')).toBe(false)
  })
})

describe('readsAsInvitation', () => {
  it.each(cases.invitations)('$text', (c) => {
    expect(readsAsInvitation(c.text)).toBe(c.invitation)
  })
})

describe('banned claims and retired formats', () => {
  it.each(cases.bannedClaims)('$text', (c) => {
    expect(findWebsiteBannedClaims([c.text])).toEqual(c.claims)
  })

  it.each(cases.retiredFormats)('$text', (c) => {
    expect(findRetiredFormats([c.text])).toEqual(c.formats)
  })
})
