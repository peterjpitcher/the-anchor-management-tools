'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  PageLayout, Segmented,
  Card, CardHeader, CardBody, BarChart, Empty, StatGrid,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import { Stat, Badge, Button } from '@/ds'
import { getShortLinkVolumeAdvanced } from '@/app/actions/short-links'
import { SHORT_LINKS_NAV, SHORT_LINKS_TITLE } from '../../_shared/nav'
import { groupLinksIntoCampaigns } from '@/lib/short-links/insights-grouping'
import type { AnalyticsLinkRow } from '@/types/short-links'
import { getErrorMessage } from '@/lib/errors'

/** The time window: a view of the same links, so a Segmented header action. */
const TIME_OPTIONS = [
  { id: '7', label: '7 days' },
  { id: '14', label: '14 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
]

/** Every link, or the links grouped into campaigns with their channel variants. */
const VIEW_OPTIONS = [
  { id: 'all', label: 'All Links' },
  { id: 'campaigns', label: 'Campaigns' },
]

function toNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function InsightsClient() {
  const [activeTab, setActiveTab] = useState('all')
  const [analyticsData, setAnalyticsData] = useState<AnalyticsLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState('30')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - parseInt(days))

      const result = await getShortLinkVolumeAdvanced({
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        granularity: 'day',
        include_bots: false,
        timezone: 'Europe/London',
      })

      if (result && 'data' in result && Array.isArray(result.data)) {
        const mapped: AnalyticsLinkRow[] = result.data.map((link: Record<string, unknown>) => {
          const clickDates = Array.isArray(link.click_dates) ? link.click_dates : []
          const clickCounts = Array.isArray(link.click_counts) ? link.click_counts : []
          return {
            id: String(link.id ?? ''),
            shortCode: String(link.short_code ?? ''),
            linkType: String(link.link_type ?? 'unknown'),
            destinationUrl: String(link.destination_url ?? ''),
            name: link.name ? String(link.name) : null,
            parentLinkId: link.parent_link_id ? String(link.parent_link_id) : null,
            metadata: (link.metadata as Record<string, unknown>) ?? null,
            createdAt: link.created_at ? String(link.created_at) : null,
            totalClicks: toNumber(link.total_clicks),
            uniqueVisitors: toNumber(link.unique_visitors),
            data: clickDates.map((date: string, i: number) => ({
              date,
              value: toNumber(clickCounts[i]),
            })),
          }
        })
        setAnalyticsData(mapped)
      } else {
        setAnalyticsData([])
        setError(result && 'error' in result && typeof result.error === 'string'
          ? result.error
          : 'Could not load short-link insights')
      }
    } catch (loadError) {
      setAnalyticsData([])
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Build chart data: aggregate clicks by day
  const chartData = useMemo(() => {
    const dayMap = new Map<string, number>()
    analyticsData.forEach((link) => {
      link.data.forEach((point) => {
        dayMap.set(point.date, (dayMap.get(point.date) || 0) + point.value)
      })
    })
    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, clicks]) => ({ label: day.substring(5), value: clicks }))
  }, [analyticsData])

  // Top performing links
  const topLinks = useMemo(() =>
    [...analyticsData]
      .filter((l) => !l.parentLinkId)
      .sort((a, b) => b.totalClicks - a.totalClicks)
      .slice(0, 10),
    [analyticsData]
  )

  // Campaigns
  const grouped = useMemo(() => groupLinksIntoCampaigns(analyticsData), [analyticsData])

  const totalClicks = analyticsData.reduce((sum, l) => sum + l.totalClicks, 0)
  const totalUnique = analyticsData.reduce((sum, l) => sum + l.uniqueVisitors, 0)

  const linkTable = (rows: AnalyticsLinkRow[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Link</TableHead>
          <TableHead>Name</TableHead>
          <TableHead align="right">Clicks</TableHead>
          <TableHead align="right">Unique</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((link) => (
          <TableRow key={link.id}>
            <TableCell>
              <code className="text-xs font-mono">/{link.shortCode}</code>
            </TableCell>
            <TableCell className="text-text-muted">{link.name || '-'}</TableCell>
            <TableCell align="right" className="font-mono font-bold">{link.totalClicks}</TableCell>
            <TableCell align="right" className="font-mono text-text-muted">{link.uniqueVisitors}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  return (
    <PageLayout
      title={SHORT_LINKS_TITLE}
      subtitle="Insights: clicks and campaigns on l.the-anchor.pub"
      navItems={SHORT_LINKS_NAV}
      headerActions={
        <>
          <Segmented aria-label="View" size="sm" options={VIEW_OPTIONS} value={activeTab} onChange={setActiveTab} />
          <Segmented aria-label="Time window" size="sm" options={TIME_OPTIONS} value={days} onChange={setDays} />
          <Button variant="secondary" size="sm" onClick={loadData} loading={loading}>
            Refresh
          </Button>
        </>
      }
      loading={loading}
      loadingLabel="Loading analytics"
      error={error}
      onRetry={loadData}
    >
      {/* Summary stats */}
      <StatGrid columns={4}>
        <Stat label="Active Links" value={analyticsData.length} />
        <Stat label="Human Clicks" value={totalClicks.toLocaleString('en-GB')} />
        <Stat label="Unique Visitors" value={totalUnique.toLocaleString('en-GB')} />
        <Stat label="Campaigns" value={grouped.campaigns.length} />
      </StatGrid>

      {activeTab === 'all' ? (
        <>
          {/* Volume chart */}
          <Card>
            <CardHeader title="Click Volume" subtitle={`Last ${days} days`} />
            <CardBody>
              {chartData.length > 0 ? (
                <BarChart
                  data={chartData}
                  height={200}
                  showValues={false}
                  formatType="number"
                  seriesLabel="Clicks"
                  ariaLabel={`Human clicks per day, last ${days} days`}
                />
              ) : (
                <Empty size="sm" icon="chart" title="No clicks for this period" />
              )}
            </CardBody>
          </Card>

          {/* Top performing links */}
          <Card>
            <CardHeader title="Top Performing Links" />
            {topLinks.length === 0 ? (
              <CardBody>
                <Empty size="sm" title="No link clicks for this period" />
              </CardBody>
            ) : (
              linkTable(topLinks)
            )}
          </Card>
        </>
      ) : (
        <>
          {/* Channel breakdown */}
          {grouped.channelTotals.length > 0 && (
            <StatGrid columns={4}>
              {grouped.channelTotals.slice(0, 4).map((ch) => (
                <Stat
                  key={ch.channel}
                  label={ch.label}
                  value={ch.clicks.toLocaleString('en-GB')}
                  hint={ch.type}
                />
              ))}
            </StatGrid>
          )}

          {/* Campaign table */}
          <Card>
            <CardHeader title="Campaign Performance" />
            {grouped.campaigns.length === 0 ? (
              <CardBody>
                <Empty
                  size="sm"
                  title="No campaign clicks for this period"
                  description="Links with campaign variants show here once they are clicked."
                />
              </CardBody>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead align="right">Clicks</TableHead>
                    <TableHead align="right">Unique</TableHead>
                    <TableHead>Top Channel</TableHead>
                    <TableHead align="right">Variants</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped.campaigns.map((campaign) => (
                    <TableRow key={campaign.parent.id}>
                      <TableCell className="font-medium">
                        {campaign.parent.name || `/${campaign.parent.shortCode}`}
                      </TableCell>
                      <TableCell align="right" className="font-mono font-bold">{campaign.totalClicks}</TableCell>
                      <TableCell align="right" className="font-mono text-text-muted">{campaign.totalUnique}</TableCell>
                      <TableCell>
                        {campaign.topChannel ? (
                          <Badge tone="info">{campaign.topChannel.label}</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell align="right">{campaign.variants.length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          {/* Standalone links */}
          {grouped.standalone.length > 0 && (
            <Card>
              <CardHeader title="Standalone Links" subtitle="Links without campaign variants" />
              {linkTable(grouped.standalone.slice(0, 10))}
            </Card>
          )}
        </>
      )}
    </PageLayout>
  )
}
