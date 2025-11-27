'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Select } from '@/components/ui-v2/forms/Select'
import { Button } from '@/components/ui-v2/forms/Button'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { BarChart } from '@/components/charts/BarChart'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { getShortLinkVolume } from '@/app/actions/short-links'
import toast from 'react-hot-toast'

interface VolumeDataResponse {
  shortCode: string
  linkType: string
  destinationUrl: string
  totalClicks: number
  uniqueVisitors: number
  data: Array<{ date: string; value: number }>
}

interface Props {
  open: boolean
  onClose: () => void
}

const SHORT_LINK_BASE_URL = 'https://vip-club.uk'

export function ShortLinkVolumeModal({ open, onClose }: Props) {
  const [volumeData, setVolumeData] = useState<VolumeDataResponse[] | null>(null)
  const [volumePeriod, setVolumePeriod] = useState('30')
  const [loadingVolume, setLoadingVolume] = useState(false)
  const [volumeChartType, setVolumeChartType] = useState<'clicks' | 'unique'>('clicks')

  useEffect(() => {
    if (open) {
      loadVolumeData(volumePeriod)
    }
  }, [open, volumePeriod])

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
    <Modal
      open={open}
      onClose={onClose}
      title="Short Link Insights"
      size="xl"
    >
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <Select
            value={volumePeriod}
            onChange={(e) => setVolumePeriod(e.target.value)}
            className="sm:w-auto"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>

          <div className="flex gap-2">
            <Button
              variant={volumeChartType === 'clicks' ? 'primary' : 'secondary'}
              onClick={() => setVolumeChartType('clicks')}
            >
              Total Clicks
            </Button>
            <Button
              variant={volumeChartType === 'unique' ? 'primary' : 'secondary'}
              onClick={() => setVolumeChartType('unique')}
            >
              Unique Visitors
            </Button>
          </div>
        </div>

        {loadingVolume ? (
          <EmptyState
            title="Loading volume data"
            description="Fetching analytics..."
          />
        ) : volumeData && volumeData.length > 0 ? (
          <div className="space-y-6">
            <BarChart
              height={260}
              data={volumeData.map((item) => ({
                label: item.shortCode,
                value: volumeChartType === 'clicks' ? item.totalClicks : item.uniqueVisitors
              }))}
            />

            <Section title="Link Breakdown" variant="gray" padding="sm">
              <div className="space-y-3">
                {volumeData.map((item) => (
                  <Card key={item.shortCode} variant="bordered" padding="sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {SHORT_LINK_BASE_URL.replace(/^https?:\/\//, '')}/{item.shortCode}
                        </p>
                        <p className="text-xs text-gray-500 truncate max-w-xs">{item.destinationUrl}</p>
                      </div>
                      <div className="flex gap-3 text-sm text-gray-700">
                        <span>{item.totalClicks} clicks</span>
                        <span>{item.uniqueVisitors} unique visitors</span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </Section>
          </div>
        ) : (
          <EmptyState
            title="No analytics data"
            description="We didn't find any analytics data for the selected period."
          />
        )}
      </div>
    </Modal>
  )
}
