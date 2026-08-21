'use client'

/**
 * One button that texts several hundred guests, so the whole screen is built around making
 * the person pressing it certain of what they are about to do.
 *
 * The preview is loaded before the button is usable, the exact message is shown, and the
 * count is echoed back to the server on send so a stale screen cannot approve a different
 * audience from the one it displayed.
 */

import { useCallback, useEffect, useState } from 'react'
import { PageLayout, Card, Button, Alert, Badge, ConfirmDialog, toast } from '@/ds'
import {
  previewEmailCaptureSend,
  runEmailCaptureSend,
  type EmailCapturePreview,
} from '@/app/actions/email-capture'

export default function EmailCaptureClient() {
  const [preview, setPreview] = useState<EmailCapturePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const response = await previewEmailCaptureSend()
    if ('error' in response) {
      setError(response.error)
      setPreview(null)
    } else {
      setPreview(response.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSend = async () => {
    if (!preview) return
    setConfirmOpen(false)
    setSending(true)
    setError(null)

    const response = await runEmailCaptureSend(preview.thisRunCount)
    setSending(false)

    if ('error' in response) {
      setError(response.error)
      toast.error('The send did not run')
      return
    }

    const { sent, errors, aborted, rateLimited } = response.data
    setResult(
      `Sent ${sent}${errors ? `, ${errors} failed` : ''}.` +
        (rateLimited
          ? ' The hourly SMS limit stopped the run. Everyone left is still on the list, so come back in an hour and run it again.'
          : '') +
        (aborted ? ' The run stopped on its time budget, so run it again to continue.' : '')
    )
    toast.success(`Sent ${sent} messages`)
    void load()
  }

  return (
    <PageLayout title="Ask for email addresses">
      <Card>
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Texts guests we can reach by SMS but have no email address for, with a one-tap
            link to add one. Everyone here has booked before.
          </p>
          <p className="text-sm text-gray-500">
            Each person is asked once. Anyone already texted is excluded automatically, so
            running this again will not reach them a second time.
          </p>
          <p className="text-sm text-gray-500">
            Sends go out in batches of up to 100 an hour, because the whole app shares an
            hourly SMS limit with booking confirmations and reminders. Run it again each hour
            until it says nobody is left.
          </p>
        </div>
      </Card>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {result ? <Alert variant="success">{result}</Alert> : null}

      <Card title="Who this would reach">
        {loading ? (
          <p className="text-sm text-gray-500">Working out who is eligible...</p>
        ) : preview ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge>{preview.thisRunCount}</Badge>
              <span className="text-sm text-gray-700">
                {preview.thisRunCount === 1 ? 'guest' : 'guests'} would be texted in this run
              </span>
            </div>

            {preview.eligibleCount > preview.thisRunCount ? (
              <Alert variant="info">
                {preview.eligibleCount} guests are waiting in total. This run takes the first{' '}
                {preview.thisRunCount}; the rest stay on the list for the next run.
              </Alert>
            ) : null}

            {preview.sampleNames.length > 0 ? (
              <p className="text-sm text-gray-500">
                Warmest first, starting with: {preview.sampleNames.join(', ')}
              </p>
            ) : null}

            {preview.sampleMessages.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-900">
                  Exactly what they will receive
                </p>
                {preview.sampleMessages.map((message, index) => (
                  <pre
                    key={index}
                    className="whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-gray-800"
                  >
                    {message}
                  </pre>
                ))}
                <p className="text-xs text-gray-500">
                  Shown exactly as the guest receives it, with the link already shortened.
                  Each guest gets their own single-use link in place of the example one.
                </p>
              </div>
            ) : null}

            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={sending || preview.thisRunCount === 0}
              >
                {sending ? 'Sending...' : `Send to ${preview.thisRunCount}`}
              </Button>
              <Button variant="secondary" onClick={() => void load()} disabled={sending}>
                Refresh
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleSend}
        title={`Text ${preview?.thisRunCount ?? 0} guests?`}
        message="This sends real text messages and cannot be undone. Each guest is asked only once, so there is no way to re-send to them later."
        confirmText="Send now"
      />
    </PageLayout>
  )
}
