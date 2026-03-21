/** Short link as returned by getShortLinks — a subset of the full row */
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
