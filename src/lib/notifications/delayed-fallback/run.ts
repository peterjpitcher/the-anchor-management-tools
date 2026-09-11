import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { reportCronFailure } from '@/lib/cron/alerting'
import { sendSMS } from '@/lib/twilio'
import { AuditService } from '@/services/audit'
import { recordNotificationAttempt, updateNotificationDelivery } from '@/lib/notifications/delivery-ledger'
import { findDelayedFallbackRenderer } from '@/lib/notifications/delayed-fallback/renderers'
import type {
  DelayedFallbackDelivery,
  DelayedFallbackRender,
  DelayedFallbackRenderer,
  FallbackBookingRef,
  FallbackSkipCheck,
} from '@/lib/notifications/delayed-fallback/types'

type AdminClient = ReturnType<typeof createAdminClient>

const DELIVERY_COLUMNS =
  'id, customer_id, template_key, category, delayed_fallback_allowed, delayed_fallback_sent_at, selected_channel, final_status, metadata, created_at'

export type DelayedFallbackOutcome =
  | { outcome: 'skipped'; reason: string; deliveryId: string }
  | { outcome: 'sent'; deliveryId: string; scheduledFor: string | null }
  | { outcome: 'failed'; reason: string; deliveryId: string }

/** Why a text was not sent, as staff read it on the booking timeline and the undelivered list. */
const REASON_TEXT: Record<string, string> = {
  booking_cancelled: 'the booking has been cancelled since',
  booking_no_longer_cancelled: 'the booking is no longer cancelled',
  booking_past: 'the booking has already started',
  booking_changed: 'the booking details have changed since the email was sent',
  no_renderer: 'this kind of message cannot be rebuilt as a text',
  no_sms_channel: 'the guest has no mobile number we can text',
  sms_failed: 'the text could not be sent',
  booking_missing: 'the booking could not be found',
  render_failed: 'the text could not be rebuilt',
  customer_missing: "the guest's customer record could not be found",
  facts_missing: 'the details the email stated were not recorded with it',
  link_not_found: 'the link in the email could not be found again, and a new one is never made for a text',
  link_expired: 'the link in the email has expired or has already been used',
  link_not_rebuildable: 'the link in the email was not a short link, so it cannot be rebuilt safely',
}

function reasonText(reason: string): string {
  return REASON_TEXT[reason] ?? reason.replace(/_/g, ' ')
}

function errorFields(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return { code: record.code ?? null, message: record.message ?? null, details: record.details ?? null, hint: record.hint ?? null }
  }
  return { message: String(error) }
}

/** Money may be stored as 250 or "250.00"; both are the same fact. Dates and text compare as written. */
function normaliseFact(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : ''
  const text = String(value).trim()
  if (/^-?\d+(\.\d+)?$/.test(text)) return String(Math.round(Number(text) * 100) / 100)
  return text
}

/**
 * The rules that decide whether a rebuilt text is still true. Kept here, not in each renderer, so
 * every booking type is held to the same test.
 */
export function evaluateFallbackSkip(
  render: FallbackSkipCheck,
  storedFacts: unknown,
  now: Date
): string | null {
  const cancelled = render.booking.status === 'cancelled'
  if (render.expectCancelled) {
    if (!cancelled) return 'booking_no_longer_cancelled'
  } else if (cancelled) {
    return 'booking_cancelled'
  }

  if (!render.expectPast && render.booking.startsAt) {
    const startsAtMs = Date.parse(render.booking.startsAt)
    if (Number.isFinite(startsAtMs) && startsAtMs <= now.getTime()) {
      return 'booking_past'
    }
  }

  if (storedFacts && typeof storedFacts === 'object' && !Array.isArray(storedFacts)) {
    for (const [key, value] of Object.entries(storedFacts as Record<string, unknown>)) {
      if (!(key in render.booking.facts)) continue
      if (normaliseFact(render.booking.facts[key]) !== normaliseFact(value)) {
        return 'booking_changed'
      }
    }
  }

  return null
}

async function nextAttemptOrder(client: AdminClient, deliveryId: string): Promise<number> {
  try {
    const { data } = await (client.from('notification_attempts') as any)
      .select('attempt_order')
      .eq('delivery_id', deliveryId)
      .order('attempt_order', { ascending: false })
      .limit(1)
    const last = Number(data?.[0]?.attempt_order)
    return Number.isFinite(last) ? last + 1 : 2
  } catch {
    return 2
  }
}

function bookingRefFromMetadata(metadata: Record<string, unknown> | null): FallbackBookingRef | null {
  const privateBookingId = metadata?.private_booking_id
  if (typeof privateBookingId === 'string' && privateBookingId) return { type: 'private_booking', id: privateBookingId }
  const tableBookingId = metadata?.table_booking_id
  if (typeof tableBookingId === 'string' && tableBookingId) return { type: 'table_booking', id: tableBookingId }
  return null
}

/**
 * One audit row per outcome, on the record staff already read for that booking: the private
 * booking timeline, or the audit log for table bookings and anything unlinked.
 */
async function writeBookingAudit(input: {
  client: AdminClient
  booking: FallbackBookingRef | null
  deliveryId: string
  templateKey: string
  outcome: 'sent' | 'skipped' | 'failed'
  reason?: string
  error?: string | null
  sms?: { to: string; body: string; sid: string | null } | null
}): Promise<void> {
  const description =
    input.outcome === 'sent'
      ? 'The email bounced, so the message was sent by text instead.'
      : input.outcome === 'skipped'
        ? `The email bounced. No text was sent because ${reasonText(input.reason ?? '')}.`
        : `The email bounced and the text fallback failed: ${reasonText(input.reason ?? '')}.`

  try {
    if (input.booking?.type === 'private_booking') {
      const action = input.outcome === 'sent' ? 'sms_sent' : input.outcome === 'skipped' ? 'email_bounced' : 'message_undelivered'
      const { error } = await (input.client.from('private_booking_audit') as any).insert({
        booking_id: input.booking.id,
        action,
        field_name: input.outcome === 'sent' ? 'sms' : 'email',
        new_value: input.templateKey,
        metadata: {
          description,
          source: 'email_bounce_fallback',
          delivery_id: input.deliveryId,
          reason: input.reason ?? null,
          error: input.error ?? null,
          ...(input.sms ? { message: input.sms.body, recipient: input.sms.to, sid: input.sms.sid } : {}),
        },
        performed_by: null,
      })
      if (error) {
        logger.error('Delayed fallback: private booking audit row not written', {
          metadata: { deliveryId: input.deliveryId, ...errorFields(error) },
        })
      }
      return
    }

    await AuditService.logAuditEvent({
      operation_type:
        input.outcome === 'sent'
          ? 'notification.bounce_fallback_sent'
          : input.outcome === 'skipped'
            ? 'notification.bounce_fallback_skipped'
            : 'table_booking.notification_failed',
      resource_type: input.booking?.type ?? 'notification_delivery',
      resource_id: input.booking?.id ?? input.deliveryId,
      operation_status: input.outcome === 'failed' ? 'failure' : 'success',
      error_message: input.outcome === 'failed' ? description : undefined,
      additional_info: {
        comm_type: input.templateKey,
        delivery_id: input.deliveryId,
        reason: input.reason ?? null,
        description,
      },
    })
  } catch (error) {
    logger.error('Delayed fallback: audit row failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { deliveryId: input.deliveryId },
    })
  }
}

async function recordSkipped(input: {
  client: AdminClient
  delivery: DelayedFallbackDelivery
  booking: FallbackBookingRef | null
  reason: string
  nowIso: string
}): Promise<DelayedFallbackOutcome> {
  await updateNotificationDelivery({
    client: input.client,
    deliveryId: input.delivery.id,
    finalStatus: 'bounced',
    metadata: {
      ...(input.delivery.metadata ?? {}),
      delayed_fallback: { outcome: 'skipped', reason: input.reason, at: input.nowIso },
    },
  })
  await writeBookingAudit({
    client: input.client,
    booking: input.booking,
    deliveryId: input.delivery.id,
    templateKey: input.delivery.template_key,
    outcome: 'skipped',
    reason: input.reason,
  })
  return { outcome: 'skipped', reason: input.reason, deliveryId: input.delivery.id }
}

async function recordFailed(input: {
  client: AdminClient
  delivery: DelayedFallbackDelivery
  booking: FallbackBookingRef | null
  reason: string
  error?: string | null
  nowIso: string
}): Promise<DelayedFallbackOutcome> {
  await updateNotificationDelivery({
    client: input.client,
    deliveryId: input.delivery.id,
    finalStatus: 'failed',
    metadata: {
      ...(input.delivery.metadata ?? {}),
      undelivered_reason: input.reason,
      delayed_fallback: { outcome: 'failed', reason: input.reason, error: input.error ?? null, at: input.nowIso },
    },
  })
  await writeBookingAudit({
    client: input.client,
    booking: input.booking,
    deliveryId: input.delivery.id,
    templateKey: input.delivery.template_key,
    outcome: 'failed',
    reason: input.reason,
    error: input.error ?? null,
  })
  try {
    await reportCronFailure('notification-delayed-fallback', new Error(`Guest message undelivered: ${reasonText(input.reason)}`), {
      delivery_id: input.delivery.id,
      template_key: input.delivery.template_key,
      booking_type: input.booking?.type ?? null,
      booking_id: input.booking?.id ?? null,
      reason: input.reason,
      error: input.error ?? null,
      outcome: 'The email bounced and no text reached the guest. It is listed under Settings, SMS failures, Undelivered guest messages.',
    })
  } catch (alertError) {
    logger.error('Delayed fallback: staff alert failed', {
      error: alertError instanceof Error ? alertError : new Error(String(alertError)),
      metadata: { deliveryId: input.delivery.id },
    })
  }
  return { outcome: 'failed', reason: input.reason, deliveryId: input.delivery.id }
}

/**
 * The `notification_delayed_fallback` job (P4, flag `bounce_sms_fallback`).
 *
 * 1. Claims the delivery with one conditional update on `delayed_fallback_sent_at`, so a second
 *    job for the same delivery, or a retry of this one, does nothing.
 * 2. Rebuilds the text from the live booking through the renderer for its template key. No copy
 *    of the text is stored anywhere new.
 * 3. Sends nothing when the booking has been cancelled, has started, or has changed since the email.
 * 4. Sends through `sendSMS`, so duplicate protection, quiet hours and the rate limits all apply.
 * 5. With no number, no renderer or a failed send: marks the delivery failed, writes an audit row
 *    on the booking and alerts staff.
 *
 * A turned-off flag stops the job before the claim, so switching the flag off is a clean rollback.
 */
export async function runDelayedFallbackJob(
  payload: { deliveryId?: unknown },
  deps: { renderers?: DelayedFallbackRenderer[]; now?: () => Date } = {}
): Promise<DelayedFallbackOutcome> {
  const deliveryId = typeof payload.deliveryId === 'string' ? payload.deliveryId : ''
  if (!deliveryId) {
    throw new Error('notification_delayed_fallback job blocked: missing deliveryId')
  }

  if (!(await isMessagingFlagOn('bounce_sms_fallback'))) {
    return { outcome: 'skipped', reason: 'flag_off', deliveryId }
  }

  const client = createAdminClient()
  const now = deps.now?.() ?? new Date()
  const nowIso = now.toISOString()

  const { data: loaded, error: loadError } = await (client.from('notification_deliveries') as any)
    .select(DELIVERY_COLUMNS)
    .eq('id', deliveryId)
    .maybeSingle()

  if (loadError) {
    // Nothing has been claimed or sent yet, so a retry is safe.
    throw new Error(`Failed to load delivery ${deliveryId}: ${loadError.message}`)
  }

  const delivery = loaded as DelayedFallbackDelivery | null
  if (!delivery) {
    return { outcome: 'skipped', reason: 'delivery_missing', deliveryId }
  }

  if (delivery.category !== 'transactional' || delivery.delayed_fallback_allowed !== true) {
    return { outcome: 'skipped', reason: 'not_eligible', deliveryId }
  }

  if (delivery.delayed_fallback_sent_at) {
    return { outcome: 'skipped', reason: 'already_handled', deliveryId }
  }

  const { data: claimed, error: claimError } = await (client.from('notification_deliveries') as any)
    .update({ delayed_fallback_sent_at: nowIso })
    .eq('id', deliveryId)
    .is('delayed_fallback_sent_at', null)
    .select('id')
    .maybeSingle()

  if (claimError) {
    throw new Error(`Failed to claim delivery ${deliveryId}: ${claimError.message}`)
  }
  if (!claimed) {
    return { outcome: 'skipped', reason: 'already_handled', deliveryId }
  }

  const metadataBooking = bookingRefFromMetadata(delivery.metadata)
  const renderer = findDelayedFallbackRenderer(delivery.template_key, deps.renderers)
  if (!renderer) {
    return recordFailed({ client, delivery, booking: metadataBooking, reason: 'no_renderer', nowIso })
  }

  let render: DelayedFallbackRender
  try {
    render = await renderer.render({ delivery, client, now })
  } catch (error) {
    logger.error('Delayed fallback: renderer threw', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { deliveryId, templateKey: delivery.template_key },
    })
    return recordFailed({
      client,
      delivery,
      booking: metadataBooking,
      reason: 'render_failed',
      error: error instanceof Error ? error.message : String(error),
      nowIso,
    })
  }

  if (render.kind === 'unavailable') {
    // The same skip rules first: a text that cannot be rebuilt for a booking that has since been
    // cancelled, has started or has changed was not going to be sent anyway.
    const unavailableSkip = render.current ? evaluateFallbackSkip(render.current, delivery.metadata?.booking_facts, now) : null
    if (unavailableSkip) {
      return recordSkipped({ client, delivery, booking: render.booking ?? metadataBooking, reason: unavailableSkip, nowIso })
    }
    return recordFailed({ client, delivery, booking: render.booking ?? metadataBooking, reason: render.reason, nowIso })
  }

  const bookingRef: FallbackBookingRef = { type: render.booking.type, id: render.booking.id }
  const skipReason = evaluateFallbackSkip(render, delivery.metadata?.booking_facts, now)
  if (skipReason) {
    return recordSkipped({ client, delivery, booking: bookingRef, reason: skipReason, nowIso })
  }

  if (!render.sms.to) {
    return recordFailed({ client, delivery, booking: bookingRef, reason: 'no_sms_channel', nowIso })
  }

  const attemptOrder = await nextAttemptOrder(client, deliveryId)
  let result: Awaited<ReturnType<typeof sendSMS>>
  try {
    result = await sendSMS(render.sms.to, render.sms.body, {
      customerId: render.sms.customerId ?? delivery.customer_id ?? undefined,
      createCustomerIfMissing: false,
      metadata: {
        ...render.sms.metadata,
        template_key: delivery.template_key,
        // A fingerprint of the text in the duplicate-protection context, so a retry of this same
        // text is suppressed and a different text for the same booking is not blocked.
        stage: createHash('sha256').update(render.sms.body).digest('hex').slice(0, 16),
        source: 'email_bounce_fallback',
        delayed_fallback_delivery_id: deliveryId,
      },
    })
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : String(error) } as Awaited<ReturnType<typeof sendSMS>>
  }

  const code = typeof (result as { code?: unknown }).code === 'string' ? String((result as { code?: unknown }).code) : null
  const sid = typeof (result as { sid?: unknown }).sid === 'string' ? String((result as { sid?: unknown }).sid) : null
  const logFailure = (result as { logFailure?: unknown }).logFailure === true || code === 'logging_failed'
  // A text that went out but was not logged still reached the guest.
  const smsSent = result.success === true || logFailure
  const smsError = typeof (result as { error?: unknown }).error === 'string' ? String((result as { error?: unknown }).error) : null
  const scheduledFor =
    typeof (result as { scheduledFor?: unknown }).scheduledFor === 'string' ? String((result as { scheduledFor?: unknown }).scheduledFor) : null

  await recordNotificationAttempt({
    client,
    deliveryId,
    attemptOrder,
    channel: 'sms',
    success: smsSent,
    messageId: sid,
    error: smsSent ? null : smsError,
    code,
    extra: { delayed_fallback: true, scheduled_for: scheduledFor, log_failure: logFailure },
  })

  if (!smsSent) {
    return recordFailed({ client, delivery, booking: bookingRef, reason: 'sms_failed', error: smsError ?? code, nowIso })
  }

  await updateNotificationDelivery({
    client,
    deliveryId,
    finalStatus: 'fallback_sent',
    selectedChannel: 'sms',
    metadata: {
      ...(delivery.metadata ?? {}),
      delayed_fallback: { outcome: 'sent', at: nowIso, sms_code: code, scheduled_for: scheduledFor },
    },
  })
  await writeBookingAudit({
    client,
    booking: bookingRef,
    deliveryId,
    templateKey: delivery.template_key,
    outcome: 'sent',
    sms: { to: render.sms.to, body: render.sms.body, sid },
  })

  return { outcome: 'sent', deliveryId, scheduledFor }
}
