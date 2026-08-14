import { assertAllowedShortLinkDestination } from '@/lib/short-links/destination-allowlist'
import { deriveShortLinkName } from '@/lib/short-links/names'
import { ShortLinkService } from '@/services/short-links'

import { MARKETING_UTM_MEDIUM, MARKETING_UTM_SOURCE } from './config'

/**
 * Campaign short links.
 *
 * Resend's domain-level click tracking is deliberately off, because the sending domain is
 * shared with transactional email and a rewritten link inside a booking confirmation is a
 * support call the venue cannot afford. Click attribution therefore runs on our own
 * redirector instead.
 *
 * The shape is one short link per DESTINATION, provisioned once when the campaign is
 * scheduled, not one per destination per person. The individual is identified at send time by
 * a `utm_content` parameter the renderer appends to the short URL, which the redirect route
 * forwards to the destination and records on the click row. That keeps rendering pure and
 * free of database calls mid-send, and keeps the number of short links proportional to the
 * number of links in the email rather than to the size of the audience.
 */

export interface CampaignLinkFailure {
  url: string
  error: string
}

export interface CampaignLinkProvisionResult {
  /** Original destination URL to its short URL. Fed straight into the renderer's link map. */
  linkMap: Record<string, string>
  /** Destinations that could not be shortened. They still send, just untracked. */
  failures: CampaignLinkFailure[]
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const

/**
 * The URL the short link points at.
 *
 * Only missing parameters are filled in. A designer who tagged a link by hand meant it, and
 * overwriting their `utm_campaign` would silently split one campaign's reporting in two.
 * `URL` is used rather than string concatenation so an existing query string and a trailing
 * fragment both survive: appending after a `#enquiry` anchor produces a link that loads the
 * page and then ignores both the anchor and the tracking.
 */
function withCampaignUtm(url: string, utmCampaign: string): string {
  const parsed = new URL(url)

  const values: Record<(typeof UTM_KEYS)[number], string> = {
    utm_source: MARKETING_UTM_SOURCE,
    utm_medium: MARKETING_UTM_MEDIUM,
    utm_campaign: utmCampaign,
  }

  for (const key of UTM_KEYS) {
    if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, values[key])
  }

  return parsed.toString()
}

/**
 * Creates one short link per destination and returns the map to store on the campaign.
 *
 * Idempotent by construction: `createShortLinkInternal` dedupes on the exact destination URL
 * and hands back the existing row, so re-scheduling a campaign reuses the links it already
 * has rather than fragmenting its click history across a second set of codes.
 *
 * Nothing here throws for a single bad destination. A URL that is rejected, malformed, or
 * fails to create is reported and left out of the map, and the renderer then falls back to
 * plain UTM tagging for it. A campaign that goes out with one untracked link is a reporting
 * gap; a campaign that fails to schedule is a missed send.
 *
 * Sequential rather than parallel on purpose. A marketing email carries a handful of links,
 * so there is nothing to gain from concurrency, and serial calls keep the dedupe read and the
 * create write from interleaving.
 */
export async function provisionCampaignLinks(params: {
  campaignId: string
  utmCampaign: string
  destinations: string[]
}): Promise<CampaignLinkProvisionResult> {
  const linkMap: Record<string, string> = {}
  const failures: CampaignLinkFailure[] = []

  for (const original of params.destinations) {
    try {
      // Checked before the round trip so a third-party URL is reported as a skip rather than
      // surfacing as a database error further down.
      const destinationUrl = assertAllowedShortLinkDestination(
        withCampaignUtm(original, params.utmCampaign),
      )

      const created = await ShortLinkService.createShortLinkInternal({
        destination_url: destinationUrl,
        link_type: 'marketing_email',
        name: `Marketing: ${deriveShortLinkName(original)}`,
        metadata: {
          channel: 'marketing_email',
          campaign_id: params.campaignId,
          utm_campaign: params.utmCampaign,
          // Kept so a link can be traced back to what the designer actually wrote, after the
          // UTM parameters have been baked into the stored destination.
          original_url: original,
        },
      })

      // Keyed on the ORIGINAL string, because that is what the renderer looks up from the
      // rendered href. The stored destination differs by its UTM parameters.
      linkMap[original] = created.full_url
    } catch (error) {
      failures.push({
        url: original,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return { linkMap, failures }
}
