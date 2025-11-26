'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  LinkIcon,
  ChartBarIcon,
  TrashIcon,
  ClipboardDocumentIcon,
  PencilIcon,
  CalendarDaysIcon,
  DevicePhoneMobileIcon,
  ComputerDesktopIcon,
  GlobeAltIcon,
  QrCodeIcon,
  PlusIcon
} from '@heroicons/react/24/outline'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { LineChart } from '@/components/charts/LineChart'
import { BarChart } from '@/components/charts/BarChart'
import toast from 'react-hot-toast'
import {
  createShortLink,
  updateShortLink,
  deleteShortLink,
  getShortLinks,
  getShortLinkAnalytics,
  getShortLinkAnalyticsSummary,
  getShortLinkVolume
} from '@/app/actions/short-links'

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

interface VolumeDataResponse {
  shortCode: string
  linkType: string
  destinationUrl: string
  totalClicks: number
  uniqueVisitors: number
  data: Array<{ date: string; value: number }>
}

interface Props {
  initialLinks: ShortLink[]
  canManage: boolean
}

const SHORT_LINK_BASE_URL = 'https://vip-club.uk'

export default function ShortLinksClient({ initialLinks, canManage }: Props) {
  const [links, setLinks] = useState<ShortLink[]>(initialLinks)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false)
  const [showVolumeChart, setShowVolumeChart] = useState(false)
  const [selectedLink, setSelectedLink] = useState<ShortLink | null>(null)
  const [analytics, setAnalytics] = useState<ShortLinkAnalytics | null>(null)
  const [volumeData, setVolumeData] = useState<VolumeDataResponse[] | null>(null)
  const [volumePeriod, setVolumePeriod] = useState('30')
  const [loadingVolume, setLoadingVolume] = useState(false)
  const [volumeChartType, setVolumeChartType] = useState<'clicks' | 'unique'>('clicks')
  const [name, setName] = useState('')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [linkType, setLinkType] = useState('custom')
  const [customCode, setCustomCode] = useState('')
  const [expiresIn, setExpiresIn] = useState('never')
  const [creating, setCreating] = useState(false)
  const [updating, setUpdating] = useState(false)

  const refreshLinks = useCallback(async () => {
    const result = await getShortLinks()
    if (!result || 'error' in result) {
      toast.error(result?.error || 'Failed to load short links')
      return
    }
    const list = Array.isArray(result.data) ? result.data : []
    setLinks(list as ShortLink[])
  }, [])

  useEffect(() => {
    setLinks(initialLinks)
  }, [initialLinks])

  const resetForm = () => {
    setName('')
    setDestinationUrl('')
    setCustomCode('')
    setLinkType('custom')
    setExpiresIn('never')
    setSelectedLink(null)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)

    try {
      let expiresAt: string | undefined
      if (expiresIn !== 'never') {
        const date = new Date()
        if (expiresIn === '1d') date.setDate(date.getDate() + 1)
        else if (expiresIn === '7d') date.setDate(date.getDate() + 7)
        else if (expiresIn === '30d') date.setDate(date.getDate() + 30)
        expiresAt = date.toISOString()
      }

      const result = await createShortLink({
        name: name || undefined,
        destination_url: destinationUrl,
        link_type: linkType as any,
        custom_code: customCode || undefined,
        expires_at: expiresAt
      })

      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to create short link')
        return
      }

      toast.success(`Short link created: ${result.data?.full_url}`)
      if (result.data?.full_url && navigator.clipboard) {
        await navigator.clipboard.writeText(result.data.full_url)
        toast.success('Copied to clipboard!')
      }

      setShowCreateModal(false)
      resetForm()
      await refreshLinks()
    } catch (error) {
      console.error('Failed to create short link', error)
      toast.error('Failed to create short link')
    } finally {
      setCreating(false)
    }
  }

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

  const handleViewAnalytics = async (link: ShortLink) => {
    setSelectedLink(link)
    setShowAnalyticsModal(true)
    setAnalytics(null)

    try {
      const [detailResult, summaryResult] = await Promise.all([
        getShortLinkAnalytics(link.short_code),
        getShortLinkAnalyticsSummary(link.short_code, 30)
      ])

      if (!detailResult || 'error' in detailResult) {
        toast.error(detailResult?.error || 'Failed to load analytics')
        setAnalytics(null)
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
    }
  }

  const handleCopyLink = async (link: ShortLink) => {
    const fullUrl = `${SHORT_LINK_BASE_URL}/${link.short_code}`
    await navigator.clipboard.writeText(fullUrl)
    toast.success('Link copied to clipboard!')
  }

  const handleCopyQrCode = async (link: ShortLink) => {
    const fullUrl = `${SHORT_LINK_BASE_URL}/${link.short_code}`

    try {
      const QRCode = await import('qrcode')
      const dataUrl = await QRCode.toDataURL(fullUrl, { margin: 1 })

      if (
        navigator.clipboard &&
        'write' in navigator.clipboard &&
        typeof window !== 'undefined' &&
        'ClipboardItem' in window
      ) {
        const response = await fetch(dataUrl)
        const blob = await response.blob()
        const clipboardItem = new (window as any).ClipboardItem({ [blob.type]: blob })
        await navigator.clipboard.write([clipboardItem])
        toast.success('QR code copied to clipboard!')
        return
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(dataUrl)
        toast.success('QR code copied as data URL!')
        return
      }

      throw new Error('Clipboard API not available')
    } catch (error) {
      console.error('Failed to copy QR code', error)
      toast.error('Failed to copy QR code')
    }
  }

  const handleEdit = (link: ShortLink) => {
    setSelectedLink(link)
    setName(link.name || '')
    setDestinationUrl(link.destination_url)
    setLinkType(link.link_type)
    setCustomCode(link.short_code)

    if (link.expires_at) {
      const expiryDate = new Date(link.expires_at)
      const now = new Date()
      const diffDays = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays <= 1) setExpiresIn('1d')
      else if (diffDays <= 7) setExpiresIn('7d')
      else if (diffDays <= 30) setExpiresIn('30d')
      else setExpiresIn('never')
    } else {
      setExpiresIn('never')
    }

    setShowEditModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedLink) return
    setUpdating(true)

    try {
      let expiresAt: string | null = null
      if (expiresIn !== 'never') {
        const date = new Date()
        if (expiresIn === '1d') date.setDate(date.getDate() + 1)
        else if (expiresIn === '7d') date.setDate(date.getDate() + 7)
        else if (expiresIn === '30d') date.setDate(date.getDate() + 30)
        expiresAt = date.toISOString()
      }

      const result = await updateShortLink({
        id: selectedLink.id,
        name: name || null,
        destination_url: destinationUrl,
        link_type: linkType as any,
        expires_at: expiresAt
      })

      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to update short link')
        return
      }

      toast.success('Short link updated')
      setShowEditModal(false)
      resetForm()
      await refreshLinks()
    } catch (error) {
      console.error('Failed to update short link', error)
      toast.error('Failed to update short link')
    } finally {
      setUpdating(false)
    }
  }

  const handleDelete = async (linkId: string) => {
    const link = links.find(l => l.id === linkId)
    if (!link) return

    const message = `Are you sure you want to delete this short link?\n\n${SHORT_LINK_BASE_URL}/${link.short_code}\n\nAfter deletion, anyone visiting this link will no longer be redirected.`
    if (!confirm(message)) return

    try {
      const result = await deleteShortLink(linkId)
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to delete short link')
        return
      }

      toast.success('Short link deleted')
      await refreshLinks()
    } catch (error) {
      console.error('Failed to delete short link', error)
      toast.error('Failed to delete short link')
    }
  }

  const navActions = (
    <NavGroup>
      <NavLink
        onClick={() => {
          setShowVolumeChart(true)
          loadVolumeData(volumePeriod)
        }}
      >
        View Volume Chart
      </NavLink>
    </NavGroup>
  )

  const headerActions = canManage ? (
    <Button
      variant="primary"
      onClick={() => setShowCreateModal(true)}
      leftIcon={<PlusIcon className="h-5 w-5" />}
    >
      Create Short Link
    </Button>
  ) : null

  return (
    <PageLayout
      title="Short Links"
      subtitle="Create and manage vip-club.uk short links"
      backButton={{
        label: 'Back to Settings',
        href: '/settings'
      }}
      navActions={navActions}
      headerActions={headerActions}
    >
      <div className="space-y-6">
        <Card id="links" variant="bordered">
          <DataTable
            data={links}
            getRowKey={(link) => link.id}
            emptyMessage="No short links"
            emptyDescription="Get started by creating a new short link."
            columns={[
              {
                key: 'name',
                header: 'Name',
                cell: (link) =>
                  link.name ? (
                    <span className="text-sm">{link.name}</span>
                  ) : (
                    <span className="text-xs text-gray-400">(no name)</span>
                  ),
                sortable: true
              },
              {
                key: 'short_code',
                header: 'Short Link',
                cell: (link) => (
                  <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                    {SHORT_LINK_BASE_URL.replace(/^https?:\/\//, '')}/{link.short_code}
                  </code>
                )
              },
              {
                key: 'destination_url',
                header: 'Destination',
                cell: (link) => (
                  <div className="text-sm text-gray-900 truncate max-w-xs" title={link.destination_url}>
                    {link.destination_url}
                  </div>
                )
              },
              {
                key: 'link_type',
                header: 'Type',
                cell: (link) => (
                  <Badge variant="info" size="sm">
                    {link.link_type}
                  </Badge>
                )
              },
              {
                key: 'click_count',
                header: 'Clicks',
                cell: (link) => link.click_count ?? 0,
                sortable: true
              },
              {
                key: 'created_at',
                header: 'Created',
                cell: (link) => new Date(link.created_at).toLocaleDateString(),
                sortable: true
              },
              {
                key: 'actions',
                header: 'Actions',
                align: 'right',
                cell: (link) => (
                  <div className="flex items-center justify-end gap-1">
                    <IconButton
                      size="sm"
                      variant="secondary"
                      onClick={() => handleCopyQrCode(link)}
                      title="Copy QR code"
                    >
                      <QrCodeIcon className="h-4 w-4 text-gray-600" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="secondary"
                      onClick={() => handleCopyLink(link)}
                      title="Copy link"
                    >
                      <ClipboardDocumentIcon className="h-4 w-4 text-gray-600" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="secondary"
                      onClick={() => handleViewAnalytics(link)}
                      title="View analytics"
                    >
                      <ChartBarIcon className="h-4 w-4 text-gray-600" />
                    </IconButton>
                    {canManage && (
                      <>
                        <IconButton
                          size="sm"
                          variant="secondary"
                          onClick={() => handleEdit(link)}
                          title="Edit"
                        >
                          <PencilIcon className="h-4 w-4 text-gray-600" />
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="secondary"
                          onClick={() => handleDelete(link.id)}
                          title="Delete"
                        >
                          <TrashIcon className="h-4 w-4 text-red-600" />
                        </IconButton>
                      </>
                    )}
                  </div>
                )
              }
            ]}
            renderMobileCard={(link) => (
              <Card padding="sm">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 min-w-0 mr-4">
                    {link.name && <div className="text-sm font-medium mb-1">{link.name}</div>}
                    <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded inline-block mb-2">
                      {SHORT_LINK_BASE_URL.replace(/^https?:\/\//, '')}/{link.short_code}
                    </code>
                    <p className="text-xs text-gray-600 truncate">{link.destination_url}</p>
                  </div>
                  <Badge variant="info" size="sm">
                    {link.link_type}
                  </Badge>
                </div>

                <div className="flex justify-between items-center text-sm text-gray-500 mb-3">
                  <span>{link.click_count ?? 0} clicks</span>
                  <span>{new Date(link.created_at).toLocaleDateString()}</span>
                </div>

                <div className="flex justify-between border-t pt-3">
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleCopyQrCode(link)}
                    title="Copy QR code"
                  >
                    <QrCodeIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleCopyLink(link)}
                    title="Copy link"
                  >
                    <ClipboardDocumentIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleViewAnalytics(link)}
                    title="View analytics"
                  >
                    <ChartBarIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                  {canManage && (
                    <>
                      <IconButton
                        size="sm"
                        variant="secondary"
                        onClick={() => handleEdit(link)}
                        title="Edit"
                      >
                        <PencilIcon className="h-4 w-4 text-gray-600" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDelete(link.id)}
                        title="Delete"
                      >
                        <TrashIcon className="h-4 w-4 text-red-600" />
                      </IconButton>
                    </>
                  )}
                </div>
              </Card>
            )}
          />
        </Card>
      </div>

      <Modal
          open={showCreateModal}
          onClose={() => {
            setShowCreateModal(false)
            resetForm()
          }}
          title="Create Short Link"
        >
          {canManage ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <FormGroup label="Name (optional)">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Friendly name for this link"
                />
              </FormGroup>

              <FormGroup label="Destination URL" required>
                <Input
                  type="url"
                  value={destinationUrl}
                  onChange={(e) => setDestinationUrl(e.target.value)}
                  required
                  placeholder="https://"
                />
              </FormGroup>

              <FormGroup label="Link Type">
                <Select value={linkType} onChange={(e) => setLinkType(e.target.value)}>
                  <option value="custom">Custom</option>
                <option value="event_checkin">Event Check-in</option>
                  <option value="promotion">Promotion</option>
                  <option value="reward_redemption">Reward Redemption</option>
                </Select>
              </FormGroup>

              <FormGroup label="Custom Code (optional)">
                <Input
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  placeholder="Leave blank for auto-generated code"
                />
              </FormGroup>

              <FormGroup label="Expires">
                <Select value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)}>
                  <option value="never">Never</option>
                  <option value="1d">In 1 day</option>
                  <option value="7d">In 7 days</option>
                  <option value="30d">In 30 days</option>
                </Select>
              </FormGroup>

              <ModalActions>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowCreateModal(false)
                    resetForm()
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={creating} disabled={!destinationUrl}>
                  Create Link
                </Button>
              </ModalActions>
            </form>
          ) : (
            <EmptyState
              title="Insufficient permissions"
              description="You do not have permission to create short links."
            />
          )}
        </Modal>

        <Modal
          open={showEditModal}
          onClose={() => {
            setShowEditModal(false)
            resetForm()
          }}
          title="Edit Short Link"
        >
          {canManage ? (
            <form onSubmit={handleUpdate} className="space-y-4">
              <FormGroup label="Name (optional)">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </FormGroup>

              <FormGroup label="Destination URL" required>
                <Input
                  type="url"
                  value={destinationUrl}
                  onChange={(e) => setDestinationUrl(e.target.value)}
                  required
                />
              </FormGroup>

              <FormGroup label="Link Type">
                <Select value={linkType} onChange={(e) => setLinkType(e.target.value)}>
                  <option value="custom">Custom</option>
                <option value="event_checkin">Event Check-in</option>
                  <option value="promotion">Promotion</option>
                  <option value="reward_redemption">Reward Redemption</option>
                </Select>
              </FormGroup>

              <FormGroup label="Expires">
                <Select value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)}>
                  <option value="never">Never</option>
                  <option value="1d">In 1 day</option>
                  <option value="7d">In 7 days</option>
                  <option value="30d">In 30 days</option>
                </Select>
              </FormGroup>

              <ModalActions>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowEditModal(false)
                    resetForm()
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={updating}>
                  Save Changes
                </Button>
              </ModalActions>
            </form>
          ) : (
            <EmptyState
              title="Insufficient permissions"
              description="You do not have permission to edit short links."
            />
          )}
        </Modal>

        <Modal
          open={showAnalyticsModal}
          onClose={() => {
            setShowAnalyticsModal(false)
            setAnalytics(null)
          }}
          title="Link Analytics"
          size="xl"
        >
          {selectedLink && analytics ? (
            <div className="space-y-4">
              <Card variant="bordered" padding="sm">
                <p className="text-xs sm:text-sm text-gray-600">Short Link</p>
                <p className="font-mono text-sm sm:text-base">
                  {SHORT_LINK_BASE_URL.replace(/^https?:\/\//, '')}/{selectedLink.short_code}
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
          ) : (
            <div className="py-8">
              <EmptyState
                title="Loading analytics"
                description="Please wait while we load the analytics for this link."
              />
            </div>
          )}
        </Modal>

        <Modal
          open={showVolumeChart}
          onClose={() => {
            setShowVolumeChart(false)
            setVolumeData(null)
          }}
          title="Short Link Volume"
          size="xl"
        >
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <Select
                value={volumePeriod}
                onChange={(e) => {
                  const value = e.target.value
                  setVolumePeriod(value)
                  loadVolumeData(value)
                }}
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
    </PageLayout>
  )
}
