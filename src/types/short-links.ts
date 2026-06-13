/** Short link as returned by getShortLinks — a subset of the full row */
export interface ShortLinkMetadata {
  channel?: string
  parent_link_id?: string
  utm_variant?: boolean
  [key: string]: unknown
}

export interface ShortLink {
  id: string
  name?: string | null
  short_code: string
  destination_url: string
  link_type: string
  click_count: number
  created_at: string
  expires_at: string | null
  last_clicked_at: string | null
  parent_link_id: string | null
  metadata?: ShortLinkMetadata | null
  created_by?: string | null
}

/** Row returned by the extended get_all_links_analytics_v2 RPC */
export interface AnalyticsLinkRow {
  id: string
  shortCode: string
  linkType: string
  destinationUrl: string
  name: string | null
  parentLinkId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string | null
  totalClicks: number
  uniqueVisitors: number
  data: Array<{ date: string; value: number }>
}

/** Campaign: a parent link with its grouped variants */
export interface CampaignGroup {
  parent: AnalyticsLinkRow
  variants: AnalyticsLinkRow[]
  channelBreakdown: Array<{ channel: string; label: string; clicks: number; unique: number }>
  totalClicks: number
  totalUnique: number
  topChannel: { label: string; clicks: number } | null
}

export interface LegacyDomainLinkUsage {
  shortCode: string
  name: string | null
  linkType: string | null
  destinationUrl: string | null
  destinationHost: string | null
  destinationPath: string | null
  channel: string | null
  source: string | null
  eventId: string | null
  totalClicks: number
  humanClicks: number
  lastClickedAt: string | null
  allTimeClickCount: number
}

export interface LegacyDomainRecentClick {
  shortCode: string
  name: string | null
  requestHost: string
  clickedAt: string | null
  destinationHost: string | null
  destinationPath: string | null
  deviceType: string | null
}

export interface LegacyDomainUsage {
  generatedAt: string
  startAt: string
  days: number
  trackingColumnReady: boolean
  totalClicks: number
  humanClicks: number
  legacyClicks: number
  legacyHumanClicks: number
  canonicalClicks: number
  canonicalHumanClicks: number
  untrackedClicks: number
  untrackedHumanClicks: number
  topLegacyLinks: LegacyDomainLinkUsage[]
  recentLegacyClicks: LegacyDomainRecentClick[]
}
