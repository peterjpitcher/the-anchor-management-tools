'use client'

import { useState, useCallback, useMemo } from 'react'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Empty, Icon, PageLoading, Select, toast } from '@/ds'
import { eventLinkTypeTone } from '@/app/(authenticated)/events/_shared/status-ui'
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
        className="flex flex-col justify-between rounded-default border border-border p-4"
      >
        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-text">{channel.label}</p>
              {channel.description && (
                <p className="text-xs text-text-muted">{channel.description}</p>
              )}
            </div>
            <Badge tone="neutral" size="sm">{placementLabel(channel.type)}</Badge>
          </div>

          <div className="mt-3 flex items-center gap-3">
            {link.qrCode ? (
              <img
                src={link.qrCode}
                alt={`${link.label} QR`}
                className="h-28 w-28 rounded-default border border-border bg-surface object-contain p-2"
              />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-default border border-dashed border-border-strong text-xs text-text-soft">
                QR unavailable
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="break-all font-mono text-sm text-primary">{link.shortUrl}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => handleCopy(link.shortUrl, `${link.label} link`)}
                  leftIcon={<Icon name="copy" size={16} />}
                >
                  Copy Link
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => handleDownloadQr(link)}
                  leftIcon={<Icon name="download" size={16} />}
                  disabled={!link.qrCode}
                >
                  Download QR
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-xs text-text-muted">{link.destinationUrl}</span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => handleCopy(link.destinationUrl, `${link.label} destination`)}
              leftIcon={<Icon name="copy" size={16} />}
            >
              Copy URL
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <Badge tone="neutral" size="sm">source: {link?.utm.utm_source ?? channel.utmSource}</Badge>
          <Badge tone="neutral" size="sm">medium: {link?.utm.utm_medium ?? channel.utmMedium}</Badge>
          {link?.utm.utm_campaign && (
            <Badge tone="neutral" size="sm">campaign: {link.utm.utm_campaign}</Badge>
          )}
          <Badge tone="neutral" size="sm">content: {link?.utm.utm_content ?? channel.utmContent}</Badge>
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader
        title="Marketing Links & QR Codes"
        subtitle="Tracked links and QR assets for event promotion"
        // One button only: CardHeader keeps its action on one line beside the title, so a second
        // button pushed the pair past a phone-width card, which clips it. Generating the missing
        // QR links sits with the QR placements below instead.
        action={
          onRegenerate ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                if (loading) return
                await onRegenerate()
              }}
              disabled={loading}
              leftIcon={<Icon name="refresh" size={16} />}
            >
              Refresh Links
            </Button>
          ) : undefined
        }
      />
      <CardBody>
      {loading ? (
        <PageLoading inline label="Loading marketing links" />
      ) : error ? (
        <Alert tone="danger">{error}</Alert>
      ) : (
        <div className="space-y-8">
          {missingCreatableChannels.length > 0 && (
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
                disabled={!selectedChannel || generatingAllQr}
                loading={selectedChannelIsGenerating}
              >
                Create
              </Button>
            </div>
          )}

          {/* Section 1: QR code placements */}
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">QR code placements</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral" size="sm">
                  {readyQrPlacementChannels.length}/{qrPlacementChannels.length} ready
                </Badge>
                {missingQrPlacements.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleGenerateAllQr}
                    loading={generatingAllQr}
                    leftIcon={<Icon name="refresh" size={16} />}
                  >
                    Generate Missing QR Links
                  </Button>
                )}
              </div>
            </div>
            {readyQrPlacementChannels.length === 0 ? (
              <Empty size="sm" variant="dashed" title="No QR Placement Links Yet" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {readyQrPlacementChannels.map(renderQrPlacementCard)}
              </div>
            )}
          </section>

          {/* Section 2: Always-on digital */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Digital channels</p>
            <div className="space-y-3">
              {alwaysOnLinks.map((link) => (
                <div key={link.id} className="rounded-default border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-text">{link.label}</p>
                      {link.description && (
                        <p className="text-xs text-text-muted">{link.description}</p>
                      )}
                    </div>
                    <Badge tone={eventLinkTypeTone('digital')} size="sm">Digital</Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-primary">{link.shortUrl}</span>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => handleCopy(link.shortUrl, `${link.label} link`)}
                      leftIcon={<Icon name="copy" size={16} />}
                    >
                      Copy Link
                    </Button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-text-muted break-all">{link.destinationUrl}</span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleCopy(link.destinationUrl, `${link.label} destination`)}
                      leftIcon={<Icon name="copy" size={16} />}
                    >
                      Copy URL
                    </Button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    <Badge tone="neutral" size="sm">source: {link.utm.utm_source}</Badge>
                    <Badge tone="neutral" size="sm">medium: {link.utm.utm_medium}</Badge>
                    <Badge tone="neutral" size="sm">campaign: {link.utm.utm_campaign}</Badge>
                    {link.utm.utm_content && (
                      <Badge tone="neutral" size="sm">content: {link.utm.utm_content}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Section 3: On-demand digital */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Optional digital channels</p>
            <div className="space-y-3">
              {onDemandDigitalLinks.length === 0 ? (
                <Empty size="sm" variant="dashed" title="No Optional Digital Links Yet" />
              ) : onDemandDigitalLinks.map((link) => (
                <div key={link.id} className="rounded-default border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-text">{link.label}</p>
                      {link.description && (
                        <p className="text-xs text-text-muted">{link.description}</p>
                      )}
                    </div>
                    <Badge tone={eventLinkTypeTone('digital')} size="sm">Digital</Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-primary">{link.shortUrl}</span>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => handleCopy(link.shortUrl, `${link.label} link`)}
                      leftIcon={<Icon name="copy" size={16} />}
                    >
                      Copy Link
                    </Button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-text-muted break-all">{link.destinationUrl}</span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleCopy(link.destinationUrl, `${link.label} destination`)}
                      leftIcon={<Icon name="copy" size={16} />}
                    >
                      Copy URL
                    </Button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    <Badge tone="neutral" size="sm">source: {link.utm.utm_source}</Badge>
                    <Badge tone="neutral" size="sm">medium: {link.utm.utm_medium}</Badge>
                    <Badge tone="neutral" size="sm">campaign: {link.utm.utm_campaign}</Badge>
                    {link.utm.utm_content && (
                      <Badge tone="neutral" size="sm">content: {link.utm.utm_content}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>
      )}
      </CardBody>
    </Card>
  )
}
