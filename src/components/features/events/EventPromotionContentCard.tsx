'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui-v2/layout/Card'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { ClipboardDocumentIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { generateEventPromotionContent, type EventPromotionContentType } from '@/app/actions/event-content'
import { Select } from '@/components/ui-v2/forms/Select'
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
  opentable_experience?: TitleDescriptionContent
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
  {
    value: 'opentable_experience',
    label: 'OpenTable Experience',
    help: 'Simple title + paragraph description (target ~1500 characters).',
  },
]

const PREFERRED_CHANNEL_BY_TYPE: Record<EventPromotionContentType, EventMarketingLink['channel']> = {
  facebook_event: 'facebook',
  google_business_profile_event: 'google_business_profile',
  opentable_experience: 'opentable',
}

function buildInitialCtaState(initialUrl: string): CtaLinkStateByType {
  return {
    facebook_event: { selectedLinkId: '', customUrl: initialUrl },
    google_business_profile_event: { selectedLinkId: '', customUrl: initialUrl },
    opentable_experience: { selectedLinkId: '', customUrl: initialUrl },
  }
}

function resolveCtaLabel(contentType: EventPromotionContentType): string {
  switch (contentType) {
    case 'facebook_event':
      return 'Paste into the Facebook Event link field'
    case 'google_business_profile_event':
      return 'Paste into the GBP post button link field'
    case 'opentable_experience':
      return 'Paste into the OpenTable website link field'
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
  opentableTitle?: string | null
  opentableDescription?: string | null
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
  opentableTitle,
  opentableDescription,
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
    if (opentableTitle || opentableDescription) {
      saved.opentable_experience = {
        title: opentableTitle ?? '',
        description: opentableDescription ?? '',
      }
    }
    return saved
  }, [facebookDescription, facebookName, googleDescription, googleTitle, opentableDescription, opentableTitle])

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
      if (!previous.opentable_experience && existingSavedResults.opentable_experience) {
        next.opentable_experience = existingSavedResults.opentable_experience
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
    setIsGenerating(true)
    try {
      const response = await generateEventPromotionContent({
        eventId,
        contentType,
      })

      if (!response.success) {
        const errorMessage = response.error ?? 'Failed to generate content'
        const lowerCase = errorMessage.toLowerCase()
        if (lowerCase.includes('openai') && lowerCase.includes('configure')) {
          setAiUnavailableMessage('AI copy generation is disabled. Add an OpenAI API key on the settings page to enable it.')
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
        case 'opentable_experience':
          setResultsByType((previous) => ({ ...previous, opentable_experience: data.content as TitleDescriptionContent }))
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
    <Card padding="lg" className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">AI Event Copy Builder</h2>
        <p className="text-sm text-gray-500">
          Generate channel-specific event copy. Generated copy is not saved automatically.
        </p>
      </div>

      {brief && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Brief snapshot</p>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
            {brief}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="content_type" className="block text-sm font-medium text-gray-900">
          Content type
        </label>
        <Select
          id="content_type"
          value={contentType}
          onChange={(event) => setContentType(event.target.value as EventPromotionContentType)}
          fullWidth
        >
          {CONTENT_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Select>
        {selectedTypeMeta?.help && (
          <p className="text-xs text-gray-500">{selectedTypeMeta.help}</p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="cta_link_option" className="block text-sm font-medium text-gray-900">
          CTA link
        </label>
        {orderedDigitalLinks.length > 0 ? (
          <>
            <Select
              id="cta_link_option"
              value={ctaState.selectedLinkId}
              onChange={(event) =>
                setCtaStateByType((previous) => ({
                  ...previous,
                  [contentType]: { ...previous[contentType], selectedLinkId: event.target.value },
                }))
              }
              fullWidth
            >
              {orderedDigitalLinks.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.label} – {link.shortUrl}
                </option>
              ))}
              <option value="custom">Custom link…</option>
            </Select>
            <p className="text-xs text-gray-500">
              Defaults to the best-fit UTM link for this channel. The URL is not included in the generated copy.
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-500">
            No marketing links yet—refresh links above or enter a custom URL below.
          </p>
        )}
        {(ctaState.selectedLinkId === 'custom' || !orderedDigitalLinks.length) && (
          <Input
            id="cta_link_custom"
            value={ctaState.customUrl}
            onChange={(event) =>
              setCtaStateByType((previous) => ({
                ...previous,
                [contentType]: { ...previous[contentType], customUrl: event.target.value },
              }))
            }
            placeholder="https://..."
            fullWidth
            className="mt-2"
          />
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">CTA link (copy/paste)</p>
            <p className="mt-1 text-xs text-gray-500">{resolveCtaLabel(contentType)}</p>
            {selectedCtaUrl ? (
              <p className="mt-2 font-mono text-sm text-blue-700 break-all">{selectedCtaUrl}</p>
            ) : (
              <p className="mt-2 text-sm text-gray-600">Select a marketing link or enter a custom URL.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="secondary"
              disabled={!selectedCtaUrl}
              onClick={() => selectedCtaUrl && handleCopy(selectedCtaUrl, 'CTA link')}
              leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
            >
              Copy link
            </Button>
          </div>
        </div>
        {selectedMarketingLink && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded-full bg-white px-2 py-1">source: {selectedMarketingLink.utm.utm_source}</span>
            <span className="rounded-full bg-white px-2 py-1">medium: {selectedMarketingLink.utm.utm_medium}</span>
            <span className="rounded-full bg-white px-2 py-1">campaign: {selectedMarketingLink.utm.utm_campaign}</span>
            {selectedMarketingLink.utm.utm_content && (
              <span className="rounded-full bg-white px-2 py-1">content: {selectedMarketingLink.utm.utm_content}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          Generates fresh copy every time—run it again if you need a new angle.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleGenerate}
          disabled={isGenerating || Boolean(aiUnavailableMessage)}
          leftIcon={isGenerating ? <Spinner size="sm" color="gray" /> : <ArrowPathIcon className="h-4 w-4" />}
        >
          {isGenerating ? 'Working...' : `Generate ${selectedTypeMeta?.label ?? eventName} copy`}
        </Button>
      </div>

      {aiUnavailableMessage && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {aiUnavailableMessage}
        </div>
      )}

      {currentResult && (
        <div className="space-y-6">
          {contentType === 'facebook_event' ? (
            (() => {
              const content = currentResult as FacebookEventContent
              return (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Facebook Event</h3>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleCopy(`${content.name}\n\n${content.description}`.trim(), 'Facebook copy')}
                      leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                    >
                      Copy all
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Event name</p>
                        <Button
                          size="xs"
                          variant="ghost"
                          iconOnly
                          aria-label="Copy event name"
                          title="Copy event name"
                          disabled={content.name.trim().length === 0}
                          onClick={() => handleCopy(content.name.trim(), 'Event name')}
                          leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                        />
                      </div>
                      <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-900">
                        {content.name}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                          leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                        />
                      </div>
                      <Textarea
                        value={content.description}
                        readOnly
                        rows={8}
                        fullWidth
                      />
                    </div>
                  </div>
                </section>
              )
            })()
          ) : (
            (() => {
              const content = currentResult as TitleDescriptionContent
              const titleLabel = contentType === 'opentable_experience' ? 'OpenTable Experience' : 'Google Business Profile'
              const copyLabel = contentType === 'opentable_experience' ? 'OpenTable copy' : 'GBP copy'
              return (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{titleLabel}</h3>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleCopy(`${content.title}\n\n${content.description}`.trim(), copyLabel)}
                      leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                    >
                      Copy all
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Title</p>
                        <Button
                          size="xs"
                          variant="ghost"
                          iconOnly
                          aria-label="Copy title"
                          title="Copy title"
                          disabled={content.title.trim().length === 0}
                          onClick={() => handleCopy(content.title.trim(), 'Title')}
                          leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                        />
                      </div>
                      <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-900">
                        {content.title}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                          leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                        />
                      </div>
                      <Textarea
                        value={content.description}
                        readOnly
                        rows={contentType === 'opentable_experience' ? 10 : 8}
                        fullWidth
                      />
                    </div>
                  </div>
                </section>
              )
            })()
          )}
        </div>
      )}
    </Card>
  )
}
