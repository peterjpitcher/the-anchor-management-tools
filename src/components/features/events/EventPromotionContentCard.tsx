'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui-v2/layout/Card'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { ClipboardDocumentIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { generateEventPromotionContent } from '@/app/actions/event-content'
import { Select } from '@/components/ui-v2/forms/Select'
import type { EventMarketingLink } from '@/app/actions/event-marketing-links'

type PromotionContent = {
  facebook: {
    name: string
    storyParagraphs: string[]
    bulletPoints: string[]
    cta: string
    plainText: string
  }
  googleBusinessProfile: {
    title: string
    description: string
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

  const [selectedLinkId, setSelectedLinkId] = useState<string>('')
  const [customUrl, setCustomUrl] = useState(initialTicketUrl ?? '')
  const [isGenerating, setIsGenerating] = useState(false)
  const [result, setResult] = useState<PromotionContent | null>(null)
  const [aiUnavailableMessage, setAiUnavailableMessage] = useState<string | null>(null)

  const existingContent = useMemo<PromotionContent | null>(() => {
    if (!facebookName && !facebookDescription && !googleTitle && !googleDescription) {
      return null
    }

    return {
      facebook: {
        name: facebookName ?? '',
        storyParagraphs: facebookDescription ? [facebookDescription] : [],
        bulletPoints: [],
        cta: '',
        plainText: facebookDescription ?? '',
      },
      googleBusinessProfile: {
        title: googleTitle ?? '',
        description: googleDescription ?? '',
      },
    }
  }, [facebookName, facebookDescription, googleTitle, googleDescription])

  useEffect(() => {
    if (!result && existingContent) {
      setResult(existingContent)
    }
  }, [existingContent, result])

  useEffect(() => {
    if (!digitalLinks.length && !selectedLinkId) {
      setSelectedLinkId('custom')
      return
    }

    const ids = new Set(digitalLinks.map((link) => link.id))
    if (selectedLinkId && (selectedLinkId === 'custom' || ids.has(selectedLinkId))) {
      return
    }

    if (initialTicketUrl) {
      const matchingLink = digitalLinks.find(
        (link) =>
          link.shortUrl === initialTicketUrl ||
          link.destinationUrl === initialTicketUrl
      )
      if (matchingLink) {
        setSelectedLinkId(matchingLink.id)
        return
      }
      setSelectedLinkId('custom')
      setCustomUrl(initialTicketUrl)
      return
    }

    if (digitalLinks[0]) {
      setSelectedLinkId(digitalLinks[0].id)
      return
    }

    setSelectedLinkId('custom')
  }, [digitalLinks, initialTicketUrl, selectedLinkId])

  const handleGenerate = async () => {
    let ticketUrl: string | null = null
    if (selectedLinkId === 'custom') {
      ticketUrl = customUrl.trim() ? customUrl.trim() : null
    } else {
      const chosen = digitalLinks.find((link) => link.id === selectedLinkId)
      ticketUrl = chosen?.shortUrl ?? null
    }

    setIsGenerating(true)
    try {
      const response = await generateEventPromotionContent({
        eventId,
        ticketUrl,
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

      setResult(response.data)
      toast.success('Promotional copy ready')
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

  return (
    <Card padding="lg" className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">AI Event Copy Builder</h2>
        <p className="text-sm text-gray-500">
          Draft high-converting Facebook and Google Business Profile content using your saved brief.
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
        <label htmlFor="ticket_link_option" className="block text-sm font-medium text-gray-900">
          Ticket link to promote
        </label>
        {digitalLinks.length > 0 ? (
          <>
            <Select
              id="ticket_link_option"
              value={selectedLinkId}
              onChange={(event) => setSelectedLinkId(event.target.value)}
              fullWidth
            >
              {digitalLinks.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.label} – {link.shortUrl}
                </option>
              ))}
              <option value="custom">Custom link…</option>
            </Select>
            <p className="text-xs text-gray-500">
              Choose from your generated digital links or switch to a custom URL.
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-500">
            No marketing links yet—add one or enter a custom URL below.
          </p>
        )}
        {(selectedLinkId === 'custom' || !digitalLinks.length) && (
          <Input
            id="ticket_link_custom"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://..."
            fullWidth
            className="mt-2"
          />
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
          {isGenerating ? 'Working...' : `Generate for ${eventName}`}
        </Button>
      </div>

      {aiUnavailableMessage && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {aiUnavailableMessage}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Facebook Event</h3>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => handleCopy(`${result.facebook.name}\n\n${result.facebook.plainText}`, 'Facebook copy')}
                leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
              >
                Copy all
              </Button>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Event name</p>
                <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-900">
                  {result.facebook.name}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Description preview</p>
                <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-900">
                  {result.facebook.storyParagraphs.map((paragraph, index) => (
                    <p key={`story-${index}`}>{paragraph}</p>
                  ))}
                  {result.facebook.bulletPoints.length > 0 && (
                    <div>
                      <p className="font-semibold text-gray-700">Need to Know:</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {result.facebook.bulletPoints.map((point, index) => (
                          <li key={`bullet-${index}`}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.facebook.cta && (
                    <p className="font-semibold text-blue-600">{result.facebook.cta}</p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Copy-friendly text</p>
                <Textarea
                  value={result.facebook.plainText}
                  readOnly
                  rows={6}
                  fullWidth
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Google Business Profile</h3>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => handleCopy(`${result.googleBusinessProfile.title}\n\n${result.googleBusinessProfile.description}`, 'GBP copy')}
                leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
              >
                Copy all
              </Button>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Title</p>
                <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-900">
                  {result.googleBusinessProfile.title}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Description</p>
                <Textarea
                  value={result.googleBusinessProfile.description}
                  readOnly
                  rows={6}
                  fullWidth
                />
              </div>
            </div>
          </section>
        </div>
      )}
    </Card>
  )
}
