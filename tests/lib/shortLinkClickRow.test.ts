import { describe, expect, it } from 'vitest'
import { clipShortLinkClickRow, SHORT_LINK_CLICK_COLUMN_LIMITS } from '@/lib/short-links/click-row'

// Copied from production information_schema on 21 Sep 2026, not from the module, so a
// wrong limit in the module fails here rather than agreeing with itself.
const PRODUCTION_VARCHAR_LIMITS: Record<string, number> = {
  country: 2,
  city: 100,
  region: 100,
  device_type: 20,
  browser: 50,
  os: 50,
  utm_source: 100,
  utm_medium: 100,
  utm_campaign: 100,
  utm_content: 100,
}

describe('clipShortLinkClickRow', () => {
  it('knows every varchar column on short_link_clicks at its production limit', () => {
    expect(SHORT_LINK_CLICK_COLUMN_LIMITS).toEqual(PRODUCTION_VARCHAR_LIMITS)
  })

  it('clips every limited column that is over its limit', () => {
    const row = Object.fromEntries(
      Object.keys(PRODUCTION_VARCHAR_LIMITS).map((column) => [column, 'x'.repeat(250)])
    )

    const clipped = clipShortLinkClickRow(row)

    for (const [column, limit] of Object.entries(PRODUCTION_VARCHAR_LIMITS)) {
      expect(clipped[column]).toBe('x'.repeat(limit))
    }
  })

  it('keeps the start of a Facebook ad name, which is what fits', () => {
    const adName = 'ad__evergreen_weekday_dinner_promotion_the_anchor__evergreen_test_local_only_5mi_local_only_18_plus_mobile_feed_and_stories_placements_v2'

    const clipped = clipShortLinkClickRow({ utm_content: adName })

    expect(clipped.utm_content).toBe(adName.slice(0, 100))
  })

  it('leaves short values, nulls and unlimited columns alone', () => {
    const longUserAgent = `Mozilla/5.0 ${'x'.repeat(600)}`
    const row = {
      short_link_id: 'link-1',
      user_agent: longUserAgent,
      referrer: `https://example.com/${'y'.repeat(600)}`,
      request_host: 'l.the-anchor.pub',
      country: 'GB',
      city: 'Staines-upon-Thames',
      region: null,
      utm_source: undefined,
      metadata: { alias_code: 'abc123' },
    }

    expect(clipShortLinkClickRow(row)).toEqual(row)
  })

  it('counts characters as Postgres does, so an emoji is never split', () => {
    const clipped = clipShortLinkClickRow({ city: '\u{1F37A}'.repeat(150) })

    expect(clipped.city).toBe('\u{1F37A}'.repeat(100))
    expect(Array.from(clipped.city as string)).toHaveLength(100)
  })

  it('does not change the row it was given', () => {
    const row = { utm_campaign: 'c'.repeat(150) }

    clipShortLinkClickRow(row)

    expect(row.utm_campaign).toHaveLength(150)
  })
})
