'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowPathIcon,
  CursorArrowRaysIcon,
  LinkIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Select } from '@/components/ui-v2/forms/Select'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Card } from '@/components/ui-v2/layout/Card'
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat'
import { SearchInput } from '@/components/ui-v2/forms/SearchInput'
import { getShortLinkVolumeAdvanced } from '@/app/actions/short-links'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
import {
  SHORT_LINK_INSIGHTS_TIMEZONE,
  parseDateTimeLocalValue,
  toDateTimeLocalValue,
} from '@/lib/short-link-insights-timeframes'
import toast from 'react-hot-toast'
import { useShortLinkClickToasts } from '@/hooks/useShortLinkClickToasts'
import type { AnalyticsLinkRow } from '@/types/short-links'
import { groupLinksIntoCampaigns } from '@/lib/short-links/insights-grouping'
import { CampaignsTab } from './components/CampaignsTab'
import { AllLinksTab } from './components/AllLinksTab'

const TIME_PRESETS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-GB')
}

function buildDefaultRange(days: number): { start: Date; end: Date } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  return { start, end }
}

export function InsightsClient(): React.ReactElement {
  useShortLinkClickToasts({ playSound: true })

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const defaultRange = useRef(buildDefaultRange(30))
  const [activeTab, setActiveTab] = useState<'campaigns' | 'all-links'>('campaigns')
  const [analyticsData, setAnalyticsData] = useState<AnalyticsLinkRow[]>([])
  const [preset, setPreset] = useState('30')
  const [startAt, setStartAt] = useState(defaultRange.current.start.toISOString())
  const [endAt, setEndAt] = useState(defaultRange.current.end.toISOString())
  const [startInput, setStartInput] = useState(toDateTimeLocalValue(defaultRange.current.start))
  const [endInput, setEndInput] = useState(toDateTimeLocalValue(defaultRange.current.end))
  const [includeBots, setIncludeBots] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [loadingVolume, setLoadingVolume] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const navItems: HeaderNavItem[] = [
    { label: 'Overview', href: '/short-links' },
    { label: 'Insights', href: '/short-links/insights' },
  ]

  // --- Data fetching ---

  const loadVolumeData = useCallback(async () => {
    setLoadingVolume(true)
    setErrorMessage(null)

    try {
      const result = await getShortLinkVolumeAdvanced({
        start_at: startAt,
        end_at: endAt,
        granularity: 'day',
        include_bots: includeBots,
        timezone: SHORT_LINK_INSIGHTS_TIMEZONE,
      })

      if (!result || 'error' in result) {
        const message = result?.error || 'Failed to load analytics data'
        setErrorMessage(message)
        toast.error(message)
        return
      }

      const chartData: AnalyticsLinkRow[] = (result.data || []).map((link: any) => {
        const clickDates = Array.isArray(link.click_dates) ? link.click_dates : []
        const clickCounts = Array.isArray(link.click_counts) ? link.click_counts : []
        const dataPoints = clickDates.map((date: string, index: number) => ({
          date,
          value: toNumber(clickCounts[index]),
        }))

        return {
          id: String(link.id ?? ''),
          shortCode: String(link.short_code ?? ''),
          linkType: String(link.link_type ?? 'unknown'),
          destinationUrl: String(link.destination_url ?? ''),
          name: link.name ? String(link.name) : null,
          parentLinkId: link.parent_link_id ? String(link.parent_link_id) : null,
          metadata: link.metadata ?? null,
          createdAt: link.created_at ? String(link.created_at) : null,
          totalClicks: toNumber(link.total_clicks),
          uniqueVisitors: toNumber(link.unique_visitors),
          data: dataPoints,
        }
      })

      setAnalyticsData(chartData)
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
  }, [startAt, endAt, includeBots])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void loadVolumeData()
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [loadVolumeData])

  // --- Grouping ---

  const grouped = useMemo(
    () => groupLinksIntoCampaigns(analyticsData),
    [analyticsData]
  )

  // --- Search filtering ---

  const filteredLinks = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return analyticsData
    return analyticsData.filter(item =>
      (item.name?.toLowerCase().includes(q)) ||
      item.shortCode.toLowerCase().includes(q) ||
      item.destinationUrl.toLowerCase().includes(q)
    )
  }, [analyticsData, searchTerm])

  const filteredGrouped = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return grouped
    return {
      campaigns: grouped.campaigns.filter(c =>
        c.parent.name?.toLowerCase().includes(q) ||
        c.parent.shortCode.toLowerCase().includes(q)
      ),
      standalone: grouped.standalone.filter(s =>
        (s.name?.toLowerCase().includes(q)) ||
        s.shortCode.toLowerCase().includes(q)
      ),
      channelTotals: grouped.channelTotals,
    }
  }, [grouped, searchTerm])

  // --- Summary stats ---

  const stats = useMemo(() => {
    if (activeTab === 'campaigns') {
      const totalClicks = filteredGrouped.campaigns.reduce((sum, c) => sum + c.totalClicks, 0)
        + filteredGrouped.standalone.reduce((sum, s) => sum + s.totalClicks, 0)
      const totalUnique = filteredGrouped.campaigns.reduce((sum, c) => sum + c.totalUnique, 0)
        + filteredGrouped.standalone.reduce((sum, s) => sum + s.uniqueVisitors, 0)
      const topChannel = filteredGrouped.channelTotals[0] || null
      return {
        label1: 'Campaigns with Activity',
        value1: filteredGrouped.campaigns.length,
        totalClicks,
        totalUnique,
        label4: 'Top Channel',
        value4: topChannel ? `${topChannel.label} (${topChannel.clicks.toLocaleString('en-GB')})` : '\u2014',
      }
    }
    const totalClicks = filteredLinks.reduce((sum, l) => sum + l.totalClicks, 0)
    const totalUnique = filteredLinks.reduce((sum, l) => sum + l.uniqueVisitors, 0)
    const topLink = filteredLinks.reduce<AnalyticsLinkRow | null>((best, l) =>
      !best || l.totalClicks > best.totalClicks ? l : best, null)
    return {
      label1: 'Active Links',
      value1: filteredLinks.length,
      totalClicks,
      totalUnique,
      label4: 'Top Link',
      value4: topLink ? `/${topLink.shortCode} (${topLink.totalClicks.toLocaleString('en-GB')})` : '\u2014',
    }
  }, [activeTab, filteredGrouped, filteredLinks])

  // --- Handlers ---

  const applyPreset = useCallback((presetValue: string) => {
    const days = parseInt(presetValue)
    const { start, end } = buildDefaultRange(days)
    setPreset(presetValue)
    setStartAt(start.toISOString())
    setEndAt(end.toISOString())
    setStartInput(toDateTimeLocalValue(start))
    setEndInput(toDateTimeLocalValue(end))
  }, [])

  const handlePresetChange = useCallback((nextPreset: string) => {
    if (nextPreset === 'custom') {
      setPreset('custom')
      return
    }
    applyPreset(nextPreset)
  }, [applyPreset])

  const handleStartInputChange = useCallback((value: string) => {
    setPreset('custom')
    setStartInput(value)
    const parsed = parseDateTimeLocalValue(value)
    if (parsed) {
      setStartAt(parsed.toISOString())
    }
  }, [])

  const handleEndInputChange = useCallback((value: string) => {
    setPreset('custom')
    setEndInput(value)
    const parsed = parseDateTimeLocalValue(value)
    if (parsed) {
      setEndAt(parsed.toISOString())
    }
  }, [])

  // --- Derived display values ---

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdated) return 'Not updated yet'
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(lastUpdated)
  }, [lastUpdated])

  const clickLabel = includeBots ? 'Total Clicks' : 'Human Clicks'
  const showInitialLoading = loadingVolume && !hasLoaded
  const showEmptyState = hasLoaded && !loadingVolume && analyticsData.length === 0 && !errorMessage
  const showErrorState = hasLoaded && !loadingVolume && analyticsData.length === 0 && !!errorMessage
  const showInlineError = !!errorMessage && analyticsData.length > 0
  const isRefreshing = loadingVolume && hasLoaded

  return (
    <PageLayout
      title="Short Links"
      subtitle="Track click performance and trends for l.the-anchor.pub short links"
      backButton={{
        label: 'Back to Settings',
        href: '/settings',
      }}
      navItems={navItems}
    >
      <div className="space-y-6">
        {/* Controls bar */}
        <Card variant="bordered">
          <div className="p-4 sm:p-6 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1">
                <label htmlFor="preset-select" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Time Range
                </label>
                <Select
                  id="preset-select"
                  value={preset}
                  onChange={(e) => handlePresetChange(e.target.value)}
                >
                  {TIME_PRESETS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  <option value="custom">Custom range</option>
                </Select>
              </div>

              {preset === 'custom' && (
                <>
                  <div className="space-y-1">
                    <label htmlFor="custom-start" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Custom Start
                    </label>
                    <Input
                      id="custom-start"
                      type="datetime-local"
                      value={startInput}
                      onChange={(e) => handleStartInputChange(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="custom-end" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Custom End
                    </label>
                    <Input
                      id="custom-end"
                      type="datetime-local"
                      value={endInput}
                      onChange={(e) => handleEndInputChange(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
                  <Button
                    size="sm"
                    variant={!includeBots ? 'primary' : 'ghost'}
                    onClick={() => setIncludeBots(false)}
                    className={!includeBots ? 'shadow-sm' : ''}
                  >
                    Human only
                  </Button>
                  <Button
                    size="sm"
                    variant={includeBots ? 'primary' : 'ghost'}
                    onClick={() => setIncludeBots(true)}
                    className={includeBots ? 'shadow-sm' : ''}
                  >
                    Include bots
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadVolumeData()}
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
                  placeholder="Search by name, short code, or destination..."
                />
              </div>

              <p className="text-xs text-gray-500">
                Last updated: {lastUpdatedLabel}
                {isRefreshing ? ' (refreshing...)' : ''}
              </p>
            </div>
          </div>
        </Card>

        {/* Content area */}
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
                  <Button variant="primary" onClick={() => void loadVolumeData()}>
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
                description={includeBots
                  ? 'No tracked clicks were found in the selected time range. Try a different range.'
                  : 'No tracked human clicks were found in the selected time range. Try including bots or widening the range.'}
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

            {/* Summary stats */}
            <Card>
              <StatGroup columns={4}>
                <Stat
                  label={stats.label1}
                  value={formatNumber(stats.value1)}
                  icon={<LinkIcon className="h-5 w-5 text-blue-500" />}
                  variant="bordered"
                />
                <Stat
                  label={clickLabel}
                  value={formatNumber(stats.totalClicks)}
                  icon={<CursorArrowRaysIcon className="h-5 w-5 text-indigo-500" />}
                  variant="bordered"
                />
                <Stat
                  label="Unique Visitors"
                  value={formatNumber(stats.totalUnique)}
                  icon={<UsersIcon className="h-5 w-5 text-emerald-500" />}
                  variant="bordered"
                />
                <Stat
                  label={stats.label4}
                  value={stats.value4}
                  variant="bordered"
                />
              </StatGroup>
            </Card>

            {/* Tab toggle */}
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
              <Button
                size="sm"
                variant={activeTab === 'campaigns' ? 'primary' : 'ghost'}
                onClick={() => setActiveTab('campaigns')}
                className={activeTab === 'campaigns' ? 'shadow-sm' : ''}
              >
                Campaigns
              </Button>
              <Button
                size="sm"
                variant={activeTab === 'all-links' ? 'primary' : 'ghost'}
                onClick={() => setActiveTab('all-links')}
                className={activeTab === 'all-links' ? 'shadow-sm' : ''}
              >
                All Links
              </Button>
            </div>

            {/* Tab content */}
            {activeTab === 'campaigns' ? (
              <CampaignsTab
                campaigns={filteredGrouped.campaigns}
                standalone={filteredGrouped.standalone}
                channelTotals={filteredGrouped.channelTotals}
                searchTerm={searchTerm}
              />
            ) : (
              <AllLinksTab links={filteredLinks} searchTerm={searchTerm} />
            )}
          </div>
        )}
      </div>
    </PageLayout>
  )
}
