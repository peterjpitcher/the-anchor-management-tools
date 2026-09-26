'use client'

import { useState } from 'react'
import { Button, Card, CardBody, CardHeader, LinkButton, Icon } from '@/ds'

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
      // fallback: select the text if clipboard API unavailable
    }
  }

  return (
    <Card>
      <CardHeader title="Sync Shifts to Your Calendar" />
      <CardBody className="space-y-3">
        <p className="text-xs text-text-muted">
          Pending and accepted shifts are included. Google Calendar can take several hours to update.
        </p>
        <div className="flex flex-wrap gap-2">
          {/* A webcal:// address is not a local route, so next/link leaves it to the browser. */}
          <LinkButton href={webcalUrl} variant="primary" size="sm" icon={<Icon name="calendar" size={16} />}>
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
              ? <Icon name="check" size={14} className="text-success" />
              : <Icon name="copy" size={14} />}
          >
            {copied ? <span className="text-success-fg">Copied!</span> : 'Copy Link'}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
