import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { marketingContentSchema, type MarketingContent } from '../registry'
import {
  UNSUBSCRIBE_TOKEN,
  applyDeliveryTransforms,
  collectDestinationUrls,
  renderCampaignHtml,
  renderMarketingEmail,
} from '../render'

/**
 * Stage two is where a marketing email stops being a document and becomes something sent to a
 * named person, so the failures here are the ones with consequences: an unsubscribe link that
 * does not work, a design silently rewritten on its way out of the door, or a message so long
 * Gmail clips it and hides the opt-out below the fold.
 *
 * The central assertion is the allow-listed diff. Stage two is allowed to change exactly one
 * thing when no links are being rewritten, and this file proves it changes nothing else.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CAMPAIGN_JSON = path.join(HERE, '..', 'campaigns', 'christmas-and-lunch-2026.json')

const campaign = marketingContentSchema.parse(JSON.parse(readFileSync(CAMPAIGN_JSON, 'utf8')))

const UNSUBSCRIBE_URL = 'https://management.orangejelly.co.uk/api/unsubscribe?t=tok-abc123'

const UTM = { source: 'anchor', medium: 'email', campaign: 'christmas-2026' }

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('the unsubscribe placeholder', () => {
  it('is swapped for this recipient\'s own URL, because the link is per person not per campaign', () => {
    const html = applyDeliveryTransforms(renderCampaignHtml(campaign), {
      unsubscribeUrl: UNSUBSCRIBE_URL,
    })
    expect(html).toContain(`href="${UNSUBSCRIBE_URL}"`)
  })

  it('does not survive anywhere in the output, not even outside an href', () => {
    // A leftover token renders as a dead link the guest cannot use, which is the one failure
    // they cannot report and the one that removes our basis for sending at all.
    const html = applyDeliveryTransforms(renderCampaignHtml(campaign), {
      unsubscribeUrl: UNSUBSCRIBE_URL,
    })
    expect(html).not.toContain(UNSUBSCRIBE_TOKEN)
  })

  it('is replaced in the plain-text part too, which some recipients are the only ones to see', () => {
    const { text } = renderMarketingEmail(campaign, { unsubscribeUrl: UNSUBSCRIBE_URL })
    expect(text).not.toContain(UNSUBSCRIBE_TOKEN)
    expect(text).toContain(UNSUBSCRIBE_URL)
  })
})

describe('renderMarketingEmail refuses to produce an unsendable email', () => {
  it('throws when no unsubscribe URL is supplied, rather than sending without an opt-out', () => {
    expect(() => renderMarketingEmail(campaign, { unsubscribeUrl: '' })).toThrow(
      /cannot be rendered without an unsubscribe URL/i,
    )
  })

  it('throws when the placeholder would survive, so a dead link never reaches an inbox', () => {
    // The realistic way this happens: the unsubscribe URL is itself built from an
    // untemplated string and still carries the token, so substituting it puts the token back.
    expect(() =>
      renderMarketingEmail(campaign, {
        unsubscribeUrl: `https://management.orangejelly.co.uk/api/unsubscribe?t=${UNSUBSCRIBE_TOKEN}`,
      }),
    ).toThrow(/placeholder survived/i)
  })
})

describe('the diff between the pure stage and the delivery stage', () => {
  it('is the unsubscribe URL and nothing else when no links are being rewritten', () => {
    // This is the guarantee that makes the fidelity tests worth having. If stage two could
    // quietly alter anything else, proving stage one matches the handover would prove nothing
    // about what is actually delivered.
    const pure = renderCampaignHtml(campaign)
    const delivered = applyDeliveryTransforms(pure, { unsubscribeUrl: UNSUBSCRIBE_URL })

    const reversed = delivered.split(UNSUBSCRIBE_URL).join(UNSUBSCRIBE_TOKEN)
    expect(reversed).toBe(pure)
  })

  it('leaves tel and mailto links untouched, since they carry no tracking to add', () => {
    const delivered = applyDeliveryTransforms(renderCampaignHtml(campaign), {
      unsubscribeUrl: UNSUBSCRIBE_URL,
      utm: UTM,
    })
    expect(delivered).toContain('href="tel:+441753682707"')
  })
})

describe('UTM tagging', () => {
  const delivered = applyDeliveryTransforms(renderCampaignHtml(campaign), {
    unsubscribeUrl: UNSUBSCRIBE_URL,
    utm: UTM,
  })

  it('tags our own links, which is the only way the campaign shows up in site analytics', () => {
    expect(delivered).toContain(
      'href="https://www.the-anchor.pub/food-menu?utm_source=anchor&amp;utm_medium=email&amp;utm_campaign=christmas-2026"',
    )
  })

  it('keeps the fragment at the end, so an anchor link still jumps to the enquiry form', () => {
    // Appending the query after the fragment would produce a URL that loads the page and
    // ignores both the anchor and the tracking.
    expect(delivered).toContain(
      'href="https://www.the-anchor.pub/christmas-parties?utm_source=anchor&amp;utm_medium=email&amp;utm_campaign=christmas-2026#enquiry"',
    )
  })

  it('never tags the unsubscribe link, which has to keep working for years unaided', () => {
    const onOurDomain = 'https://www.the-anchor.pub/unsubscribe?t=tok-abc123'
    const html = applyDeliveryTransforms(renderCampaignHtml(campaign), {
      unsubscribeUrl: onOurDomain,
      utm: UTM,
    })
    // Worth pinning even when the URL sits on the domain that otherwise gets tagged: the
    // guard is the identity check, not the domain test.
    expect(html).toContain(`href="${onOurDomain}"`)
    expect(html).not.toContain(`${onOurDomain}&amp;utm_source`)
  })

  it.each([
    ['Facebook', 'https://www.facebook.com/theanchorpubsm/'],
    ['Instagram', 'https://www.instagram.com/theanchor.pub/'],
    ['WhatsApp', 'https://wa.me/441753682707'],
  ])('leaves the %s link exactly as the designer wrote it', (_name, url) => {
    // Tagging somebody else's domain is both pointless, since we cannot read their analytics,
    // and a good way to have a link rejected or rewritten in transit.
    expect(delivered).toContain(`href="${url}"`)
  })

  it('is idempotent, so a retried send does not stack a second copy of the parameters', () => {
    const context = { unsubscribeUrl: UNSUBSCRIBE_URL, utm: UTM }
    const once = applyDeliveryTransforms(renderCampaignHtml(campaign), context)
    const twice = applyDeliveryTransforms(once, context)

    expect(twice).toBe(once)
    expect(countOccurrences(twice, 'utm_source=')).toBe(countOccurrences(once, 'utm_source='))
  })
})

describe('the link map', () => {
  const linkMap = { 'https://www.the-anchor.pub/food-menu': 'https://vip-club.uk/mk/a1b2c3' }

  const delivered = applyDeliveryTransforms(renderCampaignHtml(campaign), {
    unsubscribeUrl: UNSUBSCRIBE_URL,
    linkMap,
    utm: UTM,
  })

  it('sends a mapped destination through its short link, which is how clicks get counted', () => {
    expect(delivered).toContain('href="https://vip-club.uk/mk/a1b2c3"')
    expect(delivered).not.toContain('href="https://www.the-anchor.pub/food-menu')
  })

  it('leaves an unmapped destination alone rather than dropping it', () => {
    // A partially provisioned map must degrade to a working link, never to a broken one.
    expect(delivered).toContain('https://www.the-anchor.pub/christmas-parties?utm_source=anchor')
  })
})

describe('the size guard', () => {
  function oversizedCampaign(): MarketingContent {
    const paragraph = 'Long copy that a well meaning marketer kept pasting in. '.repeat(10).slice(0, 590)
    const listItems = Array.from({ length: 8 }, (_, i) => `Point ${i + 1}, at the length a real one runs to.`)

    return {
      schema_version: 1,
      title: 'Too much of a good thing',
      preheader: 'Padded until Gmail would clip it, which is where the unsubscribe link disappears.',
      blocks: Array.from({ length: 60 }, () => ({
        type: 'text_block',
        data: {
          heading: 'A section that grew and grew',
          body: [paragraph, paragraph, paragraph, paragraph],
          list_items: listItems,
        },
      })),
    }
  }

  it('rejects an email over the limit, because Gmail clips long messages and hides the opt-out', () => {
    expect(() =>
      renderMarketingEmail(oversizedCampaign(), { unsubscribeUrl: UNSUBSCRIBE_URL }),
    ).toThrow(/80KB limit/)
  })

  it('fires on content the schema is perfectly happy with, so validation alone is not enough', () => {
    // 60 blocks is the schema maximum and each field is within its own limit. Size is a
    // separate axis, and this is why the guard lives at render time rather than at write time.
    expect(marketingContentSchema.safeParse(oversizedCampaign()).success).toBe(true)
  })

  it('reports the real campaign\'s size, which sits well inside the limit', () => {
    const { sizeBytes, html } = renderMarketingEmail(campaign, { unsubscribeUrl: UNSUBSCRIBE_URL })
    expect(sizeBytes).toBe(Buffer.byteLength(html, 'utf8'))
    expect(sizeBytes).toBeLessThan(80 * 1024)
  })
})

describe('collectDestinationUrls', () => {
  it('returns our own destinations, deduped and sorted, ready to provision short links from', () => {
    // Called once at schedule time so rendering never has to reach the database mid-send.
    expect(collectDestinationUrls(campaign)).toEqual([
      'https://www.the-anchor.pub',
      'https://www.the-anchor.pub/christmas-parties',
      'https://www.the-anchor.pub/christmas-parties#enquiry',
      'https://www.the-anchor.pub/food-menu',
    ])
  })

  it('never offers the unsubscribe placeholder for shortening', () => {
    // Shortening the opt-out would tie it to the redirector still existing years from now.
    const urls = collectDestinationUrls(campaign)
    expect(urls.some((url) => url.includes(UNSUBSCRIBE_TOKEN))).toBe(false)
  })

  it('leaves third-party destinations out, since we cannot track clicks we do not own', () => {
    const urls = collectDestinationUrls(campaign)
    expect(urls.filter((url) => !/^https:\/\/www\.the-anchor\.pub/.test(url))).toEqual([])
  })
})
