import { describe, expect, it } from 'vitest'
import cases from '../../fixtures/event-seo/website-parity-cases.json'
import {
  findRetiredFormats,
  findWebsiteBannedClaims,
  readsAsInvitation,
  retiredKeywordTierError,
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

describe('keyword tiers that name a retired format (spec 6.2.6)', () => {
  it('refuses a tier with live music, open mic, games night, drag cabaret or drag show', () => {
    for (const term of ['live music', 'Open Mic Night', 'games night', 'drag cabaret', 'drag show']) {
      expect(retiredKeywordTierError({ secondary: [term] })).toMatch(/Remove/)
    }
  })

  it('names the format and says why', () => {
    expect(retiredKeywordTierError({ primary: ['christmas live music'] })).toBe(
      'Remove "live music" from the keywords. We no longer run that format, and the website takes the event page out of search when its keywords name it.',
    )
  })

  it('lets music bingo through, including "live music bingo"', () => {
    expect(retiredKeywordTierError({ primary: ['live music bingo'], secondary: ['music bingo night'] })).toBeNull()
  })

  it('checks each term on its own, so neighbours cannot join into a retired phrase', () => {
    expect(retiredKeywordTierError({ secondary: ['karaoke live', 'music quiz'] })).toBeNull()
  })

  it('accepts the approved category tiers', () => {
    expect(
      retiredKeywordTierError({
        secondary: ['music bingo', 'drag bingo', 'musical bingo', 'music bingo night', 'pub quiz', 'karaoke night'],
        local: ['Stanwell Moor', 'Staines', 'Heathrow', 'Feltham'],
      }),
    ).toBeNull()
  })
})
