'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  PageHeader, SectionNav, Tabs,
  Card, CardHeader, CardBody, RevenueChart,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import { Stat, Badge, Button, Select } from '@/ds'
import { getShortLinkVolumeAdvanced } from '@/app/actions/short-links'
import { groupLinksIntoCampaigns } from '@/lib/short-links/insights-grouping'
import type { AnalyticsLinkRow } from '@/types/short-links'

const SHORT_LINKS_NAV = [
  { id: 'links', label: 'Links', href: '/short-links' },
  { id: 'insights', label: 'Insights', href: '/short-links/insights' },
]

const TIME_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

function toNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function InsightsClient() {
  const [activeTab, setActiveTab] = useState('all')
  const [analyticsData, setAnalyticsData] = useState<AnalyticsLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState('30')

  const loadData = useCallback(async () => {
    setLoading(true)
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
      }
    } catch {
      // Silently handle
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
      .map(([day, amount]) => ({ day: day.substring(5), amount }))
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

  return (
    <div>
      <PageHeader title="Short Links" subtitle="Analytics and insights for l.the-anchor.pub" />
      <SectionNav items={SHORT_LINKS_NAV} activeId="insights" className="mb-6" />

      {/* Controls */}
      <div className="flex items-center gap-3 mb-6">
        <Select
          options={TIME_OPTIONS}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-48"
        />
        <Button variant="secondary" size="sm" onClick={loadData} loading={loading}>
          Refresh
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card><CardBody><Stat label="Active Links" value={analyticsData.length} /></CardBody></Card>
        <Card><CardBody><Stat label="Human Clicks" value={totalClicks.toLocaleString('en-GB')} /></CardBody></Card>
        <Card><CardBody><Stat label="Unique Visitors" value={totalUnique.toLocaleString('en-GB')} /></CardBody></Card>
        <Card><CardBody><Stat label="Campaigns" value={grouped.campaigns.length} /></CardBody></Card>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'all', label: 'All Links' },
          { id: 'campaigns', label: 'Campaigns' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        className="mb-6"
      />

      {loading ? (
        <Card>
          <CardBody>
            <div className="py-12 text-center text-text-muted">Loading analytics...</div>
          </CardBody>
        </Card>
      ) : activeTab === 'all' ? (
        <div className="space-y-6">
          {/* Volume chart */}
          <Card>
            <CardHeader title="Click Volume" subtitle={`Last ${days} days`} />
            <CardBody>
              {chartData.length > 0 ? (
                <RevenueChart data={chartData} />
              ) : (
                <p className="text-text-muted text-center py-8">No data for this period</p>
              )}
            </CardBody>
          </Card>

          {/* Top performing links */}
          <Card>
            <CardHeader title="Top Performing Links" />
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
                {topLinks.map((link) => (
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
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Channel breakdown */}
          {grouped.channelTotals.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {grouped.channelTotals.slice(0, 4).map((ch) => (
                <Card key={ch.channel}>
                  <CardBody>
                    <Stat
                      label={ch.label}
                      value={ch.clicks.toLocaleString('en-GB')}
                      hint={ch.type}
                    />
                  </CardBody>
                </Card>
              ))}
            </div>
          )}

          {/* Campaign table */}
          <Card>
            <CardHeader title="Campaign Performance" />
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
                {grouped.campaigns.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-center text-text-muted py-8" align="center">
                      No campaigns found
                    </TableCell>
                  </TableRow>
                ) : (
                  grouped.campaigns.map((campaign) => (
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
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          {/* Standalone links */}
          {grouped.standalone.length > 0 && (
            <Card>
              <CardHeader title="Standalone Links" subtitle="Links without campaign variants" />
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
                  {grouped.standalone.slice(0, 10).map((link) => (
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
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
