'use client'

import { useState, useEffect } from 'react'
import { Alert, Button, Modal, Card, CardBody, CardHeader, Empty, PageLoading, Sparkline, StatGrid } from '@/ds'
import { Stat, Badge } from '@/ds'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import { getShortLinkAnalytics, getShortLinkAnalyticsSummary } from '@/app/actions/short-links'
import { formatDateInLondon } from '@/lib/dateUtils'

interface AnalyticsData {
  totalClicks: number
  lastClickedAt: string | null
  chartData: number[]
  referrers: Array<{ name: string; count: number }>
  devices: { mobile: number; desktop: number; tablet: number }
}

interface Props {
  open: boolean
  onClose: () => void
  shortCode: string
}

export function ShortLinkAnalyticsModal({ open, onClose, shortCode }: Props) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(false)
  // A failed read is reported, never shown as a link nobody has clicked.
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (open && shortCode) {
      loadAnalytics()
    } else {
      setData(null)
      setLoadError(null)
    }
  }, [open, shortCode])

  const loadAnalytics = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [analyticsRes, summaryRes] = await Promise.all([
        getShortLinkAnalytics(shortCode),
        getShortLinkAnalyticsSummary(shortCode, 30),
      ])

      const failure =
        (analyticsRes && 'error' in analyticsRes && analyticsRes.error) ||
        (summaryRes && 'error' in summaryRes && summaryRes.error) ||
        null
      if (failure) {
        setData(null)
        setLoadError(failure)
        return
      }

      const summaryData = Array.isArray(summaryRes?.data) ? summaryRes.data : []
      const chartData = summaryData.map((d: Record<string, unknown>) => Number(d.total_clicks ?? 0))

      const devices = { mobile: 0, desktop: 0, tablet: 0 }
      const referrerMap = new Map<string, number>()

      summaryData.forEach((day: Record<string, unknown>) => {
        devices.mobile += Number(day.mobile_clicks ?? 0)
        devices.desktop += Number(day.desktop_clicks ?? 0)
        devices.tablet += Number(day.tablet_clicks ?? 0)

        if (day.top_referrers && typeof day.top_referrers === 'object') {
          Object.entries(day.top_referrers as Record<string, number>).forEach(([ref, count]) => {
            referrerMap.set(ref, (referrerMap.get(ref) || 0) + Number(count))
          })
        }
      })

      const referrers = Array.from(referrerMap.entries())
        .map(([name, count]) => ({ name: name || 'Direct', count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)

      const analytics = analyticsRes?.data as Record<string, unknown> | undefined
      setData({
        totalClicks: Number(analytics?.click_count ?? 0),
        lastClickedAt: analytics?.last_clicked_at as string | null ?? null,
        chartData,
        referrers,
        devices,
      })
    } catch {
      setData(null)
      setLoadError('Could not load the analytics for this link')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Link Analytics" width="xl">
      {loading ? (
        <PageLoading inline label="Loading analytics" />
      ) : loadError ? (
        <Alert tone="danger" title="Could not load analytics">
          {loadError}
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => void loadAnalytics()}>
              Try Again
            </Button>
          </div>
        </Alert>
      ) : data ? (
        <div className="space-y-4">
          {/* Summary stats */}
          <StatGrid columns={2}>
            <Stat label="Total Clicks" value={data.totalClicks} />
            <Stat label="Last Clicked" value={data.lastClickedAt ? formatDateInLondon(data.lastClickedAt) : 'Never'} />
          </StatGrid>

          {/* Sparkline */}
          {data.chartData.length > 0 && (
            <Card>
              <CardHeader title="Clicks" subtitle="Last 30 days" />
              <CardBody>
                <Sparkline data={data.chartData} />
              </CardBody>
            </Card>
          )}

          {/* Device breakdown */}
          <StatGrid columns={3}>
            <Stat label="Mobile" value={data.devices.mobile} />
            <Stat label="Desktop" value={data.devices.desktop} />
            <Stat label="Tablet" value={data.devices.tablet} />
          </StatGrid>

          {/* Top referrers */}
          {data.referrers.length > 0 && (
            <Card>
              <CardHeader title="Top Referrers" />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referrer</TableHead>
                    <TableHead align="right">Clicks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.referrers.map((ref) => (
                    <TableRow key={ref.name}>
                      <TableCell>{ref.name}</TableCell>
                      <TableCell align="right">
                        <Badge tone="neutral">{ref.count}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      ) : (
        <Empty
          size="sm"
          icon="chart"
          title="No analytics yet"
          description="Analytics show here once the link has been clicked."
        />
      )}
    </Modal>
  )
}
