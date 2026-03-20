import type { ShortLinkChannel } from './channels'

/** Slugify a link name for use as utm_campaign */
export function slugifyCampaign(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 100)
}

/** Append UTM params to a destination URL */
export function buildUtmUrl(
  destinationUrl: string,
  channel: ShortLinkChannel,
  campaignName: string
): string {
  const url = new URL(destinationUrl)
  const campaign = slugifyCampaign(campaignName)

  url.searchParams.set('utm_source', channel.utmSource)
  url.searchParams.set('utm_medium', channel.utmMedium)
  url.searchParams.set('utm_campaign', campaign)
  url.searchParams.set('utm_content', channel.utmContent)

  return url.toString()
}

/** Build variant display name: "Parent Name — Channel Label" */
export function buildVariantName(parentName: string, channelLabel: string): string {
  return `${parentName} \u2014 ${channelLabel}`
}
