'use client'

import { useState, useEffect } from 'react'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Select } from '@/components/ui-v2/forms/Select'
import { Button } from '@/components/ui-v2/forms/Button'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { BarChart } from '@/components/charts/BarChart'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { getShortLinkVolume } from '@/app/actions/short-links'
import { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
import toast from 'react-hot-toast'

interface VolumeDataResponse {
  shortCode: string
  linkType: string
  destinationUrl: string
  totalClicks: number
  uniqueVisitors: number
  data: Array<{ date: string; value: number }>
}

export function InsightsClient() {
  const [volumeData, setVolumeData] = useState<VolumeDataResponse[] | null>(null)
  const [volumePeriod, setVolumePeriod] = useState('30')
  const [loadingVolume, setLoadingVolume] = useState(false)
  const [volumeChartType, setVolumeChartType] = useState<'clicks' | 'unique'>('clicks')

  const navItems: HeaderNavItem[] = [
    {
      label: 'Overview',
      href: '/short-links',
    },
    {
      label: 'Insights',
      href: '/short-links/insights',
      active: true,
    },
  ]

  useEffect(() => {
    loadVolumeData(volumePeriod)
  }, [volumePeriod])

  const loadVolumeData = async (days: string) => {
    setLoadingVolume(true)
    try {
      const result = await getShortLinkVolume(Number(days))
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to load analytics data')
        setVolumeData(null)
        return
      }

      const chartData = (result.data || []).map((link: any) => {
        const dataPoints = (link.click_dates || []).map((date: string, index: number) => ({
          date,
          value: link.click_counts?.[index] ?? 0
        }))

        return {
          shortCode: link.short_code,
          linkType: link.link_type,
          destinationUrl: link.destination_url,
          totalClicks: link.total_clicks ?? 0,
          uniqueVisitors: link.unique_visitors ?? 0,
          data: dataPoints
        } as VolumeDataResponse
      })

      setVolumeData(chartData)
    } catch (error) {
      console.error('Error loading volume data:', error)
      toast.error('Failed to load analytics data')
    } finally {
      setLoadingVolume(false)
    }
  }

  return (
    <PageLayout
      title="Short Links"
      subtitle="Create and manage vip-club.uk short links"
      backButton={{
        label: 'Back to Settings',
        href: '/settings',
      }}
      navItems={navItems}
    >
      <div className="space-y-6">
        <Card>
          <div className="p-4 sm:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="period-select" className="text-sm font-medium text-gray-700">
                  Time Period:
                </label>
                <Select
                  id="period-select"
                  value={volumePeriod}
                  onChange={(e) => setVolumePeriod(e.target.value)}
                  className="sm:w-48"
                >
                  <option value="3">Last 3 days</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="60">Last 60 days</option>
                  <option value="90">Last 90 days</option>
                </Select>
              </div>

              <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
                <Button
                  size="sm"
                  variant={volumeChartType === 'clicks' ? 'primary' : 'ghost'}
                  onClick={() => setVolumeChartType('clicks')}
                  className={volumeChartType === 'clicks' ? 'shadow-sm' : ''}
                >
                  Total Clicks
                </Button>
                <Button
                  size="sm"
                  variant={volumeChartType === 'unique' ? 'primary' : 'ghost'}
                  onClick={() => setVolumeChartType('unique')}
                  className={volumeChartType === 'unique' ? 'shadow-sm' : ''}
                >
                  Unique Visitors
                </Button>
              </div>
            </div>

            {loadingVolume ? (
              <div className="py-12">
                <EmptyState
                  title="Loading insights"
                  description="Fetching analytics data..."
                />
              </div>
            ) : volumeData && volumeData.length > 0 ? (
              <div className="space-y-8">
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <BarChart
                    height={320}
                    data={volumeData.map((item) => ({
                      label: item.shortCode,
                      value: volumeChartType === 'clicks' ? item.totalClicks : item.uniqueVisitors,
                    }))}
                  />
                </div>

                <Section title="Link Performance Breakdown" padding="none">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {volumeData.map((item) => (
                      <div key={item.shortCode} className="border rounded-lg p-4 hover:border-blue-300 transition-colors">
                        <div className="flex flex-col h-full justify-between gap-4">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold uppercase text-gray-500 tracking-wider">
                                {item.linkType}
                              </span>
                            </div>
                            <p className="text-lg font-mono font-medium text-gray-900 mb-1">
                              /{item.shortCode}
                            </p>
                            <p className="text-xs text-gray-500 truncate" title={item.destinationUrl}>
                              {item.destinationUrl}
                            </p>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2 pt-4 border-t">
                            <div>
                              <p className="text-xs text-gray-500">Clicks</p>
                              <p className="text-xl font-bold text-blue-600">{item.totalClicks}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Unique</p>
                              <p className="text-xl font-bold text-purple-600">{item.uniqueVisitors}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              </div>
            ) : (
              <div className="py-12">
                <EmptyState
                  title="No analytics data"
                  description="We didn't find any analytics data for the selected period."
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    </PageLayout>
  )
}
