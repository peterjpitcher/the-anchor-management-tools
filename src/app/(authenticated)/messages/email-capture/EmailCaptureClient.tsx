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
import {
  PageLayout,
  PageLoading,
  Card,
  CardBody,
  CardHeader,
  Button,
  Alert,
  Badge,
  ConfirmDialog,
  Empty,
  FormFooter,
  SubHeading,
  toast,
} from '@/ds'
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

    const { sent, errors, aborted, stoppedBy, failureCodes } = response.data

    // Reasons in plain words. Anything not listed is shown as its raw code rather than
    // swallowed, because a failure nobody can name is a failure nobody can fix.
    const REASONS: Record<string, string> = {
      global_rate_limit: 'the hourly SMS limit was reached',
      safety_unavailable: 'the SMS safety check could not run',
      recipient_hourly_limit: 'they had already had several texts this hour',
      recipient_daily_limit: 'they had already had several texts today',
    }
    const describe = (code: string) => REASONS[code] ?? `code ${code}`

    const breakdown = Object.entries(failureCodes ?? {})
      .map(([code, n]) => `${n} because ${describe(code)}`)
      .join(', ')

    setResult(
      `Sent ${sent}${errors ? `, ${errors} failed` : ''}.` +
        (breakdown ? ` Failures: ${breakdown}.` : '') +
        (stoppedBy
          ? ` The run stopped early because ${describe(stoppedBy)}. Everyone left is still on the list, so run it again later.`
          : '') +
        (aborted ? ' The run stopped on its time budget, so run it again to continue.' : '')
    )
    toast.success(`Sent ${sent} messages`)
    void load()
  }

  // Not linked from the Messages menu by owner decision: staff reach it by its address.
  return (
    <PageLayout
      title="Ask for Email Addresses"
      backButton={{ label: 'Back to Messages', href: '/messages' }}
      headerActions={
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading} disabled={sending}>
          Refresh
        </Button>
      }
    >
      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm text-text">
            Texts guests we can reach by SMS but have no email address for, with a one-tap
            link to add one. Everyone here has booked before.
          </p>
          <p className="text-sm text-text-muted">
            Each person is asked once. Anyone already texted is excluded automatically, so
            running this again will not reach them a second time.
          </p>
          <p className="text-sm text-text-muted">
            Sends go out in batches of up to 100 an hour, because the whole app shares an
            hourly SMS limit with booking confirmations and reminders. Run it again each hour
            until it says nobody is left.
          </p>
        </CardBody>
      </Card>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {result ? <Alert tone="success">{result}</Alert> : null}

      <Card>
        <CardHeader title="Who This Would Reach" />
        <CardBody>
          {loading ? (
            <PageLoading inline label="Working out who is eligible" />
          ) : preview ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Badge>{preview.thisRunCount}</Badge>
                <span className="text-sm text-text">
                  {preview.thisRunCount === 1 ? 'guest' : 'guests'} would be texted in this run
                </span>
              </div>

              {preview.eligibleCount > preview.thisRunCount ? (
                <Alert tone="info">
                  {preview.eligibleCount} guests are waiting in total. This run takes the first{' '}
                  {preview.thisRunCount}; the rest stay on the list for the next run.
                </Alert>
              ) : null}

              {preview.sampleNames.length > 0 ? (
                <p className="text-sm text-text-muted">
                  Warmest first, starting with: {preview.sampleNames.join(', ')}
                </p>
              ) : null}

              {preview.sampleMessages.length > 0 ? (
                <div className="space-y-2">
                  <SubHeading>Exactly What They Will Receive</SubHeading>
                  {preview.sampleMessages.map((message, index) => (
                    <pre
                      key={index}
                      className="whitespace-pre-wrap rounded-default bg-surface-2 p-3 text-sm text-text"
                    >
                      {message}
                    </pre>
                  ))}
                  <p className="text-xs text-text-muted">
                    Shown exactly as the guest receives it, with the link already shortened.
                    Each guest gets their own single-use link in place of the example one.
                  </p>
                </div>
              ) : null}

              <FormFooter>
                <Button
                  variant="primary"
                  onClick={() => setConfirmOpen(true)}
                  disabled={preview.thisRunCount === 0}
                  loading={sending}
                >
                  {`Send to ${preview.thisRunCount}`}
                </Button>
              </FormFooter>
            </div>
          ) : (
            // A failed preview is reported in the Alert above, so the card says why it is empty.
            <Empty size="sm" title="No preview to show" description="Use Refresh to try again." />
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleSend}
        title={`Text ${preview?.thisRunCount ?? 0} Guests`}
        message="This sends real text messages and cannot be undone. Each guest is asked only once, so there is no way to re-send to them later."
        confirmLabel="Send Now"
        tone="primary"
      />
    </PageLayout>
  )
}
