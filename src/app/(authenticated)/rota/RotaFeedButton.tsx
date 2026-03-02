'use client';

import { useState } from 'react';
import { CalendarDaysIcon, ClipboardDocumentIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function RotaFeedButton({ feedUrl }: { feedUrl: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <CalendarDaysIcon className="h-4 w-4" />
        Subscribe
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Popover */}
          <div className="absolute right-0 top-full mt-2 z-50 w-96 bg-white border border-gray-200 rounded-xl shadow-lg p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Calendar feed</p>
                <p className="text-xs text-gray-500 mt-0.5">Subscribe to see all rota shifts in your calendar app. The feed updates automatically.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded shrink-0 ml-2"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={feedUrl}
                className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50 text-gray-600 truncate focus:outline-none"
                onFocus={e => e.target.select()}
              />
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {copied
                  ? <><CheckIcon className="h-3.5 w-3.5 text-green-600" />Copied</>
                  : <><ClipboardDocumentIcon className="h-3.5 w-3.5" />Copy</>
                }
              </button>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
              <p className="text-xs font-medium text-gray-600">How to subscribe:</p>
              <ul className="text-xs text-gray-500 space-y-1">
                <li><span className="font-medium text-gray-700">Google Calendar</span> — Other calendars → From URL</li>
                <li><span className="font-medium text-gray-700">Apple Calendar</span> — File → New Calendar Subscription</li>
                <li><span className="font-medium text-gray-700">Outlook</span> — Add calendar → Subscribe from web</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
