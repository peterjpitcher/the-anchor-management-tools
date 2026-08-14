import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Short link provisioning at schedule time.
 *
 * The service is mocked because what matters here is the contract this module owes the
 * renderer: the exact key it stores, the destination it asks for, and above all that a
 * destination it cannot shorten is dropped from the map rather than allowed to abort a
 * campaign that was otherwise ready to go.
 */

const { createShortLinkInternal } = vi.hoisted(() => ({ createShortLinkInternal: vi.fn() }))

vi.mock('@/services/short-links', () => ({
  ShortLinkService: { createShortLinkInternal },
}))

import { provisionCampaignLinks } from '../links'

const CAMPAIGN_ID = '11111111-2222-3333-4444-555555555555'

function shortLinkFor(code: string) {
  return { short_code: code, full_url: `https://l.the-anchor.pub/${code}`, already_exists: false }
}

function destinationOf(callIndex = 0): string {
  return createShortLinkInternal.mock.calls[callIndex][0].destination_url as string
}

beforeEach(() => {
  createShortLinkInternal.mockReset()
  let next = 0
  createShortLinkInternal.mockImplementation(async () => shortLinkFor(`mk${++next}`))
})

describe('provisionCampaignLinks', () => {
  it('maps the original URL to its short link, because that is what the renderer looks up', async () => {
    // The stored destination carries the UTM parameters; the key must not, or the href in the
    // rendered email would never match it.
    const { linkMap, failures } = await provisionCampaignLinks({
      campaignId: CAMPAIGN_ID,
      utmCampaign: 'christmas-2026',
      destinations: ['https://www.the-anchor.pub/food-menu'],
    })

    expect(failures).toEqual([])
    expect(linkMap).toEqual({
      'https://www.the-anchor.pub/food-menu': 'https://l.the-anchor.pub/mk1',
    })
  })

  it('tags the destination with the campaign UTMs, which is how the visit shows up in site analytics', async () => {
    await provisionCampaignLinks({
      campaignId: CAMPAIGN_ID,
      utmCampaign: 'christmas-2026',
      destinations: ['https://www.the-anchor.pub/food-menu'],
    })

    const destination = new URL(destinationOf())
    expect(destination.searchParams.get('utm_source')).toBe('marketing_email')
    expect(destination.searchParams.get('utm_medium')).toBe('email')
    expect(destination.searchParams.get('utm_campaign')).toBe('christmas-2026')
  })

  it('files the link under the marketing type with traceable metadata', async () => {
    // The type is what keeps campaign links filterable in the short link reports, and the
    // original URL is the only way back to what the designer wrote once UTMs are baked in.
    await provisionCampaignLinks({
      campaignId: CAMPAIGN_ID,
      utmCampaign: 'christmas-2026',
      destinations: ['https://www.the-anchor.pub/food-menu'],
    })

    const payload = createShortLinkInternal.mock.calls[0][0]
    expect(payload.link_type).toBe('marketing_email')
    expect(payload.metadata).toMatchObject({
      channel: 'marketing_email',
      campaign_id: CAMPAIGN_ID,
      utm_campaign: 'christmas-2026',
      original_url: 'https://www.the-anchor.pub/food-menu',
    })
  })

  it('keeps a fragment at the end, so an anchor link still jumps to the enquiry form', async () => {
    // Appending the query after the fragment produces a URL that loads the page and then
    // ignores both the anchor and the tracking.
    await provisionCampaignLinks({
      campaignId: CAMPAIGN_ID,
      utmCampaign: 'christmas-2026',
      destinations: ['https://www.the-anchor.pub/christmas-parties#enquiry'],
    })

    expect(destinationOf()).toMatch(/#enquiry$/)
    expect(destinationOf()).toContain('utm_campaign=christmas-2026')
  })

  it('composes with a query string the designer already put on the link', async () => {
    await provisionCampaignLinks({
      campaignId: CAMPAIGN_ID,
      utmCampaign: 'christmas-2026',
      destinations: ['https://www.the-anchor.pub/food-menu?tab=sunday'],
    })

    const destination = new URL(destinationOf())
    expect(destination.searchParams.get('tab')).toBe('sunday')
    expect(destination.searchParams.get('utm_source')).toBe('marketing_email')
  })

  it('leaves a hand-tagged parameter alone, since overwriting it would split the reporting', async () => {
    await provisionCampaignLinks({
      campaignId: CAMPAIGN_ID,
      utmCampaign: 'christmas-2026',
      destinations: ['https://www.the-anchor.pub/food-menu?utm_campaign=printed-flyer'],
    })

    const destination = new URL(destinationOf())
    expect(destination.searchParams.get('utm_campaign')).toBe('printed-flyer')
    expect(destination.searchParams.getAll('utm_campaign')).toHaveLength(1)
  })

  it('reuses an existing link on a re-schedule rather than fragmenting the click history', async () => {
    createShortLinkInternal.mockResolvedValue({
      short_code: 'mk1',
      full_url: 'https://l.the-anchor.pub/mk1',
      already_exists: true,
    })

    const args = {
      campaignId: CAMPAIGN_ID,
      utmCampaign: 'christmas-2026',
      destinations: ['https://www.the-anchor.pub/food-menu'],
    }

    const first = await provisionCampaignLinks(args)
    const second = await provisionCampaignLinks(args)

    expect(second.linkMap).toEqual(first.linkMap)
    expect(destinationOf(0)).toBe(destinationOf(1))
  })

  it('skips a third-party destination and reports it, rather than failing the whole schedule', async () => {
    // We cannot shorten somebody else's domain, and refusing to schedule over it would trade
    // a real send for a reporting nicety.
    const { linkMap, failures } = await provisionCampaignLinks({
      campaignId: CAMPAIGN_ID,
      utmCampaign: 'christmas-2026',
      destinations: ['https://www.facebook.com/theanchorpubsm/', 'https://www.the-anchor.pub/food-menu'],
    })

    expect(Object.keys(linkMap)).toEqual(['https://www.the-anchor.pub/food-menu'])
    expect(failures).toHaveLength(1)
    expect(failures[0].url).toBe('https://www.facebook.com/theanchorpubsm/')
    expect(failures[0].error).toMatch(/approved Anchor or Orange Jelly domains/i)
  })

  it('carries on when one link fails to create, so the rest of the campaign stays tracked', async () => {
    createShortLinkInternal
      .mockRejectedValueOnce(new Error('Failed to create short link'))
      .mockResolvedValueOnce(shortLinkFor('mk2'))

    const { linkMap, failures } = await provisionCampaignLinks({
      campaignId: CAMPAIGN_ID,
      utmCampaign: 'christmas-2026',
      destinations: ['https://www.the-anchor.pub/christmas-parties', 'https://www.the-anchor.pub/food-menu'],
    })

    expect(linkMap).toEqual({
      'https://www.the-anchor.pub/food-menu': 'https://l.the-anchor.pub/mk2',
    })
    expect(failures).toEqual([
      { url: 'https://www.the-anchor.pub/christmas-parties', error: 'Failed to create short link' },
    ])
  })

  it('does nothing at all when the campaign links nowhere', async () => {
    const { linkMap, failures } = await provisionCampaignLinks({
      campaignId: CAMPAIGN_ID,
      utmCampaign: 'christmas-2026',
      destinations: [],
    })

    expect(linkMap).toEqual({})
    expect(failures).toEqual([])
    expect(createShortLinkInternal).not.toHaveBeenCalled()
  })
})
