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
import { Alert, Badge, Button, Card, CardBody, CardHeader, FormFooter, Textarea } from '@/ds'
import { Select } from '@/ds'
import { ConfirmDialog } from '@/ds'
import { toast } from '@/ds'
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
    "The Anchor: Hi, it's been a while. Fancy a Sunday roast, a pint in the garden or a quiz night? Book at the-anchor.pub or call 01753 682707."
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
    <Card>
      <CardHeader
        title="Win-Back Campaign"
        subtitle="Send a targeted SMS to opted-in customers who haven't booked in a while"
        action={
          <div className="flex items-center gap-2">
            {lastResult !== null && (
              <Badge tone="success" size="sm">
                Last sent: {lastResult.sent}/{lastResult.count}
              </Badge>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? 'Hide' : 'Set Up Campaign'}
            </Button>
          </div>
        }
      />

      {/* Collapsible body */}
      {open && (
        <CardBody className="space-y-4">
          {/* Inactivity threshold */}
          <div className="max-w-xs">
            <Select
              label="Customers inactive for"
              value={inactiveMonths}
              onChange={(e) => handleMonthsChange(e.target.value)}
              options={INACTIVE_OPTIONS}
            />
          </div>

          {/* Message composer. The DS error slot prints the over-limit message under the field. */}
          <div>
            <Textarea
              id="win-back-message"
              label="SMS message"
              value={message}
              onChange={handleMessageChange}
              rows={4}
              maxLength={160}
              error={isOverLimit ? 'Message must be 160 characters or fewer.' : undefined}
              placeholder="Type your SMS message here…"
            />
            <p
              className={`mt-1 text-right text-xs ${isOverLimit ? 'text-danger-fg font-semibold' : 'text-text-muted'}`}
              aria-live="polite"
            >
              {charCount}/{MAX_CHARS}
            </p>
          </div>

          {/* Preview result */}
          {previewCount !== null && (
            <Alert tone="info" size="sm" role="status">
              This campaign will send to{' '}
              <strong>{previewCount} customer{previewCount === 1 ? '' : 's'}</strong>{' '}
              inactive for {inactiveMonths}+ months.
            </Alert>
          )}

          <FormFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={handlePreview}
              disabled={!canSend}
              loading={isPreviewing}
            >
              Preview
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => setConfirmOpen(true)}
              disabled={!canSend}
              loading={isSending}
            >
              Send Campaign
            </Button>
          </FormFooter>
        </CardBody>
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
    </Card>
  )
}
