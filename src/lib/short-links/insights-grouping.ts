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
