'use client'

/**
 * WinBackCampaign
 *
 * Collapsible card that lets managers send a targeted bulk SMS to customers
 * who haven't booked in a chosen number of months.
 *
 * Workflow:
 *  1. Manager picks an inactivity threshold (3 / 6 / 12 months).
 *  2. Manager types a message (max 160 chars).
 *  3. "Preview" dry-run shows how many eligible customers will be reached.
 *  4. "Send Campaign" confirms via ConfirmDialog then dispatches.
 */

import { useState, useTransition } from 'react'
import { MegaphoneIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui-v2/forms/Button'
import { Select } from '@/components/ui-v2/forms/Select'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { sendWinBackCampaign } from '@/app/actions/customers'

const INACTIVE_OPTIONS = [
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
]

const MAX_CHARS = 160

export function WinBackCampaign() {
  const [open, setOpen] = useState(false)
  const [inactiveMonths, setInactiveMonths] = useState('6')
  const [message, setMessage] = useState(
    "The Anchor: Hi there, we miss you! It's been a while — come back and visit us soon. Call 01753 682707 or book at the-anchor.pub"
  )
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [lastResult, setLastResult] = useState<{ sent: number; count: number } | null>(null)

  const [isPreviewing, startPreviewTransition] = useTransition()
  const [isSending, startSendTransition] = useTransition()

  function handleMessageChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setMessage(e.target.value)
    // Clear stale preview when the message changes
    setPreviewCount(null)
  }

  function handleMonthsChange(value: string) {
    setInactiveMonths(value)
    setPreviewCount(null)
  }

  function handlePreview() {
    startPreviewTransition(async () => {
      const result = await sendWinBackCampaign({
        inactiveSinceMonths: Number(inactiveMonths),
        message,
        dryRun: true,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setPreviewCount(result.count ?? 0)
    })
  }

  function handleSendConfirmed() {
    setConfirmOpen(false)
    startSendTransition(async () => {
      const result = await sendWinBackCampaign({
        inactiveSinceMonths: Number(inactiveMonths),
        message,
        dryRun: false,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setLastResult({ sent: result.sent ?? 0, count: result.count ?? 0 })
      setPreviewCount(null)
      toast.success(`Campaign sent to ${result.sent ?? 0} customer${result.sent === 1 ? '' : 's'}`)
    })
  }

  const charCount = message.length
  const isOverLimit = charCount > MAX_CHARS
  const trimmedMessage = message.trim()
  const canSend = trimmedMessage.length > 0 && !isOverLimit && !isSending && !isPreviewing

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <MegaphoneIcon className="h-5 w-5 text-blue-600" aria-hidden="true" />
          <span className="text-sm font-semibold text-gray-900">Win-Back Campaign</span>
          {lastResult !== null && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Last sent: {lastResult.sent}/{lastResult.count}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUpIcon className="h-4 w-4 text-gray-500" aria-hidden="true" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 text-gray-500" aria-hidden="true" />
        )}
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">
          <p className="text-sm text-gray-600">
            Send a targeted SMS to opted-in customers who haven&apos;t booked in a while.
          </p>

          {/* Inactivity threshold */}
          <div className="max-w-xs">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customers inactive for
            </label>
            <Select
              value={inactiveMonths}
              onChange={(e) => handleMonthsChange(e.target.value)}
              options={INACTIVE_OPTIONS}
            />
          </div>

          {/* Message composer */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">
                SMS message
              </label>
              <span
                className={`text-xs ${isOverLimit ? 'text-red-600 font-semibold' : 'text-gray-500'}`}
              >
                {charCount}/{MAX_CHARS}
              </span>
            </div>
            <textarea
              value={message}
              onChange={handleMessageChange}
              rows={4}
              maxLength={160}
              className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isOverLimit
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-gray-300'
              }`}
              placeholder="Type your SMS message here…"
            />
            {isOverLimit && (
              <p className="mt-1 text-xs text-red-600">
                Message must be 160 characters or fewer.
              </p>
            )}
          </div>

          {/* Preview result */}
          {previewCount !== null && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              This campaign will send to{' '}
              <strong>{previewCount} customer{previewCount === 1 ? '' : 's'}</strong>{' '}
              inactive for {inactiveMonths}+ months.
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handlePreview}
              disabled={!canSend}
              loading={isPreviewing}
            >
              Preview
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={!canSend}
              loading={isSending}
            >
              Send Campaign
            </Button>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleSendConfirmed}
        title="Send Win-Back Campaign?"
        message={
          previewCount !== null
            ? `This will send an SMS to ${previewCount} opted-in customer${previewCount === 1 ? '' : 's'} who have not booked in the last ${inactiveMonths} months. This action cannot be undone.`
            : `This will send an SMS to all opted-in customers inactive for ${inactiveMonths}+ months. Run a preview first to see the count.`
        }
        confirmText="Send Campaign"
        type="warning"
      />
    </div>
  )
}
