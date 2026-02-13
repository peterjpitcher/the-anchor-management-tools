'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChartBarIcon,
  ClipboardDocumentIcon,
  CursorArrowRaysIcon,
  LinkIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Select } from '@/components/ui-v2/forms/Select'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { BarChart } from '@/components/charts/BarChart'
import { LineChart } from '@/components/charts/LineChart'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat'
import { SearchInput } from '@/components/ui-v2/forms/SearchInput'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { getShortLinkVolume } from '@/app/actions/short-links'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import toast from 'react-hot-toast'
import { useShortLinkClickToasts } from '@/hooks/useShortLinkClickToasts'

interface VolumeDataResponse {
  shortCode: string
  linkType: string
  destinationUrl: string
  totalClicks: number
  uniqueVisitors: number
  data: Array<{ date: string; value: number }>
}

type SortOption =
  | 'clicks_desc'
  | 'clicks_asc'
  | 'unique_desc'
  | 'unique_asc'
  | 'code_asc'
  | 'code_desc'

const PERIOD_OPTIONS = [
  { value: '3', label: 'Last 3 days' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: '90', label: 'Last 90 days' },
]

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'clicks_desc', label: 'Most clicks first' },
  { value: 'clicks_asc', label: 'Least clicks first' },
  { value: 'unique_desc', label: 'Most unique visitors first' },
  { value: 'unique_asc', label: 'Least unique visitors first' },
  { value: 'code_asc', label: 'Code A-Z' },
  { value: 'code_desc', label: 'Code Z-A' },
]

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNumber(value: number) {
  return value.toLocaleString('en-GB')
}

export function InsightsClient() {
  useShortLinkClickToasts({ playSound: true })

  const [volumeData, setVolumeData] = useState<VolumeDataResponse[]>([])
  const [volumePeriod, setVolumePeriod] = useState('30')
  const [loadingVolume, setLoadingVolume] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [volumeChartType, setVolumeChartType] = useState<'clicks' | 'unique'>('clicks')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('clicks_desc')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

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

  const loadVolumeData = useCallback(async (days: string) => {
    setLoadingVolume(true)
    setErrorMessage(null)

    try {
      const result = await getShortLinkVolume(Number(days))
      if (!result || 'error' in result) {
        const message = result?.error || 'Failed to load analytics data'
        setErrorMessage(message)
        toast.error(message)
        return
      }

      const chartData = (result.data || []).map((link: any) => {
        const clickDates = Array.isArray(link.click_dates) ? link.click_dates : []
        const clickCounts = Array.isArray(link.click_counts) ? link.click_counts : []
        const dataPoints = clickDates.map((date: string, index: number) => ({
          date,
          value: toNumber(clickCounts[index]),
        }))

        return {
          shortCode: String(link.short_code ?? ''),
          linkType: String(link.link_type ?? 'unknown'),
          destinationUrl: String(link.destination_url ?? ''),
          totalClicks: toNumber(link.total_clicks),
          uniqueVisitors: toNumber(link.unique_visitors),
          data: dataPoints,
        } as VolumeDataResponse
      })

      setVolumeData(chartData)
      setLastUpdated(new Date())
      setHasLoaded(true)
    } catch (error) {
      console.error('Error loading volume data:', error)
      setErrorMessage('Failed to load analytics data')
      toast.error('Failed to load analytics data')
      setHasLoaded(true)
    } finally {
      setLoadingVolume(false)
    }
  }, [])

  useEffect(() => {
    void loadVolumeData(volumePeriod)
  }, [loadVolumeData, volumePeriod])

  const filteredData = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return volumeData

    return volumeData.filter((item) => {
      return (
        item.shortCode.toLowerCase().includes(query) ||
        item.linkType.toLowerCase().includes(query) ||
        item.destinationUrl.toLowerCase().includes(query)
      )
    })
  }, [volumeData, searchTerm])

  const sortedData = useMemo(() => {
    const next = [...filteredData]

    next.sort((a, b) => {
      if (sortBy === 'clicks_desc') return b.totalClicks - a.totalClicks
      if (sortBy === 'clicks_asc') return a.totalClicks - b.totalClicks
      if (sortBy === 'unique_desc') return b.uniqueVisitors - a.uniqueVisitors
      if (sortBy === 'unique_asc') return a.uniqueVisitors - b.uniqueVisitors
      if (sortBy === 'code_desc') return b.shortCode.localeCompare(a.shortCode)
      return a.shortCode.localeCompare(b.shortCode)
    })

    return next
  }, [filteredData, sortBy])

  const totals = useMemo(() => {
    const totalClicks = filteredData.reduce((sum, item) => sum + item.totalClicks, 0)
    const totalUniqueVisitors = filteredData.reduce((sum, item) => sum + item.uniqueVisitors, 0)
    const averageClicks = filteredData.length > 0 ? Math.round(totalClicks / filteredData.length) : 0
    const topLink = filteredData.reduce<VolumeDataResponse | null>((currentTop, item) => {
      if (!currentTop) return item
      return item.totalClicks > currentTop.totalClicks ? item : currentTop
    }, null)

    return {
      totalClicks,
      totalUniqueVisitors,
      averageClicks,
      topLink,
    }
  }, [filteredData])

  const trendData = useMemo(() => {
    const grouped = new Map<string, number>()

    filteredData.forEach((item) => {
      item.data.forEach((point) => {
        grouped.set(point.date, (grouped.get(point.date) || 0) + point.value)
      })
    })

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }))
  }, [filteredData])

  const topChartData = useMemo(() => {
    return sortedData.slice(0, 12).map((item) => ({
      label: `/${item.shortCode}`,
      value: volumeChartType === 'clicks' ? item.totalClicks : item.uniqueVisitors,
    }))
  }, [sortedData, volumeChartType])

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdated) return 'Not updated yet'
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(lastUpdated)
  }, [lastUpdated])

  const handleCopyLink = useCallback(async (shortCode: string) => {
    const fullUrl = buildShortLinkUrl(shortCode)
    try {
      await navigator.clipboard.writeText(fullUrl)
      toast.success('Link copied to clipboard')
    } catch (error) {
      console.error('Failed to copy short link', error)
      toast.error('Failed to copy link')
    }
  }, [])

  const handleOpenLink = useCallback((shortCode: string) => {
    const fullUrl = buildShortLinkUrl(shortCode)
    window.open(fullUrl, '_blank', 'noopener,noreferrer')
  }, [])

  const clearFilters = useCallback(() => {
    setSearchTerm('')
    setSortBy('clicks_desc')
  }, [])

  const showInitialLoading = loadingVolume && !hasLoaded
  const showEmptyState = hasLoaded && !loadingVolume && volumeData.length === 0 && !errorMessage
  const showErrorState = hasLoaded && !loadingVolume && volumeData.length === 0 && !!errorMessage
  const showInlineError = !!errorMessage && volumeData.length > 0
  const isRefreshing = loadingVolume && hasLoaded
  const metricLabel = volumeChartType === 'clicks' ? 'clicks' : 'unique visitors'

  return (
    <PageLayout
      title="Short Links"
      subtitle="Track click performance and trends for vip-club.uk short links"
      backButton={{
        label: 'Back to Settings',
        href: '/settings',
      }}
      navItems={navItems}
    >
      <div className="space-y-6">
        <Card variant="bordered">
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="period-select" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Time period
                  </label>
                  <Select
                    id="period-select"
                    value={volumePeriod}
                    onChange={(e) => setVolumePeriod(e.target.value)}
                    className="sm:w-48"
                  >
                    {PERIOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="sort-select" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Sort links
                  </label>
                  <Select
                    id="sort-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="sm:w-64"
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
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

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadVolumeData(volumePeriod)}
                  loading={isRefreshing}
                  leftIcon={<ArrowPathIcon className="h-4 w-4" />}
                >
                  Refresh
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="w-full sm:max-w-md">
                <SearchInput
                  value={searchTerm}
                  onSearch={setSearchTerm}
                  debounceDelay={150}
                  placeholder="Search by short code, type, or destination..."
                />
              </div>

              <p className="text-xs text-gray-500">
                Last updated: {lastUpdatedLabel}
                {isRefreshing ? ' (refreshing...)' : ''}
              </p>
            </div>
          </div>
        </Card>

        {showInitialLoading ? (
          <Card>
            <div className="animate-pulse p-4 sm:p-6 space-y-4">
              <div className="h-6 w-48 rounded bg-gray-200" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={idx} className="h-28 rounded-lg bg-gray-100" />
                ))}
              </div>
              <div className="h-64 rounded-lg bg-gray-100" />
              <div className="h-64 rounded-lg bg-gray-100" />
            </div>
          </Card>
        ) : showErrorState ? (
          <Card>
            <div className="p-4 sm:p-6">
              <EmptyState
                icon="chart"
                title="Could not load insights"
                description={errorMessage || "We couldn't fetch short link analytics right now."}
                action={
                  <Button variant="primary" onClick={() => void loadVolumeData(volumePeriod)}>
                    Try again
                  </Button>
                }
              />
            </div>
          </Card>
        ) : showEmptyState ? (
          <Card>
            <div className="p-4 sm:p-6">
              <EmptyState
                icon="chart"
                title="No analytics data for this period"
                description="No tracked clicks were found in the selected time range. Try a longer period."
              />
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {showInlineError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {errorMessage}. Showing the latest loaded data.
              </div>
            ) : null}

            <Card>
              <StatGroup columns={4}>
                <Stat
                  label="Active Links"
                  value={formatNumber(filteredData.length)}
                  icon={<LinkIcon className="h-5 w-5 text-blue-500" />}
                  variant="bordered"
                />
                <Stat
                  label="Total Clicks"
                  value={formatNumber(totals.totalClicks)}
                  icon={<CursorArrowRaysIcon className="h-5 w-5 text-indigo-500" />}
                  variant="bordered"
                />
                <Stat
                  label="Unique Visitors"
                  value={formatNumber(totals.totalUniqueVisitors)}
                  icon={<UsersIcon className="h-5 w-5 text-emerald-500" />}
                  variant="bordered"
                />
                <Stat
                  label="Avg Clicks / Link"
                  value={formatNumber(totals.averageClicks)}
                  description={totals.topLink ? `Top link: /${totals.topLink.shortCode}` : undefined}
                  icon={<ChartBarIcon className="h-5 w-5 text-amber-500" />}
                  variant="bordered"
                />
              </StatGroup>
            </Card>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card variant="bordered" className="lg:col-span-2">
                <Section
                  title="Daily Click Trend"
                  description="Combined clicks across filtered links."
                  padding="sm"
                >
                  {trendData.length > 0 ? (
                    <LineChart data={trendData} height={280} color="#2563EB" label="Daily Clicks" />
                  ) : (
                    <EmptyState
                      size="sm"
                      variant="minimal"
                      icon="chart"
                      title="No trend data"
                      description="Try adjusting your search or time period."
                    />
                  )}
                </Section>
              </Card>

              <Card variant="bordered">
                <Section
                  title={`Top Links by ${metricLabel}`}
                  description="Top 12 links in the current view."
                  padding="sm"
                >
                  {topChartData.length > 0 ? (
                    <BarChart
                      height={280}
                      horizontal
                      data={topChartData}
                      showValues
                    />
                  ) : (
                    <EmptyState
                      size="sm"
                      variant="minimal"
                      icon="chart"
                      title="No link data"
                      description="Try removing filters."
                    />
                  )}
                </Section>
              </Card>
            </div>

            <Section
              title="Link Performance Breakdown"
              description="Search, sort, and compare individual short link performance."
              actions={
                searchTerm ? (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
              padding="none"
            >
              <Card variant="bordered">
                <DataTable<VolumeDataResponse>
                  data={sortedData}
                  getRowKey={(item) => item.shortCode}
                  emptyMessage={
                    searchTerm
                      ? `No links found for "${searchTerm}"`
                      : 'No short link analytics in this period'
                  }
                  emptyDescription={
                    searchTerm
                      ? 'Try a broader search term or clear filters.'
                      : 'Try selecting a longer time period.'
                  }
                  emptyAction={
                    searchTerm ? (
                      <Button variant="ghost" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                  columns={[
                    {
                      key: 'shortCode',
                      header: 'Short Link',
                      sortable: true,
                      sortFn: (a, b) => a.shortCode.localeCompare(b.shortCode),
                      cell: (item) => (
                        <div>
                          <code className="rounded bg-gray-100 px-2 py-1 text-xs font-mono">
                            /{item.shortCode}
                          </code>
                          <p className="mt-1 text-xs text-gray-500">
                            {buildShortLinkUrl(item.shortCode).replace(/^https?:\/\//, '')}
                          </p>
                        </div>
                      ),
                    },
                    {
                      key: 'linkType',
                      header: 'Type',
                      sortable: true,
                      sortFn: (a, b) => a.linkType.localeCompare(b.linkType),
                      cell: (item) => (
                        <span className="inline-flex rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                          {item.linkType}
                        </span>
                      ),
                    },
                    {
                      key: 'destinationUrl',
                      header: 'Destination',
                      cell: (item) => (
                        <p className="max-w-xs truncate text-sm text-gray-700" title={item.destinationUrl}>
                          {item.destinationUrl}
                        </p>
                      ),
                    },
                    {
                      key: 'totalClicks',
                      header: 'Clicks',
                      align: 'right',
                      sortable: true,
                      sortFn: (a, b) => a.totalClicks - b.totalClicks,
                      cell: (item) => formatNumber(item.totalClicks),
                    },
                    {
                      key: 'uniqueVisitors',
                      header: 'Unique',
                      align: 'right',
                      sortable: true,
                      sortFn: (a, b) => a.uniqueVisitors - b.uniqueVisitors,
                      cell: (item) => formatNumber(item.uniqueVisitors),
                    },
                    {
                      key: 'share',
                      header: 'Share',
                      align: 'right',
                      sortable: true,
                      sortFn: (a, b) => a.totalClicks - b.totalClicks,
                      cell: (item) => {
                        if (totals.totalClicks === 0) return '0%'
                        return `${((item.totalClicks / totals.totalClicks) * 100).toFixed(1)}%`
                      },
                    },
                    {
                      key: 'actions',
                      header: 'Actions',
                      align: 'right',
                      cell: (item) => (
                        <div className="flex items-center justify-end gap-1">
                          <IconButton
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleCopyLink(item.shortCode)}
                            title="Copy link"
                          >
                            <ClipboardDocumentIcon className="h-4 w-4 text-gray-600" />
                          </IconButton>
                          <IconButton
                            size="sm"
                            variant="secondary"
                            onClick={() => handleOpenLink(item.shortCode)}
                            title="Open link"
                          >
                            <ArrowTopRightOnSquareIcon className="h-4 w-4 text-gray-600" />
                          </IconButton>
                        </div>
                      ),
                    },
                  ]}
                  renderMobileCard={(item) => (
                    <Card padding="sm">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <code className="rounded bg-gray-100 px-2 py-1 text-xs font-mono">
                              /{item.shortCode}
                            </code>
                            <p className="mt-1 truncate text-xs text-gray-500">
                              {item.destinationUrl}
                            </p>
                          </div>
                          <span className="inline-flex rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                            {item.linkType}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div>
                            <p className="text-gray-500">Clicks</p>
                            <p className="font-semibold text-gray-900">{formatNumber(item.totalClicks)}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Unique</p>
                            <p className="font-semibold text-gray-900">{formatNumber(item.uniqueVisitors)}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Share</p>
                            <p className="font-semibold text-gray-900">
                              {totals.totalClicks === 0
                                ? '0%'
                                : `${((item.totalClicks / totals.totalClicks) * 100).toFixed(1)}%`}
                            </p>
                          </div>
                        </div>

                        <div className="flex justify-end gap-1 border-t pt-3">
                          <IconButton
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleCopyLink(item.shortCode)}
                            title="Copy link"
                          >
                            <ClipboardDocumentIcon className="h-4 w-4 text-gray-600" />
                          </IconButton>
                          <IconButton
                            size="sm"
                            variant="secondary"
                            onClick={() => handleOpenLink(item.shortCode)}
                            title="Open link"
                          >
                            <ArrowTopRightOnSquareIcon className="h-4 w-4 text-gray-600" />
                          </IconButton>
                        </div>
                      </div>
                    </Card>
                  )}
                />
              </Card>
            </Section>
          </div>
        )}
      </div>
    </PageLayout>
  )
}
