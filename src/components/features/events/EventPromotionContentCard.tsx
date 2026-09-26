'use client'

import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Icon, Input, Textarea, toast } from '@/ds'
import { generateEventPromotionContent, type EventPromotionContentType } from '@/app/actions/event-content'
import { Select } from '@/ds'
import type { EventMarketingLink } from '@/app/actions/event-marketing-links'

type FacebookEventContent = {
  name: string
  description: string
}

type TitleDescriptionContent = {
  title: string
  description: string
}

type PromotionResultsByType = {
  facebook_event?: FacebookEventContent
  google_business_profile_event?: TitleDescriptionContent
}

type CtaLinkState = {
  selectedLinkId: string
  customUrl: string
}

type CtaLinkStateByType = Record<EventPromotionContentType, CtaLinkState>

const CONTENT_TYPES: Array<{ value: EventPromotionContentType; label: string; help: string }> = [
  {
    value: 'facebook_event',
    label: 'Facebook Event',
    help: 'Event name + description formatted for Facebook Events.',
  },
  {
    value: 'google_business_profile_event',
    label: 'Google Business Profile Event',
    help: 'Title + description optimised for GBP Event posts.',
  },
]

const PREFERRED_CHANNEL_BY_TYPE: Record<EventPromotionContentType, EventMarketingLink['channel']> = {
  facebook_event: 'facebook',
  google_business_profile_event: 'google_business_profile',
}

function buildInitialCtaState(initialUrl: string): CtaLinkStateByType {
  return {
    facebook_event: { selectedLinkId: '', customUrl: initialUrl },
    google_business_profile_event: { selectedLinkId: '', customUrl: initialUrl },
  }
}

function resolveCtaLabel(contentType: EventPromotionContentType): string {
  switch (contentType) {
    case 'facebook_event':
      return 'Paste into the Facebook Event link field'
    case 'google_business_profile_event':
      return 'Paste into the GBP post button link field'
  }
}

interface EventPromotionContentCardProps {
  eventId: string
  eventName: string
  initialTicketUrl?: string | null
  brief?: string | null
  marketingLinks?: EventMarketingLink[]
  facebookName?: string | null
  facebookDescription?: string | null
  googleTitle?: string | null
  googleDescription?: string | null
}

export function EventPromotionContentCard({
  eventId,
  eventName,
  initialTicketUrl,
  brief,
  marketingLinks = [],
  facebookName,
  facebookDescription,
  googleTitle,
  googleDescription,
}: EventPromotionContentCardProps) {
  const digitalLinks = useMemo(
    () => marketingLinks.filter((link) => link.type === 'digital'),
    [marketingLinks]
  )

  const [contentType, setContentType] = useState<EventPromotionContentType>('facebook_event')
  const [ctaStateByType, setCtaStateByType] = useState<CtaLinkStateByType>(() =>
    buildInitialCtaState(initialTicketUrl ?? '')
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const [resultsByType, setResultsByType] = useState<PromotionResultsByType>({})
  const [aiUnavailableMessage, setAiUnavailableMessage] = useState<string | null>(null)

  const existingSavedResults = useMemo<PromotionResultsByType>(() => {
    const saved: PromotionResultsByType = {}
    if (facebookName || facebookDescription) {
      saved.facebook_event = {
        name: facebookName ?? '',
        description: facebookDescription ?? '',
      }
    }
    if (googleTitle || googleDescription) {
      saved.google_business_profile_event = {
        title: googleTitle ?? '',
        description: googleDescription ?? '',
      }
    }
    return saved
  }, [facebookDescription, facebookName, googleDescription, googleTitle])

  useEffect(() => {
    setResultsByType((previous) => {
      let changed = false
      const next: PromotionResultsByType = { ...previous }

      if (!previous.facebook_event && existingSavedResults.facebook_event) {
        next.facebook_event = existingSavedResults.facebook_event
        changed = true
      }
      if (!previous.google_business_profile_event && existingSavedResults.google_business_profile_event) {
        next.google_business_profile_event = existingSavedResults.google_business_profile_event
        changed = true
      }
      return changed ? next : previous
    })
  }, [existingSavedResults])

  useEffect(() => {
    const ids = new Set(digitalLinks.map((link) => link.id))

    setCtaStateByType((previous) => {
      let changed = false
      const next: CtaLinkStateByType = { ...previous }

      for (const type of CONTENT_TYPES.map((item) => item.value)) {
        const current = previous[type]
        const isValid =
          current.selectedLinkId === 'custom' ||
          (current.selectedLinkId && ids.has(current.selectedLinkId))

        if (!current.selectedLinkId || !isValid) {
          const preferredChannel = PREFERRED_CHANNEL_BY_TYPE[type]
          const preferredLink = digitalLinks.find((link) => link.channel === preferredChannel)
          const fallback = preferredLink ?? digitalLinks[0] ?? null
          next[type] = {
            ...current,
            selectedLinkId: fallback ? fallback.id : 'custom',
          }
          changed = true
        }

        if (next[type].selectedLinkId === 'custom' && !next[type].customUrl && initialTicketUrl) {
          next[type] = { ...next[type], customUrl: initialTicketUrl }
          changed = true
        }
      }

      return changed ? next : previous
    })
  }, [digitalLinks, initialTicketUrl])

  const ctaState = ctaStateByType[contentType]

  const orderedDigitalLinks = useMemo(() => {
    const preferredChannel = PREFERRED_CHANNEL_BY_TYPE[contentType]
    const items = [...digitalLinks]
    items.sort((a, b) => {
      if (a.channel === preferredChannel) return -1
      if (b.channel === preferredChannel) return 1
      return 0
    })
    return items
  }, [contentType, digitalLinks])

  const selectedMarketingLink = useMemo(() => {
    if (!ctaState || ctaState.selectedLinkId === 'custom') return null
    return digitalLinks.find((link) => link.id === ctaState.selectedLinkId) ?? null
  }, [ctaState, digitalLinks])

  const selectedCtaUrl = useMemo(() => {
    if (!ctaState) return null
    if (ctaState.selectedLinkId === 'custom') {
      const trimmed = ctaState.customUrl.trim()
      return trimmed.length > 0 ? trimmed : null
    }
    return selectedMarketingLink?.shortUrl ?? null
  }, [ctaState, selectedMarketingLink])

  const handleGenerate = async () => {
    setAiUnavailableMessage(null)
    setIsGenerating(true)
    try {
      const response = await generateEventPromotionContent({
        eventId,
        contentType,
      })

      if (!response.success) {
        const errorMessage = response.error ?? 'Failed to generate content'
        const lowerCase = errorMessage.toLowerCase()
        if (
          (lowerCase.includes('api key') && (lowerCase.includes('invalid') || lowerCase.includes('expired'))) ||
          (lowerCase.includes('openai') && lowerCase.includes('configure')) ||
          lowerCase.includes('not configured')
        ) {
          setAiUnavailableMessage(
            'AI copy generation is unavailable. Check the OpenAI API key on the Settings page.'
          )
        }
        toast.error(errorMessage)
        return
      }

      const data = response.data
      switch (data.type) {
        case 'facebook_event':
          setResultsByType((previous) => ({ ...previous, facebook_event: data.content as FacebookEventContent }))
          break
        case 'google_business_profile_event':
          setResultsByType((previous) => ({
            ...previous,
            google_business_profile_event: data.content as TitleDescriptionContent,
          }))
          break
      }

      toast.success('Copy ready')
    } catch (error) {
      console.error('Failed to generate promotional content', error)
      toast.error('Failed to generate content')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch (error) {
      console.error('Copy failed', error)
      toast.error('Unable to copy')
    }
  }

  const currentResult = resultsByType[contentType]
  const selectedTypeMeta = CONTENT_TYPES.find((item) => item.value === contentType)

  return (
    <Card>
      <CardHeader title="AI Event Copy Builder" subtitle="Generate channel-specific event copy" />
      <CardBody className="flex min-w-0 flex-col gap-6">
      <p className="text-sm text-text-muted">Generated copy is not saved automatically.</p>

      {brief && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Brief snapshot</p>
          <div className="rounded-default border border-border bg-surface-2 p-3 text-sm text-text whitespace-pre-wrap max-h-48 overflow-y-auto">
            {brief}
          </div>
        </div>
      )}

      <Select
        id="content_type"
        label="Content type"
        hint={selectedTypeMeta?.help}
        value={contentType}
        onChange={(event) => setContentType(event.target.value as EventPromotionContentType)}
      >
        {CONTENT_TYPES.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </Select>

      <div className="space-y-2">
        {orderedDigitalLinks.length > 0 ? (
          <>
            <Select
              id="cta_link_option"
              label="CTA link"
              hint="Defaults to the best-fit UTM link for this channel. The URL is not included in the generated copy."
              value={ctaState.selectedLinkId}
              onChange={(event) =>
                setCtaStateByType((previous) => ({
                  ...previous,
                  [contentType]: { ...previous[contentType], selectedLinkId: event.target.value },
                }))
              }
            >
              {orderedDigitalLinks.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.label} – {link.shortUrl}
                </option>
              ))}
              <option value="custom">Custom link…</option>
            </Select>
          </>
        ) : null}
        {(ctaState.selectedLinkId === 'custom' || !orderedDigitalLinks.length) && (
          <Input
            id="cta_link_custom"
            label={orderedDigitalLinks.length ? undefined : 'CTA link'}
            hint={orderedDigitalLinks.length ? undefined : 'No marketing links yet. Refresh links above or enter a custom URL.'}
            aria-label="Custom booking link"
            type="url"
            value={ctaState.customUrl}
            onChange={(event) =>
              setCtaStateByType((previous) => ({
                ...previous,
                [contentType]: { ...previous[contentType], customUrl: event.target.value },
              }))
            }
            placeholder="https://..."
          />
        )}
      </div>

      <div className="rounded-default border border-border bg-surface-2 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">CTA link (copy/paste)</p>
            <p className="mt-1 text-xs text-text-muted">{resolveCtaLabel(contentType)}</p>
            {selectedCtaUrl ? (
              <p className="mt-2 font-mono text-sm text-primary break-all">{selectedCtaUrl}</p>
            ) : (
              <p className="mt-2 text-sm text-text-muted">Select a marketing link or enter a custom URL.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="secondary"
              disabled={!selectedCtaUrl}
              onClick={() => selectedCtaUrl && handleCopy(selectedCtaUrl, 'CTA link')}
              leftIcon={<Icon name="copy" size={16} />}
            >
              Copy Link
            </Button>
          </div>
        </div>
        {selectedMarketingLink && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <Badge tone="neutral" size="sm" className="min-w-0 break-all">source: {selectedMarketingLink.utm.utm_source}</Badge>
            <Badge tone="neutral" size="sm" className="min-w-0 break-all">medium: {selectedMarketingLink.utm.utm_medium}</Badge>
            <Badge tone="neutral" size="sm" className="min-w-0 break-all">campaign: {selectedMarketingLink.utm.utm_campaign}</Badge>
            {selectedMarketingLink.utm.utm_content && (
              <Badge tone="neutral" size="sm" className="min-w-0 break-all">content: {selectedMarketingLink.utm.utm_content}</Badge>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col items-start gap-3 border-t border-border pt-4">
        <p className="text-sm text-text-muted">
          Generates fresh copy every time. Run it again if you need a new angle.
        </p>
        <Button
          type="button"
          variant="primary"
          size="md"
          className="h-auto min-h-btn-h w-full whitespace-normal py-2 sm:w-auto"
          onClick={handleGenerate}
          disabled={Boolean(aiUnavailableMessage)}
          loading={isGenerating}
          leftIcon={<Icon name="refresh" size={16} />}
        >
          {`Generate ${selectedTypeMeta?.label ?? eventName} Copy`}
        </Button>
      </div>

      {aiUnavailableMessage && (
        <Alert tone="warning">{aiUnavailableMessage}</Alert>
      )}

      {currentResult && (
        <div className="space-y-6">
          {contentType === 'facebook_event' ? (
            (() => {
              const content = currentResult as FacebookEventContent
              return (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Facebook Event</p>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleCopy(`${content.name}\n\n${content.description}`.trim(), 'Facebook copy')}
                      leftIcon={<Icon name="copy" size={16} />}
                    >
                      Copy All
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Event name</p>
                        <Button
                          size="xs"
                          variant="ghost"
                          iconOnly
                          aria-label="Copy event name"
                          title="Copy event name"
                          disabled={content.name.trim().length === 0}
                          onClick={() => handleCopy(content.name.trim(), 'Event name')}
                          leftIcon={<Icon name="copy" size={16} />}
                        />
                      </div>
                      <p className="break-words rounded-default border border-border bg-surface p-3 text-sm text-text-strong">
                        {content.name}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                          Description ({content.description.length} chars)
                        </p>
                        <Button
                          size="xs"
                          variant="ghost"
                          iconOnly
                          aria-label="Copy description"
                          title="Copy description"
                          disabled={content.description.trim().length === 0}
                          onClick={() => handleCopy(content.description, 'Description')}
                          leftIcon={<Icon name="copy" size={16} />}
                        />
                      </div>
                      <Textarea
                        value={content.description}
                        readOnly
                        aria-label={`${selectedTypeMeta?.label} description`}
                        rows={8}
                      />
                    </div>
                  </div>
                </section>
              )
            })()
          ) : (
            (() => {
              const content = currentResult as TitleDescriptionContent
              const titleLabel = 'Google Business Profile'
              const copyLabel = 'GBP copy'
              return (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{titleLabel}</p>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleCopy(`${content.title}\n\n${content.description}`.trim(), copyLabel)}
                      leftIcon={<Icon name="copy" size={16} />}
                    >
                      Copy All
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Title</p>
                        <Button
                          size="xs"
                          variant="ghost"
                          iconOnly
                          aria-label="Copy title"
                          title="Copy title"
                          disabled={content.title.trim().length === 0}
                          onClick={() => handleCopy(content.title.trim(), 'Title')}
                          leftIcon={<Icon name="copy" size={16} />}
                        />
                      </div>
                      <p className="break-words rounded-default border border-border bg-surface p-3 text-sm text-text-strong">
                        {content.title}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                          Description ({content.description.length} chars)
                        </p>
                        <Button
                          size="xs"
                          variant="ghost"
                          iconOnly
                          aria-label="Copy description"
                          title="Copy description"
                          disabled={content.description.trim().length === 0}
                          onClick={() => handleCopy(content.description, 'Description')}
                          leftIcon={<Icon name="copy" size={16} />}
                        />
                      </div>
                      <Textarea
                        value={content.description}
                        readOnly
                        aria-label={`${selectedTypeMeta?.label} description`}
                        rows={8}
                      />
                    </div>
                  </div>
                </section>
              )
            })()
          )}
        </div>
      )}
      </CardBody>
    </Card>
  )
}
