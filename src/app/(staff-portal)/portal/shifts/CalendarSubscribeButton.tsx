'use client'

import { useState } from 'react'
import { CalendarDaysIcon, ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline'
import { Button, LinkButton } from '@/ds'

export default function CalendarSubscribeButton({ feedUrl }: { feedUrl: string }) {
  const [copied, setCopied] = useState(false)

  const webcalUrl = feedUrl.replace(/^https?:\/\//, 'webcal://')
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback — select the text if clipboard API unavailable
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-start gap-2">
        <CalendarDaysIcon className="h-4 w-4 text-text-subtle shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold text-text">Sync shifts to your calendar</p>
          <p className="text-xs text-text-muted">
            Pending and accepted shifts are included. Google Calendar can take several hours to update.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* A webcal:// address is not a local route, so next/link leaves it to the browser. */}
        <LinkButton href={webcalUrl} variant="primary" size="sm" icon={<CalendarDaysIcon />}>
          Apple / Outlook
        </LinkButton>
        <LinkButton href={googleUrl} target="_blank" rel="noopener noreferrer" variant="secondary" size="sm">
          Google Calendar
        </LinkButton>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleCopy}
          icon={copied
            ? <CheckIcon className="h-3.5 w-3.5 text-success" />
            : <ClipboardDocumentIcon className="h-3.5 w-3.5" />}
        >
          {copied ? <span className="text-success-fg">Copied!</span> : 'Copy link'}
        </Button>
      </div>
    </div>
  )
}
