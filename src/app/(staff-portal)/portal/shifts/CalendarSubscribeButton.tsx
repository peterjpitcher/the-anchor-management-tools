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
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarDaysIcon className="h-5 w-5 text-gray-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-gray-900">Sync shifts to your calendar</p>
          <p className="text-xs text-gray-500">Subscribe to keep your calendar automatically up to date when the rota changes.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={webcalUrl}
          className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 transition-colors"
        >
          <CalendarDaysIcon className="h-3.5 w-3.5" />
          Subscribe (Apple / Outlook)
        </a>
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Add to Google Calendar
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
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
