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
 * Hard ceiling on one run, set BELOW the global SMS safety guard on purpose.
 *
 * lib/sms/safety.ts refuses every outbound SMS once 120 have gone out in the trailing hour
 * (SMS_SAFETY_GLOBAL_HOURLY_LIMIT, default 120), and no caller bypasses it. That ceiling is
 * real and has already truncated a live send: the peak rolling hour in April 2026 was exactly
 * 120. Asking for 423 in one go would therefore have sent 120 and had the rest refused.
 *
 * 100 leaves headroom for booking confirmations and reminders going out in the same hour,
 * which share the same budget. The audience shrinks as people are asked, so the operator runs
 * this once an hour until it reports nobody left.
 */
const MAX_RECIPIENTS_PER_RUN = 100

export type EmailCapturePreview = {
  /** Everyone still waiting to be asked, which may be more than one run can take. */
  eligibleCount: number
  /** How many this run would actually text, capped by MAX_RECIPIENTS_PER_RUN. */
  thisRunCount: number
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
    // 1000 is the function's own ceiling, so this counts everyone still waiting rather than
    // just the slice this run would take.
    const waiting = await loadEmailCaptureAudience(1000)
    const dry = await sendEmailCaptureSms({ maxRecipients: 3, dryRun: true })

    return {
      success: true,
      data: {
        eligibleCount: waiting.length,
        thisRunCount: Math.min(waiting.length, MAX_RECIPIENTS_PER_RUN),
        sampleMessages: dry.preview,
        sampleNames: waiting.slice(0, 5).map((row) => row.first_name || 'there'),
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
    audienceSize = (await loadEmailCaptureAudience(1000)).length
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load the audience' }
  }

  if (audienceSize === 0) {
    return { error: 'Nobody is eligible right now, so there is nothing to send' }
  }

  const thisRun = Math.min(audienceSize, MAX_RECIPIENTS_PER_RUN)

  if (thisRun !== confirmedCount) {
    return {
      error:
        `The audience changed since you last looked: this run was going to text ` +
        `${confirmedCount} and would now text ${thisRun}. Refresh the preview and check it ` +
        `before sending.`,
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
        requested: thisRun,
        sent: result.sent,
        errors: result.errors,
        aborted: result.aborted ?? false,
        rateLimited: result.rateLimited ?? false,
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
