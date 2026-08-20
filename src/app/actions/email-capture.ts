'use server'

/**
 * Staff-facing entry points for the email capture send.
 *
 * The send itself lives in lib/sms/email-capture.ts. This file exists to put the three
 * things a server action owes around it: a permission check, an audit row, and a shape the
 * UI can render. Bulk SMS has the widest blast radius in the app, and this one writes to
 * customer records as well, so none of those three is optional.
 */

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import {
  loadEmailCaptureAudience,
  sendEmailCaptureSms,
  type EmailCaptureSendResult,
} from '@/lib/sms/email-capture'

/**
 * Hard ceiling on one run, independent of whatever the caller asks for.
 *
 * The measured audience is 423. A cap a little above that lets the real send happen in one
 * go while making a runaway request obvious rather than expensive.
 */
const MAX_RECIPIENTS_PER_RUN = 500

export type EmailCapturePreview = {
  eligibleCount: number
  sampleMessages: string[]
  /** Warmest first, so staff can sanity-check that the ordering is doing what it claims. */
  sampleNames: string[]
}

export async function previewEmailCaptureSend(): Promise<
  { success: true; data: EmailCapturePreview } | { error: string }
> {
  const allowed = await checkUserPermission('messages', 'send_marketing')
  if (!allowed) return { error: 'Insufficient permissions to send messages' }

  try {
    const audience = await loadEmailCaptureAudience(MAX_RECIPIENTS_PER_RUN)
    const dry = await sendEmailCaptureSms({
      maxRecipients: Math.min(3, MAX_RECIPIENTS_PER_RUN),
      dryRun: true,
    })

    return {
      success: true,
      data: {
        eligibleCount: audience.length,
        sampleMessages: dry.preview,
        sampleNames: audience.slice(0, 5).map((row) => row.first_name || 'there'),
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to build the preview' }
  }
}

/**
 * Actually send.
 *
 * `confirmToken` is not security, it is a guard against a mis-click: the UI must echo back
 * the exact eligible count it showed the person clicking. If the audience moved between the
 * preview and the click, the send refuses rather than texting a number nobody approved.
 */
export async function runEmailCaptureSend(
  confirmedCount: number
): Promise<{ success: true; data: EmailCaptureSendResult } | { error: string }> {
  const allowed = await checkUserPermission('messages', 'send_marketing')
  if (!allowed) return { error: 'Insufficient permissions to send messages' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  let audienceSize: number
  try {
    audienceSize = (await loadEmailCaptureAudience(MAX_RECIPIENTS_PER_RUN)).length
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load the audience' }
  }

  if (audienceSize === 0) {
    return { error: 'Nobody is eligible right now, so there is nothing to send' }
  }

  if (audienceSize !== confirmedCount) {
    return {
      error:
        `The audience changed since you last looked: it was ${confirmedCount} and is now ` +
        `${audienceSize}. Refresh the preview and check it before sending.`,
    }
  }

  try {
    const result = await sendEmailCaptureSms({
      maxRecipients: MAX_RECIPIENTS_PER_RUN,
      dryRun: false,
      startTime: Date.now(),
    })

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'send',
      resource_type: 'email_capture_campaign',
      operation_status: 'success',
      additional_info: {
        audienceSize,
        sent: result.sent,
        errors: result.errors,
        aborted: result.aborted ?? false,
      },
    })

    return { success: true, data: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send'

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'send',
      resource_type: 'email_capture_campaign',
      operation_status: 'failure',
      error_message: message,
      additional_info: { audienceSize },
    })

    return { error: message }
  }
}
