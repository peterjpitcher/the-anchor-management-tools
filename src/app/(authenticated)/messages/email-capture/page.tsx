import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import EmailCaptureClient from './EmailCaptureClient'

export const metadata = {
  title: 'Ask for email addresses | The Anchor',
}

/**
 * Server actions inherit the hosting route segment's limit, and the default killed a real run.
 *
 * Measured on the live send of 2026-08-21: 16 messages went out in 13.3 seconds, about 0.83s
 * each (safety checks, link shortening, the Twilio call and outbound logging), and the run
 * then died around the 15 second mark with no audit row written. That is the platform default.
 * A full batch of 100 needs roughly 85 seconds.
 *
 * 300 is the ceiling the rest of this app already uses for long jobs (see the receipts and
 * invoices exports). sendEmailCaptureSms keeps its own 240 second budget so it stops itself
 * cleanly, with an audit row and a report, well before the platform pulls the plug.
 */
export const maxDuration = 300

export default async function EmailCapturePage() {
  const canSendMessages = await checkUserPermission('messages', 'send_marketing')
  if (!canSendMessages) {
    redirect('/unauthorized')
  }

  return <EmailCaptureClient />
}
