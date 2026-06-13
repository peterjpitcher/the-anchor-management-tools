'use client'

import { useState, useCallback, useMemo } from 'react'
import { Card } from '@/ds'
import { Button } from '@/ds'
import { Badge } from '@/ds'
import { Select } from '@/ds'
import { Spinner } from '@/ds'
import { toast } from '@/ds'
import { ClipboardDocumentIcon, ArrowDownTrayIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import type { EventMarketingLink } from '@/app/actions/event-marketing-links'
import { generateSingleMarketingLink } from '@/app/actions/event-marketing-links'
import {
  EVENT_MARKETING_CHANNELS,
  isEventMarketingQrChannel,
  type EventMarketingChannelConfig,
  type EventMarketingChannelKey,
  type EventMarketingChannelType,
} from '@/lib/event-marketing-links'

interface EventMarketingLinksCardProps {
  links: EventMarketingLink[]
  loading?: boolean
  error?: string | null
  onRegenerate?: () => Promise<void>
  eventId: string
  onLinkGenerated: (link: EventMarketingLink) => void
}

function placementLabel(type: EventMarketingChannelType): string {
  if (type === 'screen') return 'Screen'
  if (type === 'print') return 'Print'
  return 'Digital'
}

export function EventMarketingLinksCard({
  links,
  loading = false,
  error,
  onRegenerate,
  eventId,
  onLinkGenerated,
}: EventMarketingLinksCardProps) {
  const [generatingChannels, setGeneratingChannels] = useState<Set<EventMarketingChannelKey>>(new Set())
  const [generatingAllQr, setGeneratingAllQr] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<EventMarketingChannelKey | ''>('')

  const linkByChannel = useMemo(() => {
    return new Map(links.map(link => [link.channel, link]))
  }, [links])

  const alwaysOnLinks = useMemo(
    () => links.filter(l => {
      const cfg = EVENT_MARKETING_CHANNELS.find(c => c.key === l.channel)
      return cfg?.tier === 'always_on'
    }),
    [links]
  )

  const onDemandDigitalLinks = useMemo(
    () => links.filter(l => {
      const cfg = EVENT_MARKETING_CHANNELS.find(c => c.key === l.channel)
      return cfg?.tier === 'on_demand' && cfg?.type === 'digital'
    }),
    [links]
  )

  const qrPlacementChannels = useMemo(
    () => EVENT_MARKETING_CHANNELS.filter(isEventMarketingQrChannel),
    []
  )

  const missingCreatableChannels = useMemo(
    () => EVENT_MARKETING_CHANNELS.filter(
      c => c.tier === 'on_demand' && !linkByChannel.has(c.key)
    ),
    [linkByChannel]
  )

  const missingQrPlacements = useMemo(
    () => qrPlacementChannels.filter(c => !linkByChannel.has(c.key)),
    [linkByChannel, qrPlacementChannels]
  )

  const readyQrPlacementChannels = useMemo(
    () => qrPlacementChannels.filter(c => linkByChannel.has(c.key)),
    [linkByChannel, qrPlacementChannels]
  )

  const missingQrCreateChannels = useMemo(
    () => missingCreatableChannels.filter(isEventMarketingQrChannel),
    [missingCreatableChannels]
  )

  const missingDigitalCreateChannels = useMemo(
    () => missingCreatableChannels.filter(c => c.type === 'digital'),
    [missingCreatableChannels]
  )

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied to clipboard`)
    } catch (err) {
      console.error('Copy failed', err)
      toast.error('Failed to copy to clipboard')
    }
  }

  const handleDownloadQr = (link: EventMarketingLink) => {
    if (!link.qrCode) return
    const anchor = document.createElement('a')
    anchor.href = link.qrCode
    anchor.download = `${link.channel}-${link.shortCode}.png`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  const handleGenerate = useCallback(async (channel: EventMarketingChannelKey) => {
    setGeneratingChannels(prev => new Set(prev).add(channel))
    try {
      const result = await generateSingleMarketingLink(eventId, channel)
      if (result.success && result.link) {
        onLinkGenerated(result.link)
        toast.success(`${result.link.label} link generated`)
        setSelectedChannel('')
      } else {
        toast.error(result.error ?? 'Failed to generate link')
      }
    } catch {
      toast.error('Failed to generate link')
    } finally {
      setGeneratingChannels(prev => {
        const next = new Set(prev)
        next.delete(channel)
        return next
      })
    }
  }, [eventId, onLinkGenerated])

  const handleGenerateSelected = useCallback(() => {
    if (!selectedChannel) return
    void handleGenerate(selectedChannel)
  }, [handleGenerate, selectedChannel])

  const selectedChannelIsGenerating = selectedChannel ? generatingChannels.has(selectedChannel) : false

  const handleGenerateAllQr = useCallback(async () => {
    if (missingQrPlacements.length === 0) return

    const channels = missingQrPlacements.map(channel => channel.key)
    setGeneratingAllQr(true)
    setGeneratingChannels(prev => new Set([...prev, ...channels]))

    let successCount = 0
    let failureCount = 0

    try {
      for (const channel of channels) {
        const result = await generateSingleMarketingLink(eventId, channel)
        if (result.success && result.link) {
          onLinkGenerated(result.link)
          successCount += 1
        } else {
          failureCount += 1
        }
      }

      if (successCount > 0) toast.success(`${successCount} QR link${successCount === 1 ? '' : 's'} generated`)
      if (failureCount > 0) toast.error(`${failureCount} QR link${failureCount === 1 ? '' : 's'} failed`)
    } catch {
      toast.error('Failed to generate QR links')
    } finally {
      setGeneratingAllQr(false)
      setGeneratingChannels(prev => {
        const next = new Set(prev)
        channels.forEach(channel => next.delete(channel))
        return next
      })
    }
  }, [eventId, missingQrPlacements, onLinkGenerated])

  const renderQrPlacementCard = (channel: EventMarketingChannelConfig) => {
    const link = linkByChannel.get(channel.key)
    if (!link) return null

    return (
      <div
        key={channel.key}
        className="flex flex-col justify-between rounded-lg border border-gray-200 p-4"
      >
        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">{channel.label}</p>
              {channel.description && (
                <p className="text-xs text-gray-500">{channel.description}</p>
              )}
            </div>
            <Badge variant="secondary" size="sm">{placementLabel(channel.type)}</Badge>
          </div>

          <div className="mt-3 flex items-center gap-3">
            {link.qrCode ? (
              <img
                src={link.qrCode}
                alt={`${link.label} QR`}
                className="h-28 w-28 rounded-md border border-gray-200 bg-white object-contain p-2"
              />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-md border border-dashed border-gray-300 text-xs text-gray-400">
                QR unavailable
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="break-all font-mono text-sm text-blue-600">{link.shortUrl}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => handleCopy(link.shortUrl, `${link.label} link`)}
                  leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                >
                  Copy link
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => handleDownloadQr(link)}
                  leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
                  disabled={!link.qrCode}
                >
                  Download QR
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-xs text-gray-600">{link.destinationUrl}</span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => handleCopy(link.destinationUrl, `${link.label} destination`)}
              leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
            >
              Copy URL
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <Badge variant="secondary" size="sm">source: {link?.utm.utm_source ?? channel.utmSource}</Badge>
          <Badge variant="secondary" size="sm">medium: {link?.utm.utm_medium ?? channel.utmMedium}</Badge>
          {link?.utm.utm_campaign && (
            <Badge variant="secondary" size="sm">campaign: {link.utm.utm_campaign}</Badge>
          )}
          <Badge variant="secondary" size="sm">content: {link?.utm.utm_content ?? channel.utmContent}</Badge>
        </div>
      </div>
    )
  }

  return (
    <Card padding="lg" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Marketing Links &amp; QR Codes</h2>
          <p className="mt-1 text-sm text-gray-500">
            Tracked links and QR assets for event promotion.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {missingQrPlacements.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerateAllQr}
              disabled={loading || generatingAllQr}
              leftIcon={<ArrowPathIcon className="h-4 w-4" />}
            >
              {generatingAllQr ? 'Generating QR links…' : 'Generate missing QR links'}
            </Button>
          )}
          {onRegenerate && (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                if (loading) return
                await onRegenerate()
              }}
              disabled={loading}
              leftIcon={<ArrowPathIcon className="h-4 w-4" />}
            >
              Refresh links
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="text-gray-400" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="space-y-8">
          {missingCreatableChannels.length > 0 && (
            <section className="rounded-lg border border-gray-200 bg-surface-hover/40 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-60 flex-1">
                  <Select
                    label="Create tracked link"
                    value={selectedChannel}
                    onChange={(event) => setSelectedChannel(event.target.value as EventMarketingChannelKey | '')}
                    placeholder="Choose a link or QR type"
                    disabled={Boolean(generatingChannels.size) || generatingAllQr}
                  >
                    {missingQrCreateChannels.length > 0 && (
                      <optgroup label="QR code placements">
                        {missingQrCreateChannels.map(channel => (
                          <option key={channel.key} value={channel.key}>
                            {channel.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {missingDigitalCreateChannels.length > 0 && (
                      <optgroup label="Digital links">
                        {missingDigitalCreateChannels.map(channel => (
                          <option key={channel.key} value={channel.key}>
                            {channel.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleGenerateSelected}
                  disabled={!selectedChannel || selectedChannelIsGenerating || generatingAllQr}
                >
                  {selectedChannelIsGenerating ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </section>
          )}

          {/* Section 1: QR code placements */}
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">QR code placements</h3>
              <Badge variant="secondary" size="sm">
                {readyQrPlacementChannels.length}/{qrPlacementChannels.length} ready
              </Badge>
            </div>
            {readyQrPlacementChannels.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 bg-surface-hover/40 p-4 text-sm text-gray-500">
                No QR placement links created yet.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {readyQrPlacementChannels.map(renderQrPlacementCard)}
              </div>
            )}
          </section>

          {/* Section 2: Always-on digital */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Digital channels</h3>
            <div className="space-y-3">
              {alwaysOnLinks.map((link) => (
                <div key={link.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{link.label}</p>
                      {link.description && (
                        <p className="text-xs text-gray-500">{link.description}</p>
                      )}
                    </div>
                    <Badge variant="info" size="sm">Digital</Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-blue-600">{link.shortUrl}</span>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => handleCopy(link.shortUrl, `${link.label} link`)}
                      leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                    >
                      Copy link
                    </Button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-gray-600 break-all">{link.destinationUrl}</span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleCopy(link.destinationUrl, `${link.label} destination`)}
                      leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                    >
                      Copy URL
                    </Button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <Badge variant="secondary" size="sm">source: {link.utm.utm_source}</Badge>
                    <Badge variant="secondary" size="sm">medium: {link.utm.utm_medium}</Badge>
                    <Badge variant="secondary" size="sm">campaign: {link.utm.utm_campaign}</Badge>
                    {link.utm.utm_content && (
                      <Badge variant="secondary" size="sm">content: {link.utm.utm_content}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Section 3: On-demand digital */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Optional digital channels</h3>
            <div className="space-y-3">
              {onDemandDigitalLinks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 bg-surface-hover/40 p-4 text-sm text-gray-500">
                  No optional digital links created yet.
                </p>
              ) : onDemandDigitalLinks.map((link) => (
                <div key={link.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{link.label}</p>
                      {link.description && (
                        <p className="text-xs text-gray-500">{link.description}</p>
                      )}
                    </div>
                    <Badge variant="info" size="sm">Digital</Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-blue-600">{link.shortUrl}</span>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => handleCopy(link.shortUrl, `${link.label} link`)}
                      leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                    >
                      Copy link
                    </Button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-gray-600 break-all">{link.destinationUrl}</span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleCopy(link.destinationUrl, `${link.label} destination`)}
                      leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                    >
                      Copy URL
                    </Button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <Badge variant="secondary" size="sm">source: {link.utm.utm_source}</Badge>
                    <Badge variant="secondary" size="sm">medium: {link.utm.utm_medium}</Badge>
                    <Badge variant="secondary" size="sm">campaign: {link.utm.utm_campaign}</Badge>
                    {link.utm.utm_content && (
                      <Badge variant="secondary" size="sm">content: {link.utm.utm_content}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>
      )}
    </Card>
  )
}
