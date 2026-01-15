'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { LineChart } from '@/components/charts/LineChart'
import {
  DevicePhoneMobileIcon,
  ComputerDesktopIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline'
import { getShortLinkAnalytics, getShortLinkAnalyticsSummary } from '@/app/actions/short-links'
import toast from 'react-hot-toast'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'

interface ShortLink {
  id: string
  name?: string | null
  short_code: string
  destination_url: string
  link_type: string
  click_count: number
  created_at: string
  expires_at: string | null
  last_clicked_at: string | null
}

interface ShortLinkAnalytics {
  click_count?: number | null
  last_clicked_at?: string | null
  demographics?: {
    devices: Record<string, number>
    countries: Record<string, number>
    browsers: Record<string, number>
    referrers: Record<string, number>
  }
  chartData?: Array<{ date: string; value: number }>
}

interface Props {
  link: ShortLink | null
  open: boolean
  onClose: () => void
}

export function ShortLinkAnalyticsModal({ link, open, onClose }: Props) {
  const [analytics, setAnalytics] = useState<ShortLinkAnalytics | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && link) {
      loadAnalytics(link)
    } else {
        setAnalytics(null)
    }
  }, [open, link])

  const loadAnalytics = async (link: ShortLink) => {
    setLoading(true)
    setAnalytics(null)

    try {
      const [detailResult, summaryResult] = await Promise.all([
        getShortLinkAnalytics(link.short_code),
        getShortLinkAnalyticsSummary(link.short_code, 30)
      ])

      if (!detailResult || 'error' in detailResult) {
        toast.error(detailResult?.error || 'Failed to load analytics')
        return
      }

      const detailData = (detailResult as any).data

      if (!summaryResult || 'error' in summaryResult) {
        toast.error(summaryResult?.error || 'Failed to load analytics summary')
        setAnalytics({ ...(detailData || {}) })
        return
      }

      const enhancedData = Array.isArray(summaryResult.data) ? summaryResult.data : []

      const demographics = {
        devices: { mobile: 0, desktop: 0, tablet: 0 },
        countries: {} as Record<string, number>,
        browsers: {} as Record<string, number>,
        referrers: {} as Record<string, number>
      }

      enhancedData.forEach((day: any) => {
        demographics.devices.mobile += Number(day.mobile_clicks || 0)
        demographics.devices.desktop += Number(day.desktop_clicks || 0)
        demographics.devices.tablet += Number(day.tablet_clicks || 0)

        if (day.top_countries) {
          Object.entries(day.top_countries).forEach(([country, count]) => {
            demographics.countries[country] = (demographics.countries[country] || 0) + Number(count)
          })
        }

        if (day.top_browsers) {
          Object.entries(day.top_browsers).forEach(([browser, count]) => {
            demographics.browsers[browser] = (demographics.browsers[browser] || 0) + Number(count)
          })
        }

        if (day.top_referrers) {
          Object.entries(day.top_referrers).forEach(([referrer, count]) => {
            demographics.referrers[referrer] = (demographics.referrers[referrer] || 0) + Number(count)
          })
        }
      })

      setAnalytics({
        ...(detailData || {}),
        demographics,
        chartData: enhancedData.map((day: any) => ({
          date: day.click_date,
          value: day.total_clicks ?? 0
        }))
      })
    } catch (error) {
      console.error('Error loading analytics:', error)
      toast.error('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link Analytics"
      size="xl"
    >
      {loading ? (
        <div className="py-8">
          <EmptyState
            title="Loading analytics"
            description="Please wait while we load the analytics for this link."
          />
        </div>
      ) : link && analytics ? (
        <div className="space-y-4">
          <Card variant="bordered" padding="sm">
            <p className="text-xs sm:text-sm text-gray-600">Short Link</p>
            <p className="font-mono text-sm sm:text-base">
              {buildShortLinkUrl(link.short_code).replace(/^https?:\/\//, '')}
            </p>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card variant="bordered" padding="sm" className="bg-blue-50">
              <p className="text-sm text-blue-600">Total Clicks</p>
              <p className="text-2xl font-bold text-blue-900">
                {analytics.click_count ?? 0}
              </p>
            </Card>

            <Card variant="bordered" padding="sm" className="bg-green-50">
              <p className="text-sm text-green-600">Last Clicked</p>
              <p className="text-sm font-medium text-green-900">
                {analytics.last_clicked_at
                  ? new Date(analytics.last_clicked_at).toLocaleString()
                  : 'Never'}
              </p>
            </Card>
          </div>

          {analytics.chartData && analytics.chartData.length > 0 && (
            <Section title="Click Trends (Last 30 Days)" variant="gray" padding="sm">
              <LineChart data={analytics.chartData} height={200} color="#3B82F6" label="Daily Clicks" />
            </Section>
          )}

          {analytics.demographics && (
            <>
              <Section title="Device Types" variant="gray" padding="sm">
                <div className="grid grid-cols-3 gap-3">
                  <Card variant="bordered" padding="sm" className="text-center">
                    <DevicePhoneMobileIcon className="h-6 w-6 mx-auto mb-1 text-gray-600" />
                    <p className="text-xs text-gray-600">Mobile</p>
                    <p className="text-lg font-semibold">{analytics.demographics.devices.mobile || 0}</p>
                  </Card>
                  <Card variant="bordered" padding="sm" className="text-center">
                    <ComputerDesktopIcon className="h-6 w-6 mx-auto mb-1 text-gray-600" />
                    <p className="text-xs text-gray-600">Desktop</p>
                    <p className="text-lg font-semibold">
                      {analytics.demographics.devices.desktop || 0}
                    </p>
                  </Card>
                  <Card variant="bordered" padding="sm" className="text-center">
                    <GlobeAltIcon className="h-6 w-6 mx-auto mb-1 text-gray-600" />
                    <p className="text-xs text-gray-600">Tablet</p>
                    <p className="text-lg font-semibold">{analytics.demographics.devices.tablet || 0}</p>
                  </Card>
                </div>
              </Section>

              {Object.keys(analytics.demographics.countries).length > 0 && (
                <Section title="Top Countries" variant="gray" padding="sm">
                  <div className="space-y-2">
                    {Object.entries(analytics.demographics.countries)
                      .sort(([, a], [, b]) => Number(b) - Number(a))
                      .slice(0, 5)
                      .map(([country, count]) => (
                        <Card key={country} variant="bordered" padding="sm">
                          <div className="flex justify-between items-center">
                            <span className="text-sm">{country || 'Unknown'}</span>
                            <Badge variant="secondary" size="sm">
                              {String(count)}
                            </Badge>
                          </div>
                        </Card>
                      ))}
                  </div>
                </Section>
              )}

              {Object.keys(analytics.demographics.browsers).length > 0 && (
                <Section title="Top Browsers" variant="gray" padding="sm">
                  <div className="space-y-2">
                    {Object.entries(analytics.demographics.browsers)
                      .sort(([, a], [, b]) => Number(b) - Number(a))
                      .slice(0, 5)
                      .map(([browser, count]) => (
                        <Card key={browser} variant="bordered" padding="sm">
                          <div className="flex justify-between items-center">
                            <span className="text-sm">{browser}</span>
                            <Badge variant="secondary" size="sm">
                              {String(count)}
                            </Badge>
                          </div>
                        </Card>
                      ))}
                  </div>
                </Section>
              )}

              {Object.keys(analytics.demographics.referrers).length > 0 && (
                <Section title="Top Referrers" variant="gray" padding="sm">
                  <div className="space-y-2">
                    {Object.entries(analytics.demographics.referrers)
                      .sort(([, a], [, b]) => Number(b) - Number(a))
                      .slice(0, 5)
                      .map(([referrer, count]) => (
                        <Card key={referrer} variant="bordered" padding="sm">
                          <div className="flex justify-between items-center">
                            <span className="text-sm">{referrer || 'Direct'}</span>
                            <Badge variant="secondary" size="sm">
                              {String(count)}
                            </Badge>
                          </div>
                        </Card>
                      ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      ) : null}
    </Modal>
  )
}
