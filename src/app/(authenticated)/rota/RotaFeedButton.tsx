'use client';

import { useState, useEffect, useRef } from 'react';
import { CalendarDaysIcon, ClipboardDocumentIcon, CheckIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

interface RotaFeedButtonProps {
  feedUrl: string;
  showCalendarSync?: boolean;
}

export default function RotaFeedButton({ feedUrl, showCalendarSync }: RotaFeedButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (open && popoverRef.current) {
      const firstFocusable = popoverRef.current.querySelector<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    }
  }, [open]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/rota/resync-calendar', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        const parts = [`Synced ${result.weeksSynced} ${result.weeksSynced === 1 ? 'week' : 'weeks'}`];
        if (result.totalCreated > 0) parts.push(`${result.totalCreated} created`);
        if (result.totalUpdated > 0) parts.push(`${result.totalUpdated} updated`);
        if (result.totalFailed > 0) parts.push(`${result.totalFailed} failed`);
        toast.success(parts.join(' · '));
      } else {
        toast.error(result.error || 'Sync failed');
      }
    } catch {
      toast.error('Sync failed — check logs');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="relative flex items-center gap-2">
      {showCalendarSync && (
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <ArrowPathIcon className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync calendar'}
        </button>
      )}

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
          <div ref={popoverRef} role="dialog" aria-modal="true" className="absolute right-0 top-full mt-2 z-50 w-96 bg-white border border-gray-200 rounded-xl shadow-lg p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Calendar feed</p>
                <p className="text-xs text-gray-500 mt-0.5">Subscribe to see all rota shifts in your calendar app. Rota changes appear within 24 hours of publishing (Google Calendar), or sooner in Apple Calendar and Outlook.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close calendar feed popover"
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
