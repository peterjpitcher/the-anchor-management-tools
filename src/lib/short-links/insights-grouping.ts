import type { AnalyticsLinkRow, CampaignGroup } from '@/types/short-links'
import { CHANNEL_MAP } from './channels'

export function groupLinksIntoCampaigns(links: AnalyticsLinkRow[]): {
  campaigns: CampaignGroup[]
  standalone: AnalyticsLinkRow[]
  channelTotals: Array<{ channel: string; label: string; type: string; clicks: number }>
} {
  const parentIds = new Set<string>()
  for (const link of links) {
    if (link.parentLinkId) parentIds.add(link.parentLinkId)
  }

  const parentMap = new Map<string, AnalyticsLinkRow>()
  const variantsByParent = new Map<string, AnalyticsLinkRow[]>()
  const standalone: AnalyticsLinkRow[] = []

  for (const link of links) {
    if (link.parentLinkId) {
      const existing = variantsByParent.get(link.parentLinkId) || []
      existing.push(link)
      variantsByParent.set(link.parentLinkId, existing)
    } else if (parentIds.has(link.id)) {
      parentMap.set(link.id, link)
    } else {
      standalone.push(link)
    }
  }

  // Handle orphaned variants: their parent has 0 clicks and isn't in the RPC response.
  // Create a synthetic parent from the variant metadata so they still group properly.
  for (const [parentId, variants] of variantsByParent) {
    if (!parentMap.has(parentId) && variants.length > 0) {
      const firstVariant = variants[0]
      // Extract event name from variant name (before the em-dash) or metadata
      const meta = (firstVariant.metadata as Record<string, unknown>) || {}
      const eventName = (meta.event_name as string) ||
        (firstVariant.name?.includes('\u2014') ? firstVariant.name.split('\u2014')[0].trim() : null) ||
        'Campaign'
      // Strip UTM params from destination to get the base URL
      const baseUrl = firstVariant.destinationUrl.split('?')[0]
      parentMap.set(parentId, {
        id: parentId,
        shortCode: '',
        linkType: firstVariant.linkType,
        destinationUrl: baseUrl,
        name: eventName,
        parentLinkId: null,
        metadata: meta,
        createdAt: firstVariant.createdAt,
        totalClicks: 0,
        uniqueVisitors: 0,
        data: [],
      })
    }
  }

  const campaigns: CampaignGroup[] = []
  const channelTotalsMap = new Map<string, number>()

  for (const [parentId, parent] of parentMap) {
    const variants = variantsByParent.get(parentId) || []
    const channelBreakdown: CampaignGroup['channelBreakdown'] = []

    for (const variant of variants) {
      const channelKey = (variant.metadata as Record<string, unknown>)?.channel as string | undefined
      if (!channelKey) continue
      const channelConfig = CHANNEL_MAP.get(channelKey)
      channelBreakdown.push({
        channel: channelKey,
        label: channelConfig?.label || channelKey,
        clicks: variant.totalClicks,
        unique: variant.uniqueVisitors,
      })
      channelTotalsMap.set(channelKey, (channelTotalsMap.get(channelKey) || 0) + variant.totalClicks)
    }

    channelBreakdown.sort((a, b) => b.clicks - a.clicks)

    const totalClicks = variants.reduce((sum, v) => sum + v.totalClicks, 0)
    const totalUnique = variants.reduce((sum, v) => sum + v.uniqueVisitors, 0)
    const topChannel = channelBreakdown.length > 0
      ? { label: channelBreakdown[0].label, clicks: channelBreakdown[0].clicks }
      : null

    campaigns.push({ parent, variants, channelBreakdown, totalClicks, totalUnique, topChannel })
  }

  campaigns.sort((a, b) => b.totalClicks - a.totalClicks)

  const channelTotals = Array.from(channelTotalsMap.entries())
    .map(([channel, clicks]) => {
      const config = CHANNEL_MAP.get(channel)
      return { channel, label: config?.label || channel, type: config?.type || 'digital', clicks }
    })
    .sort((a, b) => b.clicks - a.clicks)

  return { campaigns, standalone, channelTotals }
}
