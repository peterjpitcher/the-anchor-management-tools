'use client'

import { useState } from 'react'
import { CalendarDaysIcon, ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline'

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
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-start gap-2">
        <CalendarDaysIcon className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-gray-900">Sync shifts to your calendar</p>
          <p className="text-xs text-gray-500">
            Pending and accepted shifts are included. Google Calendar can take several hours to update.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={webcalUrl}
          className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700 transition-colors"
        >
          <CalendarDaysIcon className="h-3.5 w-3.5" />
          Apple / Outlook
        </a>
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Google Calendar
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {copied ? (
            <><CheckIcon className="h-3.5 w-3.5 text-green-600" /><span className="text-green-600">Copied!</span></>
          ) : (
            <><ClipboardDocumentIcon className="h-3.5 w-3.5" />Copy link</>
          )}
        </button>
      </div>
    </div>
  )
}
