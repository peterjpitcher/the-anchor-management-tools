'use client';

import { useState } from 'react';
import { Button, Input, Popover, toast, Icon } from '@/ds';

interface RotaFeedButtonProps {
  feedUrl: string;
  showCalendarSync?: boolean;
}

export default function RotaFeedButton({ feedUrl, showCalendarSync }: RotaFeedButtonProps) {
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);

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
      toast.error('Sync failed, check the logs');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      {showCalendarSync && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleSync}
          loading={syncing}
          icon={<Icon name="refresh" size={16} />}
        >
          {syncing ? 'Syncing…' : 'Sync Calendar'}
        </Button>
      )}

      {/* A Popover rather than a Dropdown: the panel holds a text field and a Copy button,
          which a menu cannot hold. Escape or a click outside closes it. */}
      <Popover
        align="right"
        trigger={
          <Button type="button" variant="secondary" size="sm" icon={<Icon name="calendar" size={16} />}>
            Subscribe
          </Button>
        }
      >
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-text-strong">Calendar Feed</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Subscribe to see all rota shifts in your calendar app. Rota changes appear within 24 hours of
              publishing (Google Calendar), or sooner in Apple Calendar and Outlook.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Input
                type="text"
                readOnly
                value={feedUrl}
                aria-label="Calendar feed address"
                className="h-btn-h-sm truncate bg-surface-2 text-xs text-text-muted"
                onFocus={e => e.target.select()}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleCopy}
              className="shrink-0"
              icon={copied
                ? <Icon name="check" size={14} className="text-success" />
                : <Icon name="copy" size={14} />}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-text-muted">How to subscribe:</p>
            <ul className="space-y-1 text-xs text-text-muted">
              <li><span className="font-medium text-text">Google Calendar</span>: Other calendars → From URL</li>
              <li><span className="font-medium text-text">Apple Calendar</span>: File → New Calendar Subscription</li>
              <li><span className="font-medium text-text">Outlook</span>: Add calendar → Subscribe from web</li>
            </ul>
          </div>
        </div>
      </Popover>
    </>
  );
}
