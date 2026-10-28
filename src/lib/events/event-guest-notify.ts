/**
 * Email first, text as the fallback, for event booking messages (BK-167, owner decision D14).
 *
 * Every event customer message used to go by text and email together, so paid guests (often new
 * to the pub) got two messages at every step and texts the owner keeps for regulars. Now:
 *
 * - The email goes first. A text goes only when the guest has no usable email, or when the email
 *   fails in the same attempt.
 * - The email sender's own duplicate check decides "already sent", and it fails closed: when the
 *   email log cannot be read the message is deferred, and no text goes in its place. A retry
 *   comes back to it; a text sent "just in case" would be a second message for a guest who may
 *   already have the email.
 * - `both` sends the text as well as the email, for the one case the owner kept on both
 *   channels: a cancellation on the day of the event.
 * - `textFirst` keeps the order the other way round, for a guest mid-conversation by text (a
 *   booking made by replying to a text is confirmed by text, owner decision 9 October 2026).
 *
 * Each message that tries a channel, or finds none, writes one `notification_deliveries` row and
 * one `notification_attempts` row per channel tried, as notifyCustomer and the private booking
 * messenger do, so a message that reached nobody is listed under Settings, SMS failures,
 * Undelivered guest messages. The senders stay the existing event email and text functions: they
 * load the booking, apply the SMS safety rules, quiet hours and kill switches, and build the
 * links, so none of that is duplicated here. The rows carry ids and facts only.
 *
 * The bounce fallback (a text after an email bounces later) is not wired for event messages: it
 * needs a renderer that rebuilds each text from the booking, so `delayed_fallback_allowed` is
 * false on these rows.
 *
 * Never throws: a messaging failure must not undo the booking change that triggered it.
 */

import { logger } from '@/lib/logger'
import {
  createNotificationDelivery,
  recordNotificationAttempt,
  updateNotificationDelivery,
} from '@/lib/notifications/delivery-ledger'

/** What the event email senders return (src/lib/email/event-ticket-emails.ts). */
export type EventEmailAttempt = {
  success: boolean
  /** With success false: no usable address, nothing was sent. With success true: already sent. */
  skipped?: boolean
  /** The duplicate check could not run, so nothing was sent and nothing else may be. */
  deferred?: boolean
  error?: string
  messageId?: string
  code?: string
}

/** What the event text senders return; null when no text was tried. */
export type EventTextAttempt = {
  success: boolean
  code?: string | null
  logFailure?: boolean
  sid?: string | null
  scheduledFor?: string
} | null

export type EventMessageStatus = 'sent' | 'already_sent' | 'deferred' | 'failed' | 'no_channel'

export type EventMessageOutcome = {
  status: EventMessageStatus
  /** The channel that reached the guest first, or null. */
  channel: 'email' | 'sms' | null
  emailed: boolean
  texted: boolean
  /** True when the email was tried and failed and a text went instead. */
  fallbackUsed: boolean
  /** The text sender's result, for callers that report SMS safety to the API. */
  smsMeta: { success: boolean; code: string | null; logFailure: boolean } | null
}

export type EventMessageInput = {
  /** Also the delivery row's template key, e.g. 'event_payment_confirmed'. */
  templateKey: string
  bookingId: string
  eventId?: string | null
  customerId?: string | null
  email?: (() => Promise<EventEmailAttempt>) | null
  text?: (() => Promise<EventTextAttempt>) | null
  /** Send the text as well as the email (a same-day cancellation). */
  both?: boolean
  /** Try the text first and email only when it does not go. */
  textFirst?: boolean
  /**
   * The caller comes back to this message on its next run (a cron). A deferred message is then
   * left for that run. Without it a deferral is a message nobody will retry, so it is recorded as
   * undelivered for staff to follow up.
   */
  retriesLater?: boolean
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function textReached(result: EventTextAttempt): boolean {
  // A text that went but whose log row failed still reached the guest.
  return Boolean(result && (result.success === true || result.logFailure === true || result.code === 'logging_failed'))
}

type Attempt = { channel: 'email' | 'sms'; success: boolean; messageId: string | null; error: string | null; code: string | null }

export async function sendEventMessageEmailFirst(input: EventMessageInput): Promise<EventMessageOutcome> {
  const attempts: Attempt[] = []
  // One mutable record rather than loose lets, because the two senders below set it from closures.
  const state: {
    emailed: boolean
    emailAlreadySent: boolean
    emailTried: boolean
    deferred: boolean
    texted: boolean
    textTried: boolean
    smsMeta: EventMessageOutcome['smsMeta']
  } = { emailed: false, emailAlreadySent: false, emailTried: false, deferred: false, texted: false, textTried: false, smsMeta: null }

  const runEmail = async (): Promise<void> => {
    if (!input.email) return
    let result: EventEmailAttempt
    try {
      result = (await input.email()) ?? { success: false, error: 'No result from the email sender' }
    } catch (error) {
      result = { success: false, error: describe(error) }
    }
    if (result.deferred) {
      state.deferred = true
      return
    }
    if (result.success && result.skipped) {
      state.emailAlreadySent = true
      return
    }
    if (!result.success && result.skipped) return
    state.emailTried = true
    // An email the provider accepted but our log missed still reached the guest.
    state.emailed = result.success === true || Boolean(result.messageId)
    attempts.push({
      channel: 'email',
      success: state.emailed,
      messageId: result.messageId ?? null,
      error: state.emailed ? null : result.error ?? 'Email failed',
      code: result.code ?? null,
    })
  }

  const runText = async (): Promise<void> => {
    if (!input.text) return
    let result: EventTextAttempt
    try {
      result = await input.text()
    } catch (error) {
      result = { success: false, code: 'unexpected_exception', logFailure: false }
      logger.warn('Event text sender threw', {
        metadata: { bookingId: input.bookingId, templateKey: input.templateKey, error: describe(error) },
      })
    }
    if (!result) return
    state.smsMeta = { success: result.success === true, code: result.code ?? null, logFailure: result.logFailure === true }
    // A sender that found no textable number returns success false with no code: nothing was tried.
    if (!result.success && !result.code && !result.logFailure) return
    state.textTried = true
    state.texted = textReached(result)
    attempts.push({
      channel: 'sms',
      success: state.texted,
      messageId: result.sid ?? null,
      error: state.texted ? null : result.code ?? 'Text failed',
      code: result.code ?? null,
    })
  }

  if (input.textFirst) {
    await runText()
    if (!state.texted) await runEmail()
  } else {
    await runEmail()
    // Deferred means the email may already be with the guest: send nothing else now.
    if (!state.deferred && (input.both || (!state.emailed && !state.emailAlreadySent))) await runText()
  }

  const fallbackUsed = !input.textFirst && state.emailTried && !state.emailed && state.texted
  const channel: EventMessageOutcome['channel'] = input.textFirst
    ? (state.texted ? 'sms' : state.emailed ? 'email' : null)
    : (state.emailed || state.emailAlreadySent ? 'email' : state.texted ? 'sms' : null)

  let status: EventMessageStatus
  if (state.emailed || state.texted) status = 'sent'
  else if (state.deferred) status = 'deferred'
  else if (state.emailAlreadySent) status = 'already_sent'
  else if (state.emailTried || state.textTried) status = 'failed'
  else status = 'no_channel'

  // Nothing new happened for an already-sent message, or a deferred one the caller retries.
  if (status === 'already_sent' || (status === 'deferred' && input.retriesLater === true)) {
    return { status, channel, emailed: state.emailed, texted: state.texted, fallbackUsed, smsMeta: state.smsMeta }
  }

  const deliveryId = await createNotificationDelivery({
    customerId: input.customerId ?? null,
    templateKey: input.templateKey,
    policy: input.both ? 'both' : 'email_first',
    category: 'transactional',
    urgency: 'standard',
    delayedFallbackAllowed: false,
    metadata: {
      event_booking_id: input.bookingId,
      event_id: input.eventId ?? null,
      template_key: input.templateKey,
      ...(status === 'no_channel' ? { undelivered_reason: 'no_channel' } : {}),
      ...(status === 'deferred' ? { undelivered_reason: 'duplicate_check_unavailable' } : {}),
    },
  })
  for (const [index, attempt] of attempts.entries()) {
    await recordNotificationAttempt({
      deliveryId,
      attemptOrder: index + 1,
      channel: attempt.channel,
      success: attempt.success,
      messageId: attempt.messageId,
      error: attempt.error,
      code: attempt.code,
    })
  }
  const firstSuccess = attempts.find((attempt) => attempt.success) ?? null
  await updateNotificationDelivery({
    deliveryId,
    // 'no_channel' is listed with the failures, so staff see a guest nobody could reach.
    finalStatus: status === 'sent' ? 'sent' : 'failed',
    selectedChannel: firstSuccess?.channel ?? null,
  })

  if (status === 'failed' || status === 'no_channel' || status === 'deferred') {
    // logger.error so it reaches the production logs; the delivery row is what staff can find.
    logger.error('Event guest message did not reach the guest', {
      metadata: {
        bookingId: input.bookingId,
        eventId: input.eventId ?? null,
        templateKey: input.templateKey,
        status,
        attempts: attempts.map((attempt) => ({ channel: attempt.channel, code: attempt.code, error: attempt.error })),
      },
    })
  }

  return { status, channel, emailed: state.emailed, texted: state.texted, fallbackUsed, smsMeta: state.smsMeta }
}
